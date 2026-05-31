import { EventBus } from '../../EventBus';
import { SkillsLoader } from '../../../lib/SkillsLoader';
import { evaluateCost, canPayCost, formatCostSummary } from '../../../lib/skills/SkillExecutor';
import { formatTargetSummary } from '../../../lib/skills/TargetResolver';
import { formatItemTypeLabel, formatItemEffect } from '../../../lib/ItemDescriptionFormatter';
import { ItemObject } from '../../../lib/map/MapObjects';
import type { Item } from '../../../lib/Item';
import type { MapObject } from '../../../lib/MapObject';
import type { Game } from '../Game';

export type ListMode = 'item' | 'equip' | 'drop' | 'skill';

type ItemListEntry = {
    id: string;
    label: string;
    description: string;
    isEquipped: boolean;
    typeLabel: string;
    effectSummary: string;
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
        EventBus.removeAllListeners('close-item-list-request');
        EventBus.removeAllListeners('open-drop-list-for-pickup');
        EventBus.removeAllListeners('drop-item');

        EventBus.on('use-item', (payload: { instanceId: string }) => {
            // executeSkill が target='front' のスキルなら方向選択モードへ移行する。
            // 確定でアイテム消費 + スキル発動、キャンセルでアイテム非消費・モード解除のみ。
            const item = this.game.player.getInventory().getItemById(payload.instanceId);
            if (item) {
                const skillName = this.findFrontExecuteSkill(item);
                if (skillName !== null) {
                    this.closeList();
                    this.game.enterSkillFromItemTargetSelectMode(payload.instanceId);
                    return;
                }
            }
            if (this.game.dungeon.useConsumableItem(payload.instanceId)) {
                const rest = this.game.player.getInventory().getConsumableItems();
                if (rest.length === 0) {
                    this.closeList();
                } else {
                    EventBus.emit('open-item-list', {
                        items: this.buildItemListPayload(rest),
                        mode: 'item',
                        actionLabel: '使用',
                    });
                }
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
                const learned = this.game.player.getLearnedSkillNames();
                EventBus.emit('open-item-list', {
                    items: this.buildSkillListPayload(learned),
                    mode: 'skill',
                    actionLabel: '発動',
                });
                this.game.render();
                return;
            }

            if (def.target === 'front') {
                // リストを閉じて方向選択モードに移行
                this.closeList();
                this.game.enterSkillTargetSelectMode(payload.skillName);
                return;
            }

            // それ以外（self / around / room / map）は即発動
            if (this.game.dungeon.useSkill(payload.skillName)) {
                // スキル発動成功時は一覧を再描画して開いたままにする
                // （アイテム使用と同じ思想。スキルは消費しないため常に同じ一覧）
                const learned = this.game.player.getLearnedSkillNames();
                EventBus.emit('open-item-list', {
                    items: this.buildSkillListPayload(learned),
                    mode: 'skill',
                    actionLabel: '発動',
                });
                this.game.render();
            }
        });

        EventBus.on('equip-item', (payload: { instanceId: string }) => {
            const result = this.game.dungeon.changeEquipment(payload.instanceId);
            if (result.success) {
                const rest = this.game.player.getInventory().getEquippableItems();
                if (rest.length === 0) {
                    this.closeList();
                } else {
                    EventBus.emit('open-item-list', {
                        items: this.buildItemListPayload(rest),
                        mode: 'equip',
                        actionLabel: '装備',
                    });
                }
                this.game.render();
            }
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
     * 消耗品の immediate.executeSkill を走査し、target='front' のスキル名を返す。
     * 該当する spec が無ければ null。複数 spec がある場合は最初に見つかったものを返す。
     */
    private findFrontExecuteSkill(item: Item): string | null {
        if (!item.isConsumable()) return null;
        const loader = SkillsLoader.getInstance();
        for (const spec of item.getEffectSpecs()) {
            const name = spec.immediate?.executeSkill;
            if (typeof name !== 'string') continue;
            const def = loader.getSkill(name);
            if (def && def.target === 'front') return name;
        }
        return null;
    }

    /** 同じモードならクローズ、違うモードなら開き直す。drop は対象外（onUnderfoot 経由）。 */
    toggleList(mode: 'item' | 'equip' | 'skill'): void {
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
    onUnderfoot(): void {
        if (this.listMode === 'drop') {
            this.closeList();
            return;
        }
        if (this.listMode !== null) {
            this.closeList();
        }
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
                actionLabel: '発動',
            });
            return;
        }

        let items: Item[];
        let actionLabel: string;
        if (mode === 'item') {
            items = this.game.player.getInventory().getConsumableItems();
            actionLabel = '使用';
        } else if (mode === 'equip') {
            items = this.game.player.getInventory().getEquippableItems();
            actionLabel = '装備';
        } else {
            const equippedIds = new Set(
                this.game.player.getAllEquippedItems()
                    .filter((it): it is Item => it !== null)
                    .map(it => it.getInstanceId())
            );
            items = this.game.player.getInventory().getItems()
                .filter(it => !equippedIds.has(it.getInstanceId()));
            actionLabel = '置く';
        }
        this.listMode = mode;
        if (this.game.input.keyboard) this.game.input.keyboard.enabled = false;
        EventBus.emit('open-item-list', {
            items: this.buildItemListPayload(items),
            mode,
            actionLabel,
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
        }));
    }

    private buildSkillListPayload(skillNames: string[]): SkillListEntry[] {
        const stunned = this.game.player.getPlayerActionDirective() === 'skip';
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
