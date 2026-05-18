import { Player } from '../Player';
import { BaseLoader } from '../BaseLoader';
import { ItemObject } from './MapObjects';
import { EventBus } from '../../game/EventBus';
import { Enemy } from '../Enemy';
import { canPass } from './Pathfinding';
import { MapDirection, getDirectionOffset } from './MapDirection';
import type { DungeonMap } from '../MapGenerator';

export interface DropResult {
    itemLabel: string;
    x: integer;
    y: integer;
}

const CARDINAL_DIRS: MapDirection[] = [
    MapDirection.EAST,
    MapDirection.SOUTH,
    MapDirection.WEST,
    MapDirection.NORTH,
];

/** 指定座標に ItemObject が既に存在するか */
function hasItemObjectAt(dungeon: DungeonMap, x: integer, y: integer): boolean {
    return dungeon.getObject(x, y).some(o => o instanceof ItemObject);
}

/** 指定座標に生存中の敵が居るか（プレイヤー位置自体は除外しない） */
function hasEnemyAt(dungeon: DungeonMap, x: integer, y: integer): boolean {
    return dungeon.getObject(x, y).some(o => o instanceof Enemy);
}

/**
 * 死亡セル (sourceX, sourceY) からマンハッタン距離 2 以内かつ
 * 壁を越えずに 2 歩以内で到達可能な空きセルを探索する。
 *
 * - 死亡セル自身が候補条件を満たせばそこを返す
 * - そうでなければ BFS（深さ 2）で 4 方向に隣接するセルを順に評価
 * - 候補セル条件: ItemObject も生存敵もいない、かつ **プレイヤーが立っていない**
 *   （プレイヤーセルに置くと直後の dispatchObjectEvent で即時拾得されてしまうため、
 *    床に「一旦置く」を保証するために除外する。ただし BFS の中継点としては通過可）
 * - 見つからなければ null
 */
function findDropTarget(
    dungeon: DungeonMap,
    sourceX: integer,
    sourceY: integer,
): { x: integer; y: integer } | null {
    const playerPos = dungeon.getPlayerPos();
    const isPlayerCell = (x: integer, y: integer) => x === playerPos.x && y === playerPos.y;
    const isAvailable = (x: integer, y: integer) =>
        !isPlayerCell(x, y)
        && !hasItemObjectAt(dungeon, x, y)
        && !hasEnemyAt(dungeon, x, y);

    if (isAvailable(sourceX, sourceY)) {
        return { x: sourceX, y: sourceY };
    }

    const visited = new Set<string>();
    visited.add(`${sourceX},${sourceY}`);
    type Node = { x: integer; y: integer; depth: integer };
    const queue: Node[] = [{ x: sourceX, y: sourceY, depth: 0 }];

    while (queue.length > 0) {
        const current = queue.shift()!;
        if (current.depth >= 2) continue;
        for (const dir of CARDINAL_DIRS) {
            if (!canPass(dungeon, current.x, current.y, dir)) continue;
            const [dx, dy] = getDirectionOffset(dir);
            const nx = current.x + dx;
            const ny = current.y + dy;
            const key = `${nx},${ny}`;
            if (visited.has(key)) continue;
            visited.add(key);
            if (isAvailable(nx, ny)) {
                return { x: nx, y: ny };
            }
            queue.push({ x: nx, y: ny, depth: current.depth + 1 });
        }
    }
    return null;
}

/**
 * 敵が死亡したとき、base.yml floor の enemyDropPool と enemies.yml の drop を
 * additive に評価してアイテムを配置する。
 *
 * - 各エントリの `rate` (0..1) で独立判定
 * - 当選した item は `entry.modifierChance`（未指定なら floor の `itemModifierChance`）
 *   で modifier 抽選を行う
 * - 配置位置は敵が居たマス。既に ItemObject や生存敵が居る場合はマンハッタン距離 2 以内
 *   かつ 2 歩で到達可能な空きセルを探索して配置する
 * - 候補セルが見つからない場合はそのドロップを破棄し「足元に余裕がなく落とせなかった」ログ
 * - 両方未定義 → drop なし。片方のみ → そちらのみ
 *
 * @returns 実際にドロップしたアイテムのリスト
 */
export function tryEnemyDrop(
    dungeon: DungeonMap,
    enemy: Enemy,
    floor: number,
): DropResult[] {
    const floorConfig = BaseLoader.getInstance().getFloorConfig(floor);
    const basePool = floorConfig.enemyDropPool ?? [];
    const enemyPool = enemy.getDefinition().drop ?? [];
    if (basePool.length === 0 && enemyPool.length === 0) return [];

    const pool = [...basePool, ...enemyPool];
    const results: DropResult[] = [];
    const turn = dungeon.getTurnCount();

    for (const entry of pool) {
        if (entry.rate <= 0) continue;
        if (Math.random() >= entry.rate) continue;

        const item = Player.createItem(entry.item, {
            rollModifiers: true,
            floor,
            modifierChanceOverride: entry.modifierChance,
        });
        if (!item) continue;

        const target = findDropTarget(dungeon, enemy.x, enemy.y);
        if (!target) {
            EventBus.emit('message-log', `${enemy.getLabel()}は${item.getLabelWithModifiers()}を落としそうになったが床に余裕がなかった`, turn);
            continue;
        }

        const obj = new ItemObject(item);
        obj.x = target.x;
        obj.y = target.y;
        dungeon.placeObject(obj);

        const label = item.getLabelWithModifiers();
        results.push({ itemLabel: label, x: target.x, y: target.y });
        EventBus.emit('message-log', `${enemy.getLabel()}は${label}を落とした`, turn);
    }
    return results;
}
