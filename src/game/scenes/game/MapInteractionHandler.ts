import { EventBus } from '../../EventBus';
import { BaseLoader } from '../../../lib/BaseLoader';
import { StatsLoader } from '../../../lib/StatsLoader';
import { EffectsLoader } from '../../../lib/EffectsLoader';
import { TrapsLoader } from '../../../lib/TrapsLoader';
import type { TrapDefinition } from '../../../lib/TrapsLoader';
import { EventObject, ItemObject, TreasureObject } from '../../../lib/map/MapObjects';
import { EventsLoader } from '../../../lib/EventsLoader';
import type { CompiledEventChoice } from '../../../lib/EventsLoader';
import {
    canPayChoiceCost,
    evaluateChoiceCost,
    executeEventChoice,
    executeEventImmediate,
    formatChoiceCostSummary,
} from '../../../lib/events/EventExecutor';
import { getDirectionOffset, rotateDirection } from '../../../lib/map/MapDirection';
import { makeStatFluctuatedMessage } from '../../../lib/util/text';
import type { SceneAction } from './SceneModeController';
import type { Game } from '../Game';

/**
 * マップ上の対話可能オブジェクト（トラップ・宝箱・「調べる」対象など）との
 * 相互作用処理をまとめる。今後「祭壇」「スイッチ」「看板」等の調査ギミックを
 * 追加する場合もここに集約する想定。
 *
 * - {@link applyTrapEffects} は通常踏み発動・トラップ起動モード起動・
 *   宝箱トラップ・セーブデータ復元の各経路から呼ばれるため public。
 * - {@link trySearch} は C キーから呼ばれる。
 * - {@link openTreasure} と executeSearch は trySearch 内部からのみ使う。
 */
export class MapInteractionHandler {
    constructor(private game: Game) {}

    /**
     * トラップの effect 配列を順次適用する。damage で死亡した場合は早期 return。
     */
    applyTrapEffects(trapDef: TrapDefinition): void {
        const turn = this.game.dungeon.getTurnCount();
        EventBus.emit('message-log', `${trapDef.label}を踏んだ！`, turn);

        for (const effect of trapDef.effect) {
            if (effect.type === 'stat' && typeof effect.target === 'string' && typeof effect.value === 'number') {
                const target = effect.target;
                const value = effect.value;
                const before = this.game.player.getStat(target);
                this.game.player.addStat(target, value);
                const delta = this.game.player.getStat(target) - before;
                const statsLoader = StatsLoader.getInstance();

                if (statsLoader.isFluctuationAllowed(target) && value < 0) {
                    // 変動する値ならダメージ表記
                    const damage = -delta;
                    EventBus.emit('attack-flash', 0xFF2222);
                    EventBus.emit('message-log',
                        `${damage}のダメージ！(残り${statsLoader.getAbbreviation(target)}: ${this.game.player.getStat(target)}/${this.game.player.getEffectiveMaxStat(target)})`,
                        turn);
                    const cleared = this.game.player.notifyDamageTaken();
                    for (const c of cleared) {
                        EventBus.emit('message-log', `${c.label}が解けた`, turn);
                    }
                } else if (delta !== 0) {
                    // それ以外は汎用的な変動ログ
                    const statName = statsLoader.getAbbreviation(target) || target;
                    EventBus.emit('message-log', makeStatFluctuatedMessage(statName, delta), turn);
                }
                const deadVars = {
                    ...this.game.player.getFormulaVars(),
                    currentFloor: this.game.floor,
                    maxFloor: BaseLoader.getInstance().getGoalFloor(),
                };
                if (BaseLoader.getInstance().isDead(deadVars)) {
                    EventBus.emit('game-over');
                    return;
                }
            } else if (effect.type === 'addEffect' && typeof effect.value === 'string') {
                const effName = effect.value;
                const result = this.game.player.applyStatusEffect(effName);
                const def = EffectsLoader.getInstance().getEffect(effName);
                const label = def?.label ?? effName;
                if (result === 'applied') {
                    EventBus.emit('message-log', `${label}状態になった！`, turn);
                } else if (result === 'resisted') {
                    EventBus.emit('message-log', `${label}を耐性で防いだ！`, turn);
                }
            } else if (effect.type === 'unequip') {
                // トラップによる強制装備解除は cannot_unequip を無視する（ローグライク慣例）
                const slots: Array<'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2'> =
                    ['weapon', 'main_armor', 'sub_armor1', 'sub_armor2'];
                for (const slot of slots) {
                    const removed = this.game.player.unequipItem(slot);
                    if (removed) {
                        EventBus.emit('message-log', `${removed.getLabelWithModifiers()}が外れた`, turn);
                    }
                }
            }
        }
    }

    /**
     * 調査方向選択モードに入る。左/中央/右 のいずれかを押すと {@link executeSearch}
     * が、キャンセルでデフォルトモードに復帰する。
     */
    trySearch(): void {
        const { x, y, direction } = this.game.dungeon.getPlayerPos();
        const [fdx, fdy] = getDirectionOffset(direction);
        const [rdx, rdy] = getDirectionOffset(rotateDirection(direction, 1));
        const centerCell: [integer, integer] = [x + fdx, y + fdy];
        const rightCell: [integer, integer] = [centerCell[0] + rdx, centerCell[1] + rdy];
        const leftCell: [integer, integer] = [centerCell[0] - rdx, centerCell[1] - rdy];

        const actions: SceneAction[] = [
            {
                label: '左',
                onClick: () => this.executeSearch('左', leftCell[0], leftCell[1]),
            },
            {
                label: '中央',
                onClick: () => this.executeSearch('中央', centerCell[0], centerCell[1]),
            },
            {
                label: '右',
                onClick: () => this.executeSearch('右', rightCell[0], rightCell[1]),
            },
            {
                label: 'キャンセル',
                onClick: () => this.game.mode.enterDefaultMode(),
            },
        ];

        this.game.mode.setSceneActions(actions);
        this.game.mode.setModeLabel('調査方向選択中');
    }

    /**
     * 正面（中央セル）を調査する。Space キーで敵が一体もいない場合に呼ばれ、
     * C キー →「中央」選択と同等の処理を方向選択を挟まず即実行する
     * （手軽な調査・1 ターンスキップ手段）。
     */
    searchFront(): void {
        const { x, y, direction } = this.game.dungeon.getPlayerPos();
        const [fdx, fdy] = getDirectionOffset(direction);
        this.executeSearch('中央', x + fdx, y + fdy);
    }

    private executeSearch(directionLabel: string, targetX: integer, targetY: integer): void {
        const turnCount = this.game.dungeon.getTurnCount();
        EventBus.emit('message-log', `${directionLabel}を調べた。`, turnCount);

        const objects = this.game.dungeon.getObject(targetX, targetY);
        const treasure = objects.find(o => o instanceof TreasureObject) as TreasureObject | undefined;
        if (treasure) {
            this.openTreasure(treasure, targetX, targetY);
            this.game.render();
            this.game.mode.enterDefaultMode();
            return;
        }

        const eventObj = objects.find(o => o instanceof EventObject) as EventObject | undefined;
        if (eventObj) {
            this.investigateEvent(eventObj);
            // 選択肢モードに遷移する場合は mode 操作はそちらで行うため
            // ここではデフォルトモード復帰を skip し、即時実行系のみ復帰させる
            return;
        }

        this.game.dungeon.searchAt(targetX, targetY);
        this.game.render();
        this.game.mode.enterDefaultMode();
    }

    /**
     * 調査でイベントオブジェクトに到達した際の処理。
     * 1. flavor をログ出力
     * 2. choices があれば選択肢モード起動、無ければ即時実行（action / random_outcome）
     * 3. 即時実行系はターン消費し再描画
     */
    private investigateEvent(eventObj: EventObject): void {
        const turn = this.game.dungeon.getTurnCount();
        EventBus.emit('message-log', eventObj.eventDef.flavor, turn);

        const compiled = EventsLoader.getInstance().getCompiledEvent(eventObj.eventDef.name);
        if (!compiled) {
            console.warn(`Compiled event not found for "${eventObj.eventDef.name}"`);
            this.game.mode.enterDefaultMode();
            return;
        }

        if (eventObj.eventDef.choices && compiled.compiledChoices.length > 0) {
            this.enterChoiceMode(eventObj, compiled.compiledChoices);
            return;
        }

        // 選択肢無し（action / random_outcome）→ 即時実行
        executeEventImmediate(this.game.dungeon, this.game.player, eventObj);
        this.game.render();
        this.game.mode.enterDefaultMode();
        this.game.dungeon.dispatchObjectEvent();
        this.game.render();
    }

    /**
     * 選択肢メニューを SceneModeController 経由で開く。cost 支払い不能な choice は disabled に。
     */
    private enterChoiceMode(eventObj: EventObject, compiledChoices: CompiledEventChoice[]): void {
        const player = this.game.player;
        const choiceButtons = compiledChoices.map(cc => {
            let disabled = false;
            let label = cc.choice.label;
            if (cc.cost.size > 0) {
                const deltas = evaluateChoiceCost(player, cc.cost);
                const summary = formatChoiceCostSummary(deltas);
                if (summary) label = `${cc.choice.label} (${summary})`;
                if (!canPayChoiceCost(player, deltas)) {
                    disabled = true;
                }
            }
            return { label, disabled };
        });

        this.game.mode.enterEventChoiceMode(choiceButtons, (idx) => {
            const cc = compiledChoices[idx];
            if (!cc) return;
            // 支払い
            if (cc.cost.size > 0) {
                const deltas = evaluateChoiceCost(player, cc.cost);
                if (!canPayChoiceCost(player, deltas)) {
                    EventBus.emit('message-log', 'コストを支払えなかった', this.game.dungeon.getTurnCount());
                    this.game.render();
                    return;
                }
                for (const [stat, delta] of deltas) {
                    player.addStat(stat, delta);
                }
            }
            executeEventChoice(this.game.dungeon, player, eventObj, cc);
            this.game.render();
            this.game.dungeon.dispatchObjectEvent();
            this.game.render();
        });
    }

    /**
     * 宝箱を開封する。
     * 1. メッセージログを出力
     * 2. trapRate でトラップ発動判定し、trapPool 非空ならランダム1つ選んで applyTrapEffects
     * 3. TreasureObject を削除し、抽選アイテムを ItemObject として同セルに配置
     * 4. dispatchObjectEvent でターン進行
     */
    private openTreasure(treasure: TreasureObject, x: integer, y: integer): void {
        const turn = this.game.dungeon.getTurnCount();
        EventBus.emit('message-log', `宝箱を開けた！`, turn);

        if (Math.random() < treasure.trapRate && treasure.trapPool.length > 0) {
            const idx = Math.floor(Math.random() * treasure.trapPool.length);
            const trapName = treasure.trapPool[idx];
            const trapDef = TrapsLoader.getInstance().getTrap(trapName);
            if (trapDef) {
                this.applyTrapEffects(trapDef);
            }
        }

        this.game.dungeon.removeMapObject(treasure);
        const itemObj = new ItemObject(treasure.item);
        itemObj.x = x;
        itemObj.y = y;
        this.game.dungeon.placeObject(itemObj);
        EventBus.emit('message-log', `${treasure.item.getLabelWithModifiers()}が出てきた`, turn);

        this.game.dungeon.dispatchObjectEvent();
    }
}
