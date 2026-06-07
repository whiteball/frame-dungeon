'use strict';

import { MapDirection } from './MapDirection';
import type { DungeonMap } from '../MapGenerator';

/**
 * 直線飛び道具（投擲・遠距離スキル）の経路判定を共有するモジュール。
 *
 * 「視界の通る一直線」を 1 セルずつ前進しながら判定するロジックを 1 箇所に集約する。
 * アイテム投擲（{@link ../ThrowResolver}）と遠距離スキル（`straight` target、
 * {@link ../skills/TargetResolver}）の双方がこれを利用する。
 *
 * 境界判定は通常攻撃（`canAttack`）と異なり **扉も壁として遮蔽する**（飛び道具・視線は
 * 閉じた扉で止まる）。斜めは canAttack と同じ 2 本の L 字経路（pathA / pathB）の
 * いずれかが開いていれば通過可。
 */

/** 指定セル・指定方向に壁ビットがあるか（扉も壁として扱う＝飛び道具は扉で停止する） */
export function isAnyWall(dungeon: DungeonMap, x: integer, y: integer, dir: MapDirection): boolean {
    return !!(dungeon.getAt(x, y) & (1 << dir));
}

/**
 * (fromX, fromY) から単位ベクトル (dx, dy) 方向へ飛び道具が進めるかを判定する。
 * 扉も壁扱いで遮蔽する点が canAttack と異なる。斜めは canAttack と同じ
 * 2 本の L 字経路（pathA / pathB）のいずれかが開いていれば通過可。
 */
export function canProjectileStep(dungeon: DungeonMap, fromX: integer, fromY: integer, dx: integer, dy: integer): boolean {
    const toX = fromX + dx;
    const toY = fromY + dy;
    if (dungeon.getAt(toX, toY) === -1) return false;

    if (dy === 0) {
        return !isAnyWall(dungeon, fromX, fromY, dx > 0 ? MapDirection.EAST : MapDirection.WEST);
    }
    if (dx === 0) {
        return !isAnyWall(dungeon, fromX, fromY, dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH);
    }
    const hDir = dx > 0 ? MapDirection.EAST : MapDirection.WEST;
    const vDir = dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH;
    const pathA = !isAnyWall(dungeon, fromX, fromY, hDir) && !isAnyWall(dungeon, toX, fromY, vDir);
    const pathB = !isAnyWall(dungeon, fromX, fromY, vDir) && !isAnyWall(dungeon, fromX, toY, hDir);
    return pathA || pathB;
}

/**
 * (px, py) から単位ベクトル (stepDx, stepDy) 方向へ直線走査し、
 * 最初に当たる生存中の敵セルを返す。見つからなければ null。
 *
 * 停止条件は {@link canProjectileStep} に従い（壁・扉・マップ境界で停止）、
 * 進入不可オブジェクト（宝箱・blocking イベント＝`isCellBlocked`）でも射線が止まる。
 * `maxRange` を指定すると射程セル数で打ち切る（既定は無制限）。
 *
 * 投擲（{@link ../ThrowResolver.resolveThrow}）が「最初の敵に効果を与えて着弾」する
 * のと同じ経路セマンティクスで、こちらは副作用なしに「対象セルの取得」だけを行う。
 */
export function firstEnemyAlongRay(
    dungeon: DungeonMap,
    px: integer,
    py: integer,
    stepDx: integer,
    stepDy: integer,
    maxRange: number = Infinity,
): { x: integer; y: integer } | null {
    if (stepDx === 0 && stepDy === 0) return null;
    let cx = px;
    let cy = py;
    let steps = 0;
    while (true) {
        if (!canProjectileStep(dungeon, cx, cy, stepDx, stepDy)) return null;
        const nx = cx + stepDx;
        const ny = cy + stepDy;

        const enemy = dungeon.getEnemy(nx, ny);
        if (enemy && enemy.isAlive()) return { x: nx, y: ny };

        // 宝箱・blocking イベント等で射線が止まる（その先の敵は狙えない）
        if (dungeon.isCellBlocked(nx, ny)) return null;

        cx = nx;
        cy = ny;
        steps++;
        if (steps >= maxRange) return null;
    }
}
