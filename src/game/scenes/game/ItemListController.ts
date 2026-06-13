import { EventBus } from '../../EventBus';
import { SkillsLoader } from '../../../lib/SkillsLoader';
import { evaluateCost, canPayCost, formatCostSummary } from '../../../lib/skills/SkillExecutor';
import { formatTargetSummary } from '../../../lib/skills/TargetResolver';
import { formatItemTypeLabel, formatItemEffect } from '../../../lib/ItemDescriptionFormatter';
import { ItemObject } from '../../../lib/map/MapObjects';
import type { Item } from '../../../lib/Item';
import type { MapObject } from '../../../lib/MapObject';
import type { ActionCategory } from '../../../lib/effects/StatusActionResolver';
import type { Game } from '../Game';

export type ListMode = 'item' | 'equip' | 'drop' | 'skill' | 'throw' | 'inventory';

type ItemListEntry = {
    id: string;
    label: string;
    description: string;
    isEquipped: boolean;
    typeLabel: string;
    effectSummary: string;
    consumable: boolean;
    equippable: boolean;
};

type SkillListEntry = {
    id: string;
    label: string;
    description: string;
    costSummary?: string;
    targetSummary?: string;
    disabled?: boolean;
    disabledReason?: string;
};

/**
 * アイテム / 装備 / スキル / 設置（drop）一覧 UI の状態と挙動を管理する。
 *
 * - 一覧表示中は this.game.input.keyboard.enabled=false にしてゲームの
 *   キー入力をブロックする（数字キーショートカットも自動で無効化される）。
 * - EventBus 経由で UI 側からのアクション通知（'use-item' / 'use-skill' /
 *   'equip-item' / 'drop-item' / 'close-item-list-request' /
 *   'open-drop-list-for-pickup'）を受け取り、対応する操作を実行する。
 * - 拾得 + 設置（インベントリ満杯時の入れ換え）は pendingPickup として
 *   保持し、drop-item 完了時に消費する。
 */
export class ItemListController {
    private listMode: ListMode | null = null;
    private pendingPickup: { mapObject: MapObject, item: Item } | null = null;

    constructor(private game: Game) {}

    /**
     * EventBus に各種ハンドラを登録する。
     * シーン再開でリスナが残らないよう、登録前に同名イベントの旧リスナを一掃する。
     */
    register(): void {
        EventBus.removeAllListeners('use-item');
        EventBus.removeAllListeners('use-skill');
        EventBus.removeAllListeners('equip-item');
        EventBus.removeAllListeners('throw-item');
        EventBus.removeAllListeners('close-item-list-request');
        EventBus.removeAllListeners('open-drop-list-for-pickup');
        EventBus.removeAllListeners('drop-item');

        EventBus.on('use-item', (payload: { instanceId: string }) => {
            if (this.blockByDirective('item')) return;
            // executeSkill が target='front' のスキルなら方向選択モードへ移行する。
            // 確定でアイテム消費 + スキル発動、キャンセルでアイテム非消費・モード解除のみ。
            const item = this.game.player.getInventory().getItemById(payload.instanceId);
            if (item) {
                const skillName = this.findDirectionalExecuteSkill(item);
                if (skillName !== null) {
                    this.closeList();
                    this.game.enterSkillFromItemTargetSelectMode(payload.instanceId);
                    return;
                }
            }
            if (this.game.dungeon.useConsumableItem(payload.instanceId)) {
                this.reopenCurrentList();
                this.game.render();
            }
        });

        EventBus.on('use-skill', (payload: { skillName: string }) => {
            const def = SkillsLoader.getInstance().getSkill(payload.skillName);
            if (!def) return;

            // パッシブ（active 以外）：toggle 対応なら有効/無効を切替（ターン非消費）。
            if ((def.trigger ?? 'active') !== 'active') {
                if (!def.toggle) return; // toggle 不可パッシブは本来 disabled で到達しない
                const enabled = this.game.player.toggleSkill(payload.skillName);
                EventBus.emit('message-log',
                    `スキル「${def.label}」を${enabled ? '有効' : '無効'}にした`,
                    this.game.dungeon.getTurnCount());
                this.continueOrCloseSkillList();
                this.game.render();
                return;
            }

            // active スキルの発動は skip/禁止で封じる（toggle 切替は上で処理済みなので影響しない）
            if (this.blockByDirective('skill')) return;

            if (def.target === 'front' || def.target === 'straight') {
                // リストを閉じて方向選択モードに移行（front=隣接 / straight=射線方向。UI は共通）
                this.closeList();
                this.game.enterSkillTargetSelectMode(payload.skillName);
                return;
            }

            // それ以外（self / around / room / map）は即発動
            if (this.game.dungeon.useSkill(payload.skillName)) {
                // スキル発動成功時は一覧を再描画して開いたままにする
                // （アイテム使用と同じ思想。スキルは消費しないため常に同じ一覧）。
                // ただし設定が有効なら閉じて移動可能状態へ戻す。
                this.continueOrCloseSkillList();
                this.game.render();
            }
        });

        EventBus.on('equip-item', (payload: { instanceId: string }) => {
            if (this.blockByDirective('equip')) return;
            const result = this.game.dungeon.changeEquipment(payload.instanceId);
            if (result.success) {
                this.reopenCurrentList();
                this.game.render();
            }
        });

        EventBus.on('throw-item', (payload: { instanceId: string }) => {
            if (this.blockByDirective('item')) return;
            // リストを閉じて投擲方向選択モードへ移行。確定で throwItem、キャンセルで何もしない。
            this.closeList();
            this.game.enterThrowTargetSelectMode(payload.instanceId);
        });

        EventBus.on('close-item-list-request', () => {
            this.closeList();
        });

        EventBus.on('open-drop-list-for-pickup', (payload: { mapObject: MapObject, item: Item }) => {
            this.pendingPickup = payload;
            this.openList('drop');
        });

        EventBus.on('drop-item', (payload: { instanceId: string }) => {
            const inventory = this.game.player.getInventory();
            const droppedItem = inventory.getItemById(payload.instanceId);
            if (!droppedItem) return;
            const pos = this.game.dungeon.getPlayerPos();
            inventory.removeItemById(payload.instanceId);
            const pending = this.pendingPickup;
            if (pending) {
                if (inventory.addItem(pending.item)) {
                    EventBus.emit('message-log', `${pending.item.getLabelWithModifiers()}を入手した`, this.game.dungeon.getTurnCount());
                }
                this.game.dungeon.removeMapObject(pending.mapObject);
            }
            const droppedObj = new ItemObject(droppedItem);
            droppedObj.x = pos.x;
            droppedObj.y = pos.y;
            this.game.dungeon.placeObject(droppedObj);
            EventBus.emit('message-log', `${droppedItem.getLabelWithModifiers()}を置いた`, this.game.dungeon.getTurnCount());
            this.closeList();
            // 置く/入れ換えはターン非消費（dispatchObjectEvent を呼ばない）。
            // 呼んでしまうと置いた直後の around-0 で自動拾得が走り、置いたアイテムを即回収してしまう
            this.game.render();
        });
    }

    /**
     * 消耗品の immediate.executeSkill を走査し、方向選択を要する（target='front' または
     * 'straight'）スキル名を返す。該当する spec が無ければ null。
     * 複数 spec がある場合は最初に見つかったものを返す。
     */
    private findDirectionalExecuteSkill(item: Item): string | null {
        if (!item.isConsumable()) return null;
        const loader = SkillsLoader.getInstance();
        for (const spec of item.getEffectSpecs()) {
            const name = spec.immediate?.executeSkill;
            if (typeof name !== 'string') continue;
            const def = loader.getSkill(name);
            if (def && (def.target === 'front' || def.target === 'straight')) return name;
        }
        return null;
    }

    /** 同じモードならクローズ、違うモードなら開き直す。drop は対象外（onUnderfoot 経由）。 */
    toggleList(mode: 'item' | 'equip' | 'skill' | 'throw' | 'inventory'): void {
        if (this.listMode === mode) {
            this.closeList();
        } else {
            this.openList(mode);
        }
    }

    /**
     * 足下ボタンの動作。
     * - drop 一覧表示中ならクローズ
     * - 他のリスト表示中ならまずクローズしてから足下処理
     * - 足下にイベント対象オブジェクトがあれば dispatchSelfEvent でターン非消費発火
     * - 何もなければ drop 一覧（設置フロー）を開く
     */
    /**
     * onAction ディレクティブにより、指定カテゴリのメニュー操作を弾くべきか判定する。
     * force 中（自由行動不可）または該当カテゴリが forbid されていればメッセージを出して true。
     * 強制行動自体は移動/攻撃キーのゲートウェイで発火するため、メニューでは実行せず拒否のみ。
     */
    private blockByDirective(category: ActionCategory): boolean {
        const d = this.game.player.getPlayerActionDirective();
        if (d.force || d.forbid.has(category)) {
            EventBus.emit('message-log', d.forbid.get(category) ?? '今はそれができない！', this.game.dungeon.getTurnCount());
            return true;
        }
        return false;
    }

    onUnderfoot(): void {
        if (this.listMode === 'drop') {
            this.closeList();
            return;
        }
        if (this.listMode !== null) {
            this.closeList();
        }
        // 足下の調査系ギミック発火 / 設置リストは investigate カテゴリ。skip/禁止中は弾く。
        if (this.blockByDirective('investigate')) return;
        const dispatched = this.game.dungeon.dispatchSelfEvent();
        if (!dispatched) {
            this.openList('drop');
            return;
        }
        this.game.render();
    }

    closeList(): void {
        if (this.listMode === null) return;
        this.listMode = null;
        this.pendingPickup = null;
        if (this.game.input.keyboard) {
            // enabled=false の間に取りこぼした keyup で Key.isDown が true 固定になるのを解消
            // （次回同じキー押下時に down が発火しない問題の対策）
            this.game.input.keyboard.resetKeys();
            this.game.input.keyboard.enabled = true;
        }
        EventBus.emit('close-item-list');
    }

    private openList(mode: ListMode): void {
        if (this.listMode !== null) this.closeList();

        if (mode === 'skill') {
            const learned = this.game.player.getLearnedSkillNames();
            this.listMode = 'skill';
            if (this.game.input.keyboard) this.game.input.keyboard.enabled = false;
            EventBus.emit('open-item-list', {
                items: this.buildSkillListPayload(learned),
                mode: 'skill',
            });
            return;
        }

        let items: Item[];
        if (mode === 'inventory') {
            // 統合インベントリ: 全アイテムを表示し、操作は下部コンテキストバー（Vue 側）で選ぶ
            items = this.buildInventoryItems();
        } else if (mode === 'item') {
            items = this.game.player.getInventory().getConsumableItems();
        } else if (mode === 'equip') {
            items = this.game.player.getInventory().getEquippableItems();
        } else {
            // drop / throw: 装備中以外の全アイテムを対象にする
            const equippedIds = new Set(
                this.game.player.getAllEquippedItems()
                    .filter((it): it is Item => it !== null)
                    .map(it => it.getInstanceId())
            );
            items = this.game.player.getInventory().getItems()
                .filter(it => !equippedIds.has(it.getInstanceId()));
        }
        this.listMode = mode;
        if (this.game.input.keyboard) this.game.input.keyboard.enabled = false;
        EventBus.emit('open-item-list', {
            items: this.buildItemListPayload(items),
            mode,
        });
    }

    private buildItemListPayload(items: Item[]): ItemListEntry[] {
        const equippedIds = new Set(
            this.game.player.getAllEquippedItems()
                .filter((it): it is Item => it !== null)
                .map(it => it.getInstanceId())
        );
        return items.map(it => ({
            id: it.getInstanceId(),
            label: it.getLabelWithModifiers(),
            description: it.getDescription(),
            isEquipped: equippedIds.has(it.getInstanceId()),
            typeLabel: formatItemTypeLabel(it.getType()),
            effectSummary: formatItemEffect(it.getEffectSpecs()),
            consumable: it.isConsumable(),
            equippable: it.isEquippable(),
        }));
    }

    /**
     * 統合インベントリ用のアイテム配列を組み立てる。
     * 消耗品を先頭にソート（回復薬等へ素早く到達できるように）。
     * Array.prototype.sort は安定なので同区分内の元の並びは保たれる。
     */
    private buildInventoryItems(): Item[] {
        const items = this.game.player.getInventory().getItems();
        return [...items].sort((a, b) => Number(b.isConsumable()) - Number(a.isConsumable()));
    }

    /**
     * 現在のリストモードに応じて一覧を再構築する（アイテム使用 / 装備変更の後に一覧を
     * 開いたまま継続表示するため）。対象が空になったらリストを閉じる。
     */
    /**
     * スキル使用 / toggle 後の継続表示。設定「アイテム/スキルリストを毎回閉じる」が有効なら
     * 一覧を閉じて WASD 移動可能な既定状態へ戻し、無効なら従来どおりスキル一覧を再描画して
     * 開いたままにする。
     */
    private continueOrCloseSkillList(): void {
        if (this.game.getCloseListAfterAction()) {
            this.closeList();
            return;
        }
        const learned = this.game.player.getLearnedSkillNames();
        EventBus.emit('open-item-list', {
            items: this.buildSkillListPayload(learned),
            mode: 'skill',
        });
    }

    private reopenCurrentList(): void {
        // 設定「アイテム/スキルリストを毎回閉じる」が有効なら、使用/装備後は一覧を再表示せず
        // 閉じて WASD 移動可能な既定状態へ戻す。
        if (this.game.getCloseListAfterAction()) {
            this.closeList();
            return;
        }
        const inventory = this.game.player.getInventory();
        let items: Item[];
        let mode: ListMode;
        if (this.listMode === 'inventory') {
            items = this.buildInventoryItems();
            mode = 'inventory';
        } else if (this.listMode === 'equip') {
            items = inventory.getEquippableItems();
            mode = 'equip';
        } else {
            items = inventory.getConsumableItems();
            mode = 'item';
        }
        if (items.length === 0) {
            this.closeList();
            return;
        }
        EventBus.emit('open-item-list', {
            items: this.buildItemListPayload(items),
            mode,
        });
    }

    private buildSkillListPayload(skillNames: string[]): SkillListEntry[] {
        // skip（force あり）または禁止が skill を含むとき、active スキルは発動不可表示にする
        const directive = this.game.player.getPlayerActionDirective();
        const stunned = !!directive.force || directive.forbid.has('skill');
        const loader = SkillsLoader.getInstance();
        const result: SkillListEntry[] = [];
        for (const name of skillNames) {
            const compiled = loader.getCompiledSkill(name);
            if (!compiled) continue;
            const def = compiled.definition;
            const triggerValue = def.trigger ?? 'active';
            if (triggerValue !== 'active') {
                const passiveLabel = this.getPassiveTargetSummary(triggerValue, compiled);
                const costSummary = triggerValue === 'passive' ? '' : formatCostSummary(evaluateCost(this.game.player, compiled));
                if (def.toggle) {
                    // toggle 対応パッシブ：有効/無効を手動切替可能。状態を種別ラベルに併記
                    const enabled = this.game.player.isSkillEnabled(name);
                    result.push({
                        id: name,
                        label: def.label,
                        description: def.description,
                        costSummary,
                        targetSummary: `${passiveLabel} [${enabled ? '有効' : '無効'}]`,
                        disabled: false,
                        disabledReason: '',
                    });
                    continue;
                }
                // toggle 非対応パッシブは手動発動不可
                result.push({
                    id: name,
                    label: def.label,
                    description: def.description,
                    costSummary,
                    targetSummary: passiveLabel,
                    disabled: true,
                    disabledReason: this.getPassiveDisabledReason(triggerValue),
                });
                continue;
            }
            const deltas = evaluateCost(this.game.player, compiled);
            const canPay = canPayCost(this.game.player, deltas);
            const disabled = stunned || !canPay;
            const disabledReason = stunned ? '動けない' : (canPay ? '' : 'コスト不足');
            result.push({
                id: name,
                label: def.label,
                description: def.description,
                costSummary: formatCostSummary(deltas),
                targetSummary: def.target ? formatTargetSummary(def.target) : '',
                disabled,
                disabledReason,
            });
        }
        return result;
    }

    private getPassiveTargetSummary(trigger: string, compiled: ReturnType<typeof SkillsLoader.prototype.getCompiledSkill>): string {
        switch (trigger) {
            case 'on_attack': return '攻撃時';
            case 'on_turn': return 'ターン経過';
            case 'on_damage': return '被ダメージ';
            case 'passive': {
                // add_stats のサマリを生成（"攻+5 / HPmax+10" 形式）
                if (!compiled || compiled.addStats.size === 0) return '常時';
                const baseVars = this.game.player.getFormulaVars();
                const parts: string[] = [];
                for (const [stat, expr] of compiled.addStats) {
                    try {
                        const isMax = stat.endsWith('_max');
                        const baseKey = isMax ? stat.slice(0, -'_max'.length) : stat;
                        baseVars[stat] = isMax ? this.game.player.getMaxStat(baseKey) : this.game.player.getStat(baseKey);
                        const raw = expr.evaluate(baseVars);
                        if (typeof raw === 'number' && Number.isFinite(raw)) {
                            const v = Math.floor(raw);
                            const sign = v >= 0 ? '+' : '';
                            parts.push(`${stat}${sign}${v}`);
                        }
                    } catch {
                        parts.push(`${stat}=?`);
                    }
                }
                return parts.length ? `常時 (${parts.join(', ')})` : '常時';
            }
            default: return 'パッシブ';
        }
    }

    private getPassiveDisabledReason(trigger: string): string {
        switch (trigger) {
            case 'on_attack': return '攻撃時に自動発動';
            case 'on_turn': return 'ターン経過で自動発動';
            case 'on_damage': return '被ダメージで自動発動';
            case 'passive': return '常時発動';
            default: return 'パッシブスキル';
        }
    }
}
