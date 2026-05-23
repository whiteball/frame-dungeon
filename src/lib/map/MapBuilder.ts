'use strict';

import type { DungeonMap } from '../MapGenerator';
import { Rect } from './Rect';
import { MapDirection, getRandomDirection } from './MapDirection';
import { getRandomInt, arrayShuffle } from '../util/random';

export type RoomWithCorridors = {
  room: Rect,
  corridors: Rect[],
};

/**
 * ダンジョンの部屋・通路・壁・扉を生成するアルゴリズム群
 *
 * DungeonMap のグリッドアクセサ（setAt/getAt/updateAt）を使用してマップに書き込む。
 * 生成結果（rooms, roomsWithCorridors）は呼び出し側に返却し、DungeonMap が保持する。
 */
export class MapBuilder {
  /**
   * @param dungeon マップへの書き込み対象となる DungeonMap
   * @param width 内側パディングを含むマップ幅（DungeonMap._width と同じ）
   * @param height 内側パディングを含むマップ高さ（DungeonMap._height と同じ）
   * @param minRoomLength 部屋・通路の最小長
   */
  constructor(
    private dungeon: DungeonMap,
    private width: integer,
    private height: integer,
    private minRoomLength: integer,
  ) {}

  /**
   * ダンジョンに部屋を生成する
   * 横方向と縦方向に分割線を配置し、矩形の部屋を作成する
   * @returns 生成された部屋の配列
   */
  public makeRoom(): Rect[] {
    const minRoomLength = this.minRoomLength;

    const hMax = Math.floor((this.height - 3) / (minRoomLength + 1))
    const vMax = Math.floor((this.width - 3) / (minRoomLength + 1))

    // 横方向に切る
    const horizontalLines: integer[] = [];
    const hLines: integer[] = [];
    for (let i = minRoomLength; i < this.height - 2 - minRoomLength; i++) {
      hLines.push(i)
    }
    arrayShuffle(hLines);
    for (let i = 0; i < hMax; i++) {
      let temp: integer | undefined = 0, line = 0;
      do {
        temp = hLines.pop()
        if (temp !== undefined) {
          line = temp;
        } else {
          line = -1
          break;
        }
      } while (horizontalLines.some(val => (line - minRoomLength <= val && line + minRoomLength >= val)));

      if ((line !== -1)) {
        horizontalLines.push(line);
      }
    }

    // 縦方向に切る
    const verticalLines: integer[] = [];
    const vLines: integer[] = [];
    for (let i = minRoomLength; i < this.width - 2 - minRoomLength; i++) {
      vLines.push(i)
    }
    arrayShuffle(vLines);
    for (let i = 0; i < vMax; i++) {
      let temp: integer | undefined = 0, line = 0;
      do {
        temp = vLines.pop()
        if (temp !== undefined) {
          line = temp;
        } else {
          line = -1;
          break;
        }
      } while (verticalLines.some(val => (line - minRoomLength <= val && line + minRoomLength >= val)));

      if ((line !== -1)) {
        verticalLines.push(line);
      }
    }

    // 縦横で区切られた領域を部屋とする
    const rooms: Rect[] = [];
    let prevHorizon = 0, prevVertical = 0;
    for (const horizon of horizontalLines.sort((a, b) => a - b)) {
      for (const vertical of verticalLines.sort((a, b) => a - b)) {
        rooms.push(new Rect(prevVertical + 1, prevHorizon + 1, vertical, horizon));
        prevVertical = vertical
      }
      rooms.push(new Rect(prevVertical + 1, prevHorizon + 1, this.width - 2, horizon));
      prevHorizon = horizon
      prevVertical = 0
    }
    for (const vertical of verticalLines.sort((a, b) => a - b)) {
      rooms.push(new Rect(prevVertical + 1, prevHorizon + 1, vertical, this.height - 2));
      prevVertical = vertical
    }
    rooms.push(new Rect(prevVertical + 1, prevHorizon + 1, this.width - 2, this.height - 2));
    return rooms;
  }

  /**
   * 部屋を削って通路を作る
   * 各部屋の辺に通路を作成し、部屋同士を接続する
   * @param rooms 対象の部屋配列
   * @returns 部屋と通路をペアにした配列
   */
  public makeCorridor(rooms: Rect[]): RoomWithCorridors[] {
    if (rooms.length <= 0) {
      return [];
    }

    const newRooms: RoomWithCorridors[] = [];
    for (let room of rooms) {
      const corridors = []
      // 部屋のいくつの辺に通路を作るか
      const corNum = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4][getRandomInt(0, 24)];
      const directionArray = arrayShuffle([MapDirection.EAST, MapDirection.SOUTH, MapDirection.WEST, MapDirection.NORTH].slice())
      for (let i = 0; i < corNum; i++) {
        let cond = true;
        let corridor;
        for (let j = 0; j < 4 && cond && directionArray.length !== 0; j++) {
          const isConflict = (pos: { x: integer, y: integer }, direction: string) => newRooms.some(val =>
            val.corridors.some(v =>
              (pos[direction as keyof typeof pos] + 1 === v[(direction + '1') as keyof Rect] || pos[direction as keyof typeof pos] - 1 === v[(direction + '2') as keyof Rect])
              && (direction === 'x' ? (v.y2 - pos.y) : (v.x2 - pos.x)) > 1
            )
          )
          const direction = directionArray.pop()
          const tempRoom = new Rect(room)
          switch (direction) {
            // 東
            case MapDirection.EAST:
              if (room.x2 === this.width - 2 || room.x2 - room.x1 <= this.minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x2, room.y1, room.x2, room.y2);
              tempRoom.x2 -= 1
              cond = isConflict({ x: room.x2, y: room.y1 }, 'x');
              break;
            // 南
            case MapDirection.SOUTH:
              if (room.y2 === this.height - 2 || room.y2 - room.y1 <= this.minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x1, room.y2, room.x2, room.y2);
              tempRoom.y2 -= 1
              cond = isConflict({ x: room.x1, y: room.y2 }, 'y');
              break;
            // 西
            case MapDirection.WEST:
              if (room.x1 === 1 || room.x2 - room.x1 <= this.minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x1, room.y1, room.x1, room.y2);
              tempRoom.x1 += 1
              cond = isConflict({ x: room.x1, y: room.y1 }, 'x');
              break;
            // 北
            case MapDirection.NORTH:
              if (room.y1 === 1 || room.y2 - room.y1 <= this.minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x1, room.y1, room.x2, room.y1);
              tempRoom.y1 += 1
              cond = isConflict({ x: room.x1, y: room.y1 }, 'y');
              break;
          }
          if (!cond && corridor) {
            corridors.push(corridor)
            room = tempRoom
          }
        }
      }

      newRooms.push({ room, corridors });
    }

    return newRooms;
  }

  /**
   * マップの各マスに壁と扉を設定する
   * 部屋と通路の配置に基づいて壁の配置を決定し、扉を配置する
   *
   * 扉配置は Union-Find による MST + 冗長辺の確率復活法を用いる:
   * 1. Phase A の壁開放と通路同士の接続を終えた時点で、セル単位の Union-Find を構築する
   * 2. 各部屋の 4 方向について扉候補位置を一度ずつ検討し、両側セルが別コンポーネントなら必ず設置（MST）
   * 3. 既に同じコンポーネントに属する候補は `extraDoorRate` の確率でのみ設置（ループ復活）
   *
   * @param roomsWithCorridors 部屋と通路をペアにした配列
   * @param extraDoorRate MST 後に冗長な扉を追加する確率（0..1、既定 0.3）
   */
  public setWall(roomsWithCorridors: RoomWithCorridors[], extraDoorRate: number = 0.3): void {
    const dungeon = this.dungeon;
    const _set = function (x: integer, y: integer, rect: Rect) {
      let val = 0;
      if (x === rect.x1) {
        val += 4;
      }
      if (x === rect.x2) {
        val += 1;
      }
      if (y === rect.y1) {
        val += 8;
      }
      if (y === rect.y2) {
        val += 2;
      }

      return val
    }
    // 適当な部屋を進入禁止にする
    const length = Math.sqrt(roomsWithCorridors.length) - 1
    const blocked: integer[] = []
    for (let i = 0; i < length; i++) {
      if (Math.random() < 0.6) {
        const temp = getRandomInt(0, roomsWithCorridors.length)
        if (!blocked.some(val => ((val - 1 <= temp && temp <= val + 1) || (val - 1 - length <= temp && temp <= val + 1 - length) || (val - 1 + length <= temp && temp <= val + 1 + length)))) {
          blocked.push(temp)
        }
      }
    }
    // 非進入禁止部屋が全て連結になるよう保証する（孤立部屋とメインコンポーネントの間の最短路上にある進入禁止部屋を解除する）
    {
      const isBlocked = (i: integer) => blocked.some(v => v === i);
      // 通路が部屋の境界に隣接しているか（y/x 範囲が重なる）
      const corridorTouchesRoom = (c: Rect, room: Rect): boolean => {
        if (c.x1 === room.x2 + 1 && c.y1 <= room.y2 && c.y2 >= room.y1) return true;
        if (c.x2 + 1 === room.x1 && c.y1 <= room.y2 && c.y2 >= room.y1) return true;
        if (c.y1 === room.y2 + 1 && c.x1 <= room.x2 && c.x2 >= room.x1) return true;
        if (c.y2 + 1 === room.y1 && c.x1 <= room.x2 && c.x2 >= room.x1) return true;
        return false;
      };
      // isContact は非対称なため双方向チェック、さらに通路経由の隣接も考慮する
      const getNeighbors = (i: integer): integer[] => {
        const result: integer[] = [];
        const ri = roomsWithCorridors[i];
        for (let j = 0; j < roomsWithCorridors.length; j++) {
          if (i === j) continue;
          const rj = roomsWithCorridors[j];
          if (ri.room.isContact(rj.room) || rj.room.isContact(ri.room) ||
              ri.corridors.some(c => corridorTouchesRoom(c, rj.room)) ||
              rj.corridors.some(c => corridorTouchesRoom(c, ri.room))) {
            result.push(j);
          }
        }
        return result;
      };
      for (;;) {
        const nonBlocked = roomsWithCorridors.map((_, i) => i).filter(i => !isBlocked(i));
        if (nonBlocked.length === 0) break;
        // 最初の非進入禁止部屋から BFS で到達可能な部屋集合を求める
        const mainComponent = new Set<integer>();
        const bfsQueue = [nonBlocked[0]];
        while (bfsQueue.length > 0) {
          const curr = bfsQueue.shift()!;
          if (mainComponent.has(curr)) continue;
          mainComponent.add(curr);
          for (const n of getNeighbors(curr)) {
            if (!isBlocked(n)) bfsQueue.push(n);
          }
        }
        // 孤立した非進入禁止部屋を探す
        const orphan = nonBlocked.find(i => !mainComponent.has(i));
        if (orphan === undefined) break;
        // orphan から全部屋（進入禁止含む）を辿る BFS でメインコンポーネントへの最短路を探す
        const prev = new Map<integer, integer | null>();
        const pathQueue: integer[] = [orphan];
        prev.set(orphan, null);
        let bridgeEnd = -1;
        outer: while (pathQueue.length > 0) {
          const curr = pathQueue.shift()!;
          for (const n of getNeighbors(curr)) {
            if (prev.has(n)) continue;
            prev.set(n, curr);
            if (mainComponent.has(n)) { bridgeEnd = n; break outer; }
            pathQueue.push(n);
          }
        }
        if (bridgeEnd === -1) break; // 到達不能（フォールバック）
        // 経路上の進入禁止部屋を解除する（bridgeEnd から orphan へ遡る）
        let cur = bridgeEnd;
        while (prev.get(cur) !== null) {
          const p = prev.get(cur)!;
          const idx = blocked.indexOf(cur);
          if (idx !== -1) blocked.splice(idx, 1);
          cur = p;
        }
      }
    }
    // ランダムに部屋を繋げる
    const connected = new Map<integer, Set<integer>>(),
      _addConnected = (roomNumber: integer, direction: integer) => {
        if (connected.has(roomNumber)) {
          connected.get(roomNumber)?.add(direction)
        } else {
          const tempDirection = new Set<integer>();
          tempDirection.add(direction)
          connected.set(roomNumber, tempDirection)
        }
      }
    for (let i = 0; i < roomsWithCorridors.length; i++) {
      const temp = getRandomInt(0, roomsWithCorridors.length),
        direction = getRandomDirection();
      if (blocked.some(v => v === temp)) {
        continue;
      }
      const room = roomsWithCorridors[temp].room
      if (direction === MapDirection.EAST) {
        // 東
        if (temp + 1 < roomsWithCorridors.length && room.isContact(roomsWithCorridors[temp + 1].room) && !blocked.some(v => v === (temp + 1))) {
          _addConnected(temp, 1);
          _addConnected(temp + 1, 4);
        }
      } else if (direction === MapDirection.SOUTH) {
        // 南
        for (let j = temp + 2; j < roomsWithCorridors.length; j++) {
          if (roomsWithCorridors[j].room.y1 < room.y2) {
            continue;
          }
          if (room.y2 + 2 < roomsWithCorridors[j].room.y1 && room.x2 < roomsWithCorridors[j].room.x1) {
            break;
          }
          if (room.isContact(roomsWithCorridors[j].room) && !blocked.some(v => v === j)) {
            _addConnected(temp, 2);
            _addConnected(j, 8);
          }
        }
      } else if (direction === MapDirection.WEST) {
        // 西
        if (temp - 1 >= 0 && room.isContact(roomsWithCorridors[temp - 1].room) && !blocked.some(v => v === (temp - 1))) {
          _addConnected(temp, 4);
          _addConnected(temp - 1, 1);
        }
      } else if (direction === MapDirection.NORTH) {
        // 北
        for (let j = temp - 2; j >= 0; j--) {
          if (roomsWithCorridors[j].room.y2 < room.y1) {
            continue;
          }
          if (room.y1 - 2 > roomsWithCorridors[j].room.y2 && room.x1 > roomsWithCorridors[j].room.x2) {
            break;
          }
          if (room.isContact(roomsWithCorridors[j].room) && !blocked.some(v => v === j)) {
            _addConnected(temp, 8);
            _addConnected(j, 2);
          }
        }
      }
    }

    // 壁を作る
    let roomCount = 0;
    const allCorridors = [];
    for (const roomWithCorridors of roomsWithCorridors) {
      const block = blocked.some(v => v === roomCount)
      let connect = 0
      const connectedTemp = connected.get(roomCount)
      if (connectedTemp) {
        for (const direction of connectedTemp) {
          connect |= direction;
        }
      }
      connect = ~connect;

      for (let i = roomWithCorridors.room.x1; i <= roomWithCorridors.room.x2; i++) {
        for (let j = roomWithCorridors.room.y1; j <= roomWithCorridors.room.y2; j++) {
          dungeon.setAt(i, j, block ? -1 : (_set(i, j, roomWithCorridors.room) & connect))
        }
      }
      for (const corridor of roomWithCorridors.corridors) {
        for (let i = corridor.x1; i <= corridor.x2; i++) {
          for (let j = corridor.y1; j <= corridor.y2; j++) {
            dungeon.setAt(i, j, _set(i, j, corridor))
          }
        }
        allCorridors.push(corridor)
      }
      roomCount++;
    }
    allCorridors.sort((rect1, rect2) => {
      if (rect1.x1 - rect2.x2 === 0) {
        return rect1.y1 - rect2.y2
      } else {
        return rect1.x1 - rect2.x2
      }
    })
    // 通路を繋げる
    for (let i = 0; i < allCorridors.length; i++) {
      const corridor = allCorridors[i];
      for (let j = i + 1; j < allCorridors.length; j++) {
        const nextCorridor = allCorridors[j]
        if (nextCorridor.x1 <= corridor.x1 && corridor.x2 <= nextCorridor.x2) {
          if (nextCorridor.y1 - 1 === corridor.y2) {
            for (let k = corridor.x1; k <= corridor.x2; k++) {
              dungeon.updateAt(k, corridor.y2, -2);
              dungeon.updateAt(k, corridor.y2 + 1, -8);
            }
          } else if (nextCorridor.y2 + 1 === corridor.y1) {
            for (let k = corridor.x1; k <= corridor.x2; k++) {
              dungeon.updateAt(k, corridor.y1, -8);
              dungeon.updateAt(k, corridor.y1 - 1, -2);
            }
          }
        } else if (corridor.x1 <= nextCorridor.x1 && nextCorridor.x2 <= corridor.x2) {
          if (nextCorridor.y1 - 1 === corridor.y2) {
            for (let k = nextCorridor.x1; k <= nextCorridor.x2; k++) {
              dungeon.updateAt(k, corridor.y2, -2);
              dungeon.updateAt(k, corridor.y2 + 1, -8);
            }
          } else if (nextCorridor.y2 + 1 === corridor.y1) {
            for (let k = nextCorridor.x1; k <= nextCorridor.x2; k++) {
              dungeon.updateAt(k, corridor.y1, -8);
              dungeon.updateAt(k, corridor.y1 - 1, -2);
            }
          }
        } else if (nextCorridor.y1 <= corridor.y1 && corridor.y2 <= nextCorridor.y2) {
          if (nextCorridor.x1 - 1 === corridor.x2) {
            for (let k = corridor.y1; k <= corridor.y2; k++) {
              dungeon.updateAt(corridor.x2, k, -1);
              dungeon.updateAt(corridor.x2 + 1, k, -4);
            }
          } else if (nextCorridor.x2 + 1 === corridor.x1) {
            for (let k = corridor.y1; k <= corridor.y2; k++) {
              dungeon.updateAt(corridor.x1, k, -4);
              dungeon.updateAt(corridor.x1 - 1, k, -1);
            }
          }
        } else if (corridor.y1 <= nextCorridor.y1 && nextCorridor.y2 <= corridor.y2) {
          if (nextCorridor.x1 - 1 === corridor.x2) {
            for (let k = nextCorridor.y1; k <= nextCorridor.y2; k++) {
              dungeon.updateAt(corridor.x2, k, -1);
              dungeon.updateAt(corridor.x2 + 1, k, -4);
            }
          } else if (nextCorridor.x2 + 1 === corridor.x1) {
            for (let k = nextCorridor.y1; k <= nextCorridor.y2; k++) {
              dungeon.updateAt(corridor.x1, k, -4);
              dungeon.updateAt(corridor.x1 - 1, k, -1);
            }
          }
        }
      }
    }

    // 扉
    const existsDoor = (direction: integer, x1: integer, y1: integer, x2: integer, y2: integer) => {
      for (let i = x1; i <= x2; i++) {
        for (let j = y1; j <= y2; j++) {
          if ((dungeon.getAt(i, j) & direction) === direction) {
            return true;
          }
        }
      }
      return false;
    }

    // セル単位の Union-Find を構築し、Phase A の壁開放と通路同士接続による既存連結性を反映する
    const cellCount = this.width * this.height;
    const cellParent = new Int32Array(cellCount);
    for (let i = 0; i < cellCount; i++) cellParent[i] = i;
    const cellIndex = (x: integer, y: integer) => y * this.width + x;
    const findCell = (x: integer): integer => {
      let r = x;
      while (cellParent[r] !== r) r = cellParent[r];
      while (cellParent[x] !== r) {
        const next = cellParent[x];
        cellParent[x] = r;
        x = next;
      }
      return r;
    };
    const unionCell = (a: integer, b: integer): void => {
      const ra = findCell(a), rb = findCell(b);
      if (ra !== rb) cellParent[ra] = rb;
    };
    // 隣接セル間で壁が無ければ連結扱いとする（bit 1=東壁, 2=南壁, 4=西壁, 8=北壁）
    for (let y = 0; y < this.height; y++) {
      for (let x = 0; x < this.width; x++) {
        const v = dungeon.getAt(x, y);
        if (v === -1) continue;
        if (x + 1 < this.width) {
          const v2 = dungeon.getAt(x + 1, y);
          if (v2 !== -1 && (v & 1) === 0 && (v2 & 4) === 0) {
            unionCell(cellIndex(x, y), cellIndex(x + 1, y));
          }
        }
        if (y + 1 < this.height) {
          const v2 = dungeon.getAt(x, y + 1);
          if (v2 !== -1 && (v & 2) === 0 && (v2 & 8) === 0) {
            unionCell(cellIndex(x, y), cellIndex(x, y + 1));
          }
        }
      }
    }

    // MST + extraDoorRate で扉候補を採否判定する。両側セルが別コンポーネントなら必ず採用、
    // 同一コンポーネントなら extraDoorRate の確率で採用する
    const tryPlaceDoor = (
      x1: integer, y1: integer, bit1: integer,
      x2: integer, y2: integer, bit2: integer,
    ): void => {
      const idx1 = cellIndex(x1, y1);
      const idx2 = cellIndex(x2, y2);
      const sameComponent = findCell(idx1) === findCell(idx2);
      if (sameComponent && Math.random() >= extraDoorRate) return;
      dungeon.setAt(x1, y1, dungeon.getAt(x1, y1) | bit1);
      dungeon.setAt(x2, y2, dungeon.getAt(x2, y2) | bit2);
      if (!sameComponent) unionCell(idx1, idx2);
    };

    // 各部屋について 4 方向の境界を確認し、扉設置可能な全位置から 1 つ抽選して
    // MST + extraDoorRate 判定（tryPlaceDoor 内で実施）にかける
    for (const roomWithCorridors of roomsWithCorridors) {
      const room = roomWithCorridors.room;
      // 東 (wallA=1=東壁, wallB=4=西壁)
      if (!existsDoor(16, room.x2, room.y1, room.x2, room.y2)) {
        const positions: { y: integer }[] = [];
        for (let y = room.y1; y <= room.y2; y++) {
          const va = dungeon.getAt(room.x2, y);
          const vb = dungeon.getAt(room.x2 + 1, y);
          if (va === -1 || vb === -1) continue;
          if ((va & 1) !== 1 || (vb & 4) !== 4) continue;
          positions.push({ y });
        }
        if (positions.length > 0) {
          const y = positions[getRandomInt(0, positions.length)].y;
          tryPlaceDoor(room.x2, y, 16, room.x2 + 1, y, 64);
        }
      }
      // 南 (wallA=2=南壁, wallB=8=北壁)
      if (!existsDoor(32, room.x1, room.y2, room.x2, room.y2)) {
        const positions: { x: integer }[] = [];
        for (let x = room.x1; x <= room.x2; x++) {
          const va = dungeon.getAt(x, room.y2);
          const vb = dungeon.getAt(x, room.y2 + 1);
          if (va === -1 || vb === -1) continue;
          if ((va & 2) !== 2 || (vb & 8) !== 8) continue;
          positions.push({ x });
        }
        if (positions.length > 0) {
          const x = positions[getRandomInt(0, positions.length)].x;
          tryPlaceDoor(x, room.y2, 32, x, room.y2 + 1, 128);
        }
      }
      // 西 (wallA=4=西壁, wallB=1=東壁)
      if (!existsDoor(64, room.x1, room.y1, room.x1, room.y2)) {
        const positions: { y: integer }[] = [];
        for (let y = room.y1; y <= room.y2; y++) {
          const va = dungeon.getAt(room.x1, y);
          const vb = dungeon.getAt(room.x1 - 1, y);
          if (va === -1 || vb === -1) continue;
          if ((va & 4) !== 4 || (vb & 1) !== 1) continue;
          positions.push({ y });
        }
        if (positions.length > 0) {
          const y = positions[getRandomInt(0, positions.length)].y;
          tryPlaceDoor(room.x1, y, 64, room.x1 - 1, y, 16);
        }
      }
      // 北 (wallA=8=北壁, wallB=2=南壁)
      if (!existsDoor(128, room.x1, room.y1, room.x2, room.y1)) {
        const positions: { x: integer }[] = [];
        for (let x = room.x1; x <= room.x2; x++) {
          const va = dungeon.getAt(x, room.y1);
          const vb = dungeon.getAt(x, room.y1 - 1);
          if (va === -1 || vb === -1) continue;
          if ((va & 8) !== 8 || (vb & 2) !== 2) continue;
          positions.push({ x });
        }
        if (positions.length > 0) {
          const x = positions[getRandomInt(0, positions.length)].x;
          tryPlaceDoor(x, room.y1, 128, x, room.y1 - 1, 32);
        }
      }
    }
  }

  /**
   * 部屋の中にランダムで 1x1 の障害物（進入禁止セル）を配置する
   *
   * 条件:
   * - 部屋内部のセル（部屋の外周セルを除く）のみが対象。通路には配置しない
   * - 配置候補セルおよびその周囲 8 セル（Chebyshev 距離 1）に扉ビットを持つセルが
   *   含まれている場合は除外する（扉の通行を阻害しないため）
   * - 進入禁止化された部屋は対象外
   *
   * 配置数はマップサイズから計算する: `base = floor(width * height / 50)` を基準値とし、
   * `[-base, base]` の範囲の三角分布オフセット（重みは `base + 1 - |k|`、k=0 で最大、両端で 1）を
   * 加算する。これにより最低でも 0、最大で `2 * base` の範囲で 0 寄りに偏った値が得られる
   * （例: 10x10 マップで base=2 となり 2±2 程度、20x20 マップで base=8 となり 8±8 程度）。
   * 条件を満たす候補が無い場合は配置をスキップする。
   *
   * @param roomsWithCorridors 部屋と通路のペアの配列
   */
  public placeObstacles(roomsWithCorridors: RoomWithCorridors[]): void {
    const dungeon = this.dungeon;
    const usableArea = (this.width - 2) * (this.height - 2);
    const base = Math.floor(usableArea / 50);

    // base を中心とした三角分布の重み付きオフセット配列を構築する
    // - オフセットの範囲は [-base, base]（最低オフセットを足すと配置数が 0 になる）
    // - 各オフセット k の重みは (base + 1) - |k|（k=0 で最大、両端で 1）
    // 例: base=2 → [-2,-1,-1,0,0,0,1,1,2] / base=3 → [-3,-2,-2,-1,-1,-1,0,0,0,0,1,1,1,2,2,3]
    const offsetTable: integer[] = [];
    for (let k = -base; k <= base; k++) {
      const weight = (base + 1) - Math.abs(k);
      for (let i = 0; i < weight; i++) {
        offsetTable.push(k);
      }
    }
    const offset = offsetTable[getRandomInt(0, offsetTable.length)];
    const count = Math.max(0, base + offset);
    if (count === 0) return;

    const candidates: { x: integer, y: integer }[] = [];
    for (const roomWithCorridors of roomsWithCorridors) {
      const room = roomWithCorridors.room;
      // 進入禁止化された部屋は -1 で埋められているのでスキップ
      if (dungeon.getAt(room.x1, room.y1) === -1) continue;

      // 部屋の外周を除いた内部セルを候補にする（通路は外周の外にあるため自動的に除外される）
      for (let x = room.x1 + 1; x <= room.x2 - 1; x++) {
        for (let y = room.y1 + 1; y <= room.y2 - 1; y++) {
          if (dungeon.getAt(x, y) === -1) continue;

          // 周囲 3x3 範囲に扉ビット (0xF0) を持つセルがあれば除外
          let nearDoor = false;
          for (let dx = -1; dx <= 1 && !nearDoor; dx++) {
            for (let dy = -1; dy <= 1 && !nearDoor; dy++) {
              const v = dungeon.getAt(x + dx, y + dy);
              if (v !== -1 && (v & 0xF0) !== 0) {
                nearDoor = true;
              }
            }
          }
          if (nearDoor) continue;

          candidates.push({ x, y });
        }
      }
    }

    if (candidates.length === 0) return;

    arrayShuffle(candidates);
    const placeCount = Math.min(count, candidates.length);
    for (let i = 0; i < placeCount; i++) {
      const { x, y } = candidates[i];
      dungeon.setAt(x, y, -1);
      // 障害物に隣接するセルへ障害物方向の壁ビットを追加する
      // 障害物セルは部屋内部にあるため、隣接 4 セルも同じ部屋内 (-1 でない) のはず
      const west = dungeon.getAt(x - 1, y);
      if (west !== -1) dungeon.setAt(x - 1, y, west | 1);
      const east = dungeon.getAt(x + 1, y);
      if (east !== -1) dungeon.setAt(x + 1, y, east | 4);
      const north = dungeon.getAt(x, y - 1);
      if (north !== -1) dungeon.setAt(x, y - 1, north | 2);
      const south = dungeon.getAt(x, y + 1);
      if (south !== -1) dungeon.setAt(x, y + 1, south | 8);
    }
  }

  /**
   * 指定した部屋の 4 辺を走査し、扉ビットを持つセル位置と方向を返す
   *
   * 扉ビットの規約は `16 << direction`（EAST=16, SOUTH=32, WEST=64, NORTH=128）。
   * 同じ部屋に複数の扉がある場合は全て返す。
   *
   * @param room 走査対象の部屋
   * @returns 扉のリスト（部屋側セル座標と方向）
   */
  public findDoorsInRoom(room: Rect): { x: integer, y: integer, dir: MapDirection }[] {
    const dungeon = this.dungeon;
    const result: { x: integer, y: integer, dir: MapDirection }[] = [];
    // EAST 辺
    for (let y = room.y1; y <= room.y2; y++) {
      const v = dungeon.getAt(room.x2, y);
      if (v !== -1 && (v & 16) !== 0) result.push({ x: room.x2, y, dir: MapDirection.EAST });
    }
    // SOUTH 辺
    for (let x = room.x1; x <= room.x2; x++) {
      const v = dungeon.getAt(x, room.y2);
      if (v !== -1 && (v & 32) !== 0) result.push({ x, y: room.y2, dir: MapDirection.SOUTH });
    }
    // WEST 辺
    for (let y = room.y1; y <= room.y2; y++) {
      const v = dungeon.getAt(room.x1, y);
      if (v !== -1 && (v & 64) !== 0) result.push({ x: room.x1, y, dir: MapDirection.WEST });
    }
    // NORTH 辺
    for (let x = room.x1; x <= room.x2; x++) {
      const v = dungeon.getAt(x, room.y1);
      if (v !== -1 && (v & 128) !== 0) result.push({ x, y: room.y1, dir: MapDirection.NORTH });
    }
    return result;
  }
}
