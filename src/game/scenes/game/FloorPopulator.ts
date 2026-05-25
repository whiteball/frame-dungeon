import { BaseLoader } from '../../../lib/BaseLoader';
import type { ResolvedFloorConfig, ResolvedTreasureItemEntry } from '../../../lib/BaseLoader';
import { ItemsLoader } from '../../../lib/ItemsLoader';
import { TrapsLoader } from '../../../lib/TrapsLoader';
import { EventsLoader } from '../../../lib/EventsLoader';
import { ItemFactory } from '../../../lib/ItemFactory';
import { EnemyFactory } from '../../../lib/EnemyFactory';
import { EventObject, ItemObject, TreasureObject } from '../../../lib/map/MapObjects';
import type { DungeonMap, DungeonRestoreCallbacks } from '../../../lib/MapGenerator';
import type { Item } from '../../../lib/Item';
import { buildStairsObject, buildTrapObject } from './mapObjectFactory';

/**
 * 階段・トラップに紐付けるイベントハンドラ。
 * セーブデータ復元時の `DungeonRestoreCallbacks` と同形のため再利用する。
 */
export type FloorPopulationCallbacks = DungeonRestoreCallbacks;

/** Phaser.Math.Between 相当（min/max 両端含む整数）。 */
function randInt(min: integer, max: integer): integer {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * 階段移動時のフロア初期化を実行する。
 *
 * 1. floorConfig に従って dungeon をリサイズ・再構築し、floor turn を 0 リセット
 * 2. 階段を 1 つランダム配置（コールバック onEnterStair を MapObject に紐付け）
 * 3. 隠し部屋がある場合は treasure 設定に従い宝箱を抽選配置
 * 4. trapMin〜trapMax のトラップを配置（applyTrapEffects / enterTrapConfirmMode を紐付け）
 * 5. roomCount±3 のランダム床アイテムを配置（modifier 抽選あり、floor 依存）
 * 6. 固定敵→ランダム敵プールの順で敵を配置
 *
 * excludePositionList は配置確定済みセルを蓄積していき、後続の配置で衝突を避ける。
 */
export function populateFloor(args: {
    dungeon: DungeonMap;
    floor: integer;
    callbacks: FloorPopulationCallbacks;
}): void {
    const { dungeon, floor, callbacks } = args;
    const floorConfig = BaseLoader.getInstance().getFloorConfig(floor);
    dungeon.setCurrentFloor(floor);
    dungeon.resize(floorConfig.width, floorConfig.height);
    dungeon.build({
        secretRoomChance: floorConfig.secretRoomChance,
        extraDoorRate: floorConfig.extraDoorRate,
    });
    dungeon.resetFloorTurnCount();

    dungeon.clearEnemies();

    const excludePositionList: integer[][] = [];

    // 階段の追加
    const step = dungeon.getRandomPos({ withoutCorridor: true, withoutDoor: true, withoutPlayer: true, withoutSecretRoom: true });
    if (step.length >= 2) {
        const stairsObj = buildStairsObject(callbacks.onEnterStair);
        stairsObj.x = step[0];
        stairsObj.y = step[1];
        dungeon.placeObject(stairsObj);
        excludePositionList.push(step);
    }

    // 隠し部屋の宝箱配置（base.yml の treasure 設定に従う）
    if (floorConfig.treasure && floorConfig.treasure.items.length > 0) {
        const t = floorConfig.treasure;
        for (const room of dungeon.getSecretRoomRects()) {
            if (Math.random() >= t.rate) continue;

            const doorCells = new Set<string>();
            for (const d of dungeon.findDoorsInRoom(room)) {
                doorCells.add(`${d.x},${d.y}`);
            }

            const candidates: integer[][] = [];
            for (let y = room.y1; y <= room.y2; y++) {
                for (let x = room.x1; x <= room.x2; x++) {
                    if (dungeon.getAt(x, y) === -1) continue;
                    if (doorCells.has(`${x},${y}`)) continue;
                    if (excludePositionList.some(p => p[0] === x && p[1] === y)) continue;
                    candidates.push([x, y]);
                }
            }
            if (candidates.length === 0) continue;

            const item = pickTreasureItem(t.items);
            if (!item) continue;

            const [tx, ty] = candidates[randInt(0, candidates.length - 1)];
            const treasureObj = new TreasureObject(item, t.trapRate, [...floorConfig.trapPool]);
            treasureObj.x = tx;
            treasureObj.y = ty;
            dungeon.placeObject(treasureObj);
            excludePositionList.push([tx, ty]);
        }
    }

    // トラップ配置（base.yml の設定に従う）
    const trapCount = randInt(floorConfig.trapMin, floorConfig.trapMax);
    const traps = dungeon.getRandomPosList(trapCount, false, { withoutPlayer: true, withoutSecretRoom: true, excludePositionList: [step] });
    for (const trapPos of traps) {
        if (floorConfig.trapPool.length === 0) break;
        const trapName = floorConfig.trapPool[randInt(0, floorConfig.trapPool.length - 1)];
        const trapDef = TrapsLoader.getInstance().getTrap(trapName)!;
        const trapObj = buildTrapObject(
            trapDef,
            callbacks.applyTrapEffects,
            callbacks.enterTrapConfirmMode,
        );
        trapObj.x = trapPos[0];
        trapObj.y = trapPos[1];
        dungeon.placeObject(trapObj);
        excludePositionList.push(trapPos);
    }

    // イベントオブジェクトの配置（base.yml の events / eventCount に従う）
    if (floorConfig.eventPool.length > 0 && floorConfig.eventMax > 0) {
        const eventCount = randInt(floorConfig.eventMin, floorConfig.eventMax);
        const eventPositions = dungeon.getRandomPosList(eventCount, false, {
            withoutCorridor: true,
            withoutDoor: true,
            withoutPlayer: true,
            withoutSecretRoom: true,
            excludePositionList,
        });
        for (const pos of eventPositions) {
            const eventDef = pickWeightedEvent(floorConfig.eventPool);
            if (!eventDef) continue;
            const def = EventsLoader.getInstance().getEvent(eventDef);
            if (!def) continue;
            const eventObj = new EventObject(def);
            eventObj.x = pos[0];
            eventObj.y = pos[1];
            dungeon.placeObject(eventObj);
            excludePositionList.push(pos);
        }
    }

    // アイテムの配置
    const itemDefs = ItemsLoader.getInstance().getItems();
    if (itemDefs.length > 0) {
        const roomCount = dungeon.getRoomCount();
        const itemCount = Math.max(0, randInt(roomCount - 3, roomCount + 3));
        const itemPositions = dungeon.getRandomPosList(itemCount, false, {
            withoutCorridor: true,
            withoutPlayer: true,
            withoutSecretRoom: true,
            excludePositionList,
        });
        for (const pos of itemPositions) {
            const itemDef = itemDefs[randInt(0, itemDefs.length - 1)];
            const item = ItemFactory.createItem(itemDef.name, { rollModifiers: true, floor });
            if (!item) continue;
            const itemObj = new ItemObject(item);
            itemObj.x = pos[0];
            itemObj.y = pos[1];
            dungeon.placeObject(itemObj);
            excludePositionList.push(pos);
        }
    }

    // 敵の配置
    spawnEnemies(dungeon, floor, floorConfig, excludePositionList);
}

/**
 * eventPool の重み付き抽選で 1 イベント名を決定する。
 */
function pickWeightedEvent(pool: { name: string; weight: number }[]): string | null {
    if (pool.length === 0) return null;
    const total = pool.reduce((s, e) => s + e.weight, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const e of pool) {
        r -= e.weight;
        if (r < 0) return e.name;
    }
    return pool[pool.length - 1].name;
}

/**
 * treasure.items の重み付き抽選で 1 アイテムを決定し、指定 modifier を強制付与する。
 * フロアの itemModifierChance とは独立。
 */
function pickTreasureItem(entries: ResolvedTreasureItemEntry[]): Item | null {
    if (entries.length === 0) return null;
    const total = entries.reduce((s, e) => s + e.bias, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    let picked: ResolvedTreasureItemEntry | undefined;
    for (const e of entries) {
        r -= e.bias;
        if (r < 0) { picked = e; break; }
    }
    if (!picked) picked = entries[entries.length - 1];

    const item = ItemFactory.createItem(picked.name);
    if (!item) return null;
    for (const m of picked.modifiers) {
        item.setModifierCount(m.name, m.count);
    }
    return item;
}

/**
 * fixedEnemies を先に配置し、残りスロットを randomEnemyPool から抽選して埋める。
 */
function spawnEnemies(
    dungeon: DungeonMap,
    floor: integer,
    config: ResolvedFloorConfig,
    excludePositions: integer[][],
): void {
    for (const { name, count } of config.fixedEnemies) {
        const positions = dungeon.getRandomPosList(count, false, {
            withoutPlayer: true,
            withoutSecretRoom: true,
            excludePositionList: excludePositions,
        });
        for (const pos of positions) {
            const enemy = EnemyFactory.createEnemy(name, pos[0], pos[1]);
            if (enemy) dungeon.addEnemy(enemy);
            excludePositions.push(pos);
        }
    }

    const fixedTotal = config.fixedEnemies.reduce((sum, e) => sum + e.count, 0);
    const randomCount = Math.max(0, config.enemyCount - fixedTotal);
    if (randomCount > 0 && config.randomEnemyPool.length > 0) {
        const positions = dungeon.getRandomPosList(randomCount, false, {
            withoutPlayer: true,
            withoutSecretRoom: true,
            excludePositionList: excludePositions,
        });
        for (const pos of positions) {
            const name = config.randomEnemyPool[Math.floor(Math.random() * config.randomEnemyPool.length)];
            const enemy = EnemyFactory.createEnemy(name, pos[0], pos[1]);
            if (enemy) dungeon.addEnemy(enemy);
        }
    }

    console.log(`Spawned enemies on floor ${floor} (fixed: ${fixedTotal}, random: ${randomCount})`);
}
