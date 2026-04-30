'use strict';

import type { DungeonMap } from '../MapGenerator';
import { MapDirection, getDirectionOffset } from './MapDirection';
import type { RoomWithCorridors } from './MapBuilder';
import type { Rect } from './Rect';

export type FindPathOptions = {
  /**
   * 'full': マップ全体を探索（デフォルト）
   * 'room': 開始地点が属する部屋／通路ゾーン内だけを探索
   *         終了地点がゾーン内か、ゾーンの扉から1マス外でない場合は undefined を返す
   */
  scope?: 'full' | 'room';
  /**
   * 進入不可として扱う座標のリスト。
   * 終了地点がリストに含まれる場合は undefined を返す。
   * scope:'room' で扉の先がリストに含まれる場合も到達不可とみなす。
   */
  blockedPositions?: [integer, integer][];
};

type PathNode = {
  x: integer;
  y: integer;
  g: integer;
  f: integer;
  parent: PathNode | null;
  dir: MapDirection | null;
  insertOrder: integer;
};

function inRect(x: integer, y: integer, rect: Rect): boolean {
  return rect.x1 <= x && x <= rect.x2 && rect.y1 <= y && y <= rect.y2;
}

function findContainingZone(
  x: integer,
  y: integer,
  rwcList: RoomWithCorridors[],
): RoomWithCorridors | null {
  for (const rwc of rwcList) {
    if (inRect(x, y, rwc.room)) return rwc;
    for (const corridor of rwc.corridors) {
      if (inRect(x, y, corridor)) return rwc;
    }
  }
  return null;
}

function isInZone(x: integer, y: integer, rwc: RoomWithCorridors): boolean {
  if (inRect(x, y, rwc.room)) return true;
  return rwc.corridors.some((c) => inRect(x, y, c));
}

/**
 * ゾーン内タイルが持つ扉ビットの方向へ1マス進んだ地点が (endX, endY) と一致するか判定する。
 * ゾーン外への扉出口タイルを「到達可能な終了地点」として許可するために使用する。
 */
function isOneStepOutsideDoor(
  dungeon: DungeonMap,
  endX: integer,
  endY: integer,
  rwc: RoomWithCorridors,
): boolean {
  const checkRect = (rect: Rect): boolean => {
    for (let x = rect.x1; x <= rect.x2; x++) {
      for (let y = rect.y1; y <= rect.y2; y++) {
        const val = dungeon.getAt(x, y);
        // 扉ビット: EAST=16(bit4), SOUTH=32(bit5), WEST=64(bit6), NORTH=128(bit7)
        for (let d = 0; d < 4; d++) {
          if (val & (16 << d)) {
            const [dx, dy] = getDirectionOffset(d as MapDirection);
            if (x + dx === endX && y + dy === endY) return true;
          }
        }
      }
    }
    return false;
  };
  if (checkRect(rwc.room)) return true;
  return rwc.corridors.some((c) => checkRect(c));
}

/** 現在地 (x, y) から方向 dir へ移動できるか（壁・扉・進入不可マスを考慮） */
function canPass(dungeon: DungeonMap, x: integer, y: integer, dir: MapDirection): boolean {
  const value = dungeon.getAt(x, y);
  if (value === -1) return false;
  const wallBit = 1 << dir;
  if (value & wallBit) {
    // 壁あり → 扉がなければ通過不可
    if (!(value & (wallBit << 4))) return false;
  }
  const [dx, dy] = getDirectionOffset(dir);
  return dungeon.getAt(x + dx, y + dy) !== -1;
}

/**
 * 隣接ノードの展開順。東西を先に処理することで、同コストの場合に
 * 東西移動が南北移動より優先されたパスが得られる。
 */
const EXPAND_ORDER: MapDirection[] = [
  MapDirection.EAST,
  MapDirection.WEST,
  MapDirection.SOUTH,
  MapDirection.NORTH,
];

/**
 * A* 法によるマップ上の2点間経路探索。
 *
 * @returns 開始→終了への移動方向列。同一地点なら空配列、到達不可なら undefined。
 *
 * 東西コスト＝南北コストの場合、展開順と挿入順のタイブレークにより東西移動が優先される。
 */
export function findPath(
  dungeon: DungeonMap,
  rwcList: RoomWithCorridors[],
  startX: integer,
  startY: integer,
  endX: integer,
  endY: integer,
  options: FindPathOptions = {},
): MapDirection[] | undefined {
  if (startX === endX && startY === endY) return [];
  if (dungeon.getAt(endX, endY) === -1) return undefined;

  const { scope = 'full', blockedPositions } = options;

  // posKey: 内部幅（パディング込み）を使い一意なインデックスを生成
  const internalWidth = dungeon.getWidth() + 2;
  const posKey = (x: integer, y: integer) => y * internalWidth + x;

  // blockedPositions を O(1) 検索できる Set に変換
  const blockedSet = new Set<integer>(
    blockedPositions?.map(([bx, by]) => posKey(bx, by)) ?? [],
  );

  // 終了地点が進入不可なら到達不可
  if (blockedSet.has(posKey(endX, endY))) return undefined;

  let zone: RoomWithCorridors | null = null;

  if (scope === 'room') {
    zone = findContainingZone(startX, startY, rwcList);
    if (zone !== null) {
      if (!isInZone(endX, endY, zone) && !isOneStepOutsideDoor(dungeon, endX, endY, zone)) {
        return undefined;
      }
    }
    // zone が null の場合（開始地点が既知のゾーン外）はマップ全体を探索
  }

  const gScore = new Map<integer, integer>();
  const closedSet = new Set<integer>();
  const openSet: PathNode[] = [];
  let insertCounter = 0;

  gScore.set(posKey(startX, startY), 0);
  openSet.push({
    x: startX,
    y: startY,
    g: 0,
    f: Math.abs(startX - endX) + Math.abs(startY - endY),
    parent: null,
    dir: null,
    insertOrder: insertCounter++,
  });

  while (openSet.length > 0) {
    // f 値最小（タイは insertOrder 最小）のノードを取り出す
    let minIdx = 0;
    for (let i = 1; i < openSet.length; i++) {
      const n = openSet[i], m = openSet[minIdx];
      if (n.f < m.f || (n.f === m.f && n.insertOrder < m.insertOrder)) {
        minIdx = i;
      }
    }
    const [current] = openSet.splice(minIdx, 1);
    const cKey = posKey(current.x, current.y);

    if (closedSet.has(cKey)) continue;
    closedSet.add(cKey);

    if (current.x === endX && current.y === endY) {
      const path: MapDirection[] = [];
      let node: PathNode | null = current;
      while (node !== null && node.dir !== null) {
        path.unshift(node.dir);
        node = node.parent;
      }
      return path;
    }

    for (const dir of EXPAND_ORDER) {
      if (!canPass(dungeon, current.x, current.y, dir)) continue;

      const [dx, dy] = getDirectionOffset(dir);
      const nx = current.x + dx;
      const ny = current.y + dy;
      const nKey = posKey(nx, ny);

      if (closedSet.has(nKey)) continue;
      if (blockedSet.has(nKey)) continue;

      // room スコープ: 終了地点以外はゾーン内タイルのみ展開
      if (zone !== null) {
        const isEndpoint = nx === endX && ny === endY;
        if (!isEndpoint && !isInZone(nx, ny, zone)) continue;
      }

      const newG = current.g + 1;
      const existingG = gScore.get(nKey);
      if (existingG !== undefined && existingG <= newG) continue;

      gScore.set(nKey, newG);
      openSet.push({
        x: nx,
        y: ny,
        g: newG,
        f: newG + Math.abs(nx - endX) + Math.abs(ny - endY),
        parent: current,
        dir,
        insertOrder: insertCounter++,
      });
    }
  }

  return undefined;
}
