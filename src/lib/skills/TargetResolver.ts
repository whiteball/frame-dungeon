import type { DungeonMap } from '../MapGenerator';
import type { SkillTarget } from '../SkillsLoader';
import { getDirectionOffset, rotateDirection } from '../map/MapDirection';
import { firstEnemyAlongRay } from '../map/Projectile';

export interface TargetCell {
    x: integer;
    y: integer;
}

/**
 * target スコープを解決し、対象セル配列を返す。
 * - front: preSelectedCell を 1 要素返す（未指定なら空）
 * - straight: preSelectedCell の方向（単位ベクトル）へ直線走査し、射線上の最初の生存敵セルを
 *   1 要素返す（敵がいなければ空）。走査の遮蔽は投擲と同じ（壁・扉・進入不可オブジェクトで停止）
 * - around: 隣接 8 マスのうち caster から canAttack で到達可能なもののみ（caster 除く、壁越しは除外）
 * - room: getCellsInZone の結果（caster 除く、壁・扉で囲まれた視覚的開放空間）
 * - map: 壁マス（getAt = -1）以外の全セル（caster 除く、視覚的到達性は問わない）
 * - self: caster 位置のみ
 */
export function resolveTarget(
    target: SkillTarget,
    dungeon: DungeonMap,
    preSelectedCell?: TargetCell
): TargetCell[] {
    const { x: px, y: py } = dungeon.getPlayerPos();

    switch (target) {
        case 'self':
            return [{ x: px, y: py }];

        case 'front':
            return preSelectedCell ? [{ x: preSelectedCell.x, y: preSelectedCell.y }] : [];

        case 'straight': {
            // preSelectedCell（front と同じ隣接セル）から方向の単位ベクトルを導き、
            // 射線上の最初の生存敵セルを 1 つだけ対象にする。敵がいなければ空配列。
            if (!preSelectedCell) return [];
            const stepDx = Math.sign(preSelectedCell.x - px);
            const stepDy = Math.sign(preSelectedCell.y - py);
            const hit = firstEnemyAlongRay(dungeon, px, py, stepDx, stepDy);
            return hit ? [hit] : [];
        }

        case 'around': {
            const cells: TargetCell[] = [];
            for (let dy = -1; dy <= 1; dy++) {
                for (let dx = -1; dx <= 1; dx++) {
                    if (dx === 0 && dy === 0) continue;
                    const tx = px + dx;
                    const ty = py + dy;
                    // 壁越しの方向や対角線が両側塞がっている方向は除外（front と同じ canAttack 判定）
                    if (!dungeon.canAttack(px, py, tx, ty)) continue;
                    cells.push({ x: tx, y: ty });
                }
            }
            return cells;
        }

        case 'room':
            return dungeon.getCellsInZone(px, py)
                .filter(([x, y]) => !(x === px && y === py))
                .map(([x, y]) => ({ x, y }));

        case 'map': {
            const cells: TargetCell[] = [];
            const w = dungeon.getWidth();
            const h = dungeon.getHeight();
            // 内部座標 [1, _width-2] = [1, getWidth()] が playable な範囲
            for (let y = 1; y <= h; y++) {
                for (let x = 1; x <= w; x++) {
                    if (x === px && y === py) continue;
                    if (dungeon.getAt(x, y) === -1) continue;
                    cells.push({ x, y });
                }
            }
            return cells;
        }

        case 'hit':
            // 'hit' は PlayerSkillExecutor / EnemySkillExecutor が直接 cells を渡すため
            // resolveTarget 経由では到達しないが、TS の網羅性チェックを満たすため空配列を返す
            return preSelectedCell ? [{ x: preSelectedCell.x, y: preSelectedCell.y }] : [];
    }
}

/**
 * front の選択候補（左/中央/右セル）を返す。UI 構築用。
 * valid フィールドは「正面方向のセルへ canAttack が通るか」（壁判定）。
 */
export function getFrontCandidates(dungeon: DungeonMap): Array<{
    label: '左' | '中央' | '右';
    cell: TargetCell;
    valid: boolean;
}> {
    const { x, y, direction } = dungeon.getPlayerPos();
    const [fdx, fdy] = getDirectionOffset(direction);
    const [rdx, rdy] = getDirectionOffset(rotateDirection(direction, 1));
    const center: TargetCell = { x: x + fdx, y: y + fdy };
    const right: TargetCell = { x: center.x + rdx, y: center.y + rdy };
    const left: TargetCell = { x: center.x - rdx, y: center.y - rdy };
    return [
        { label: '左' as const, cell: left, valid: dungeon.canAttack(x, y, left.x, left.y) },
        { label: '中央' as const, cell: center, valid: dungeon.canAttack(x, y, center.x, center.y) },
        { label: '右' as const, cell: right, valid: dungeon.canAttack(x, y, right.x, right.y) },
    ];
}

/**
 * target スコープを表示用に要約する。
 */
export function formatTargetSummary(target: SkillTarget): string {
    switch (target) {
        case 'front': return '前方';
        case 'straight': return '直線';
        case 'around': return '周囲';
        case 'room': return '部屋';
        case 'map': return '全体';
        case 'self': return '自分';
        case 'hit': return '被弾セル';
    }
}
