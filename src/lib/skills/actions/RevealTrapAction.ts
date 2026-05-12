import { Player } from '../../Player';
import { TrapObject } from '../../map/MapObjects';
import { EventBus } from '../../../game/EventBus';
import type { DungeonMap } from '../../MapGenerator';
import type { TargetCell } from '../TargetResolver';

/**
 * reveal_trap action: target スコープ内のセルから未発見の TrapObject を可視化する。
 *
 * 既に visible なトラップは無視（再ログも出さない）。発見が 0 件でも特別なログは出さず、
 * スキル発動の「スキル『X』を発動した！」ヘッダログのみで完結する。
 *
 * caster は使用しない（パラメータシグネチャの統一のために受け取る）。
 */
export function executeRevealTrapAction(
    dungeon: DungeonMap,
    _caster: Player,
    cells: TargetCell[],
): void {
    const turn = dungeon.getTurnCount();
    for (const { x, y } of cells) {
        const objects = dungeon.getObject(x, y);
        for (const obj of objects) {
            if (obj instanceof TrapObject && !obj.visible) {
                obj.visible = true;
                EventBus.emit('message-log', `${obj.trapDef.label}を発見した！`, turn);
            }
        }
    }
}
