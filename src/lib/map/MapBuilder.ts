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
   * @param roomsWithCorridors 部屋と通路をペアにした配列
   */
  public setWall(roomsWithCorridors: RoomWithCorridors[]): void {
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
    for (const roomWithCorridors of roomsWithCorridors) {
      const room = roomWithCorridors.room;
      if (!existsDoor(16, room.x2, room.y1, room.x2, room.y2)) {
        const y = getRandomInt(room.y1, room.y2 + 1)
        if ((dungeon.getAt(room.x2, y) & 1) === 1 && (dungeon.getAt(room.x2 + 1, y) & 4) === 4 && dungeon.getAt(room.x2 + 1, y) !== -1) {
          dungeon.setAt(room.x2, y, dungeon.getAt(room.x2, y) | 16);
          dungeon.setAt(room.x2 + 1, y, dungeon.getAt(room.x2 + 1, y) | 64);
        }
      }
      if (!existsDoor(32, room.x1, room.y2, room.x2, room.y2)) {
        const x = getRandomInt(room.x1, room.x2 + 1)
        if ((dungeon.getAt(x, room.y2) & 2) === 2 && (dungeon.getAt(x, room.y2 + 1) & 8) === 8 && dungeon.getAt(x, room.y2 + 1) !== -1) {
          dungeon.setAt(x, room.y2, dungeon.getAt(x, room.y2) | 32);
          dungeon.setAt(x, room.y2 + 1, dungeon.getAt(x, room.y2 + 1) | 128);
        }
      }
      if (!existsDoor(64, room.x1, room.y1, room.x1, room.y2)) {
        const y = getRandomInt(room.y1, room.y2 + 1)
        if ((dungeon.getAt(room.x1, y) & 4) === 4 && (dungeon.getAt(room.x1 - 1, y) & 1) === 1 && dungeon.getAt(room.x1 - 1, y) !== -1) {
          dungeon.setAt(room.x1, y, dungeon.getAt(room.x1, y) | 64);
          dungeon.setAt(room.x1 - 1, y, dungeon.getAt(room.x1 - 1, y) | 16);
        }
      }
      if (!existsDoor(128, room.x1, room.y1, room.x2, room.y1)) {
        const x = getRandomInt(room.x1, room.x2 + 1)
        if ((dungeon.getAt(x, room.y1) & 8) === 8 && (dungeon.getAt(x, room.y1 - 1) & 2) === 2 && dungeon.getAt(x, room.y1 - 1) !== -1) {
          dungeon.setAt(x, room.y1, dungeon.getAt(x, room.y1) | 128);
          dungeon.setAt(x, room.y1 - 1, dungeon.getAt(x, room.y1 - 1) | 32);
        }
      }
    }
  }
}
