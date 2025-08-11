'use strict';

/**
 * 指定した範囲内のランダムな整数を生成する
 * @param min 最小値（含む）
 * @param max 最大値（含まない）
 * @returns 生成されたランダムな整数
 */
function getRandomInt(min: integer, max: integer): integer {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

/**
 * Fisher-Yatesアルゴリズムを使用して配列をシャッフルする
 * @param array シャッフルする配列
 * @returns シャッフルされた配列
 * @see https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A3%E3%83%83%E3%82%B7%E3%83%A3%E3%83%BC%E2%80%93%E3%82%A4%E3%82%A7%E3%83%BC%E3%83%84%E3%81%AE%E3%82%B7%E3%83%A3%E3%83%83%E3%83%95%E3%83%AB
 */
function arrayShuffle<T>(array: Array<T>): Array<T> {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

class Rect {
  public x1: integer;
  public x2: integer;
  public y1: integer;
  public y2: integer;
  constructor(x1: integer | Rect, y1: integer = 0, x2: integer = 0, y2: integer = 0) {
    if (x1 instanceof Rect) {
      this.x1 = x1.x1;
      this.y1 = x1.y1;
      this.x2 = x1.x2;
      this.y2 = x1.y2;
      return
    }
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }

  /**
   * 指定した矩形と一辺が完全に一致しているか判定する
   * @param rect 判定する矩形
   * @returns 一辺が完全に一致している場合true
   */
  isContact(rect: Rect) {
    if (rect.y1 === this.y1 && rect.y2 === this.y2 && rect.x2 === this.x1 + 1) {
      return true;
    }

    if (rect.x1 === this.x1 && rect.x2 === this.x2 && rect.y1 === this.y2 + 1) {
      return true;
    }

    if (rect.y1 === this.y1 && rect.y2 === this.y2 && rect.x2 + 1 === this.x1) {
      return true;
    }

    if (rect.x1 === this.x1 && rect.x2 === this.x2 && rect.y2 + 1 === this.y1) {
      return true;
    }

    return false;
  }
}

/**
 * オブジェクトのイベントディスパッチャー
 * @param dungeon ダンジョンマップ
 * @param object マップオブジェクト
 * @returns falseの場合、このマップオブジェクトを破棄する
 */
type ObjectEvent = (dungeon: DungeonMap, object: MapObject) => boolean;
export class MapObject {
  public mark: string = 'o';
  public color: integer = 0xFFFFFF;
  public alpha: integer = 1;
  public events: Map<string, ObjectEvent> = new Map<string, ObjectEvent>();
  public x: integer = -1;
  public y: integer = -1;
  public sphere: boolean = false;
  public visible: boolean = true;
}

export function newMapEvent(eventName: string, event: ObjectEvent, parent?: Map<string, ObjectEvent>) {
  if (!parent) {
    parent = new Map<string, ObjectEvent>();
  }
  parent.set(eventName, event);
  return parent;
}

export const MapDirection = {
  EAST: 0,
  SOUTH: 1,
  WEST: 2,
  NORTH: 3,
} as const;
export type MapDirection = typeof MapDirection[keyof typeof MapDirection]
/**
 * ランダムな方向を取得する
 * @returns ランダムに選択された方向
 */
export const getRandomDirection = (): MapDirection => {
  switch (getRandomInt(0, 4)) {
    case 0:
      return MapDirection.EAST;
    case 1:
      return MapDirection.SOUTH;
    case 2:
      return MapDirection.WEST;
    case 3:
      return MapDirection.NORTH;
  }

  return MapDirection.EAST;
}
/**
 * 指定した方向を時計回りに回転させる
 * @param direction 回転させる元の方向
 * @param value 回転量（1=90度時計回り）
 * @returns 回転後の方向
 */
export const rotateDirection = (direction: MapDirection, value: number) => {
  switch ((Number(direction) + value) % 4) {
    case 0:
      return MapDirection.EAST;
    case 1:
      return MapDirection.SOUTH;
    case 2:
      return MapDirection.WEST;
    case 3:
      return MapDirection.NORTH;
  }

  console.error('rotateDirection');
  return direction;
}

export type RandomPosConfig = {
  withoutCorridor?: boolean,
  withoutDoor?: boolean,
  withoutPlayer?: boolean,
  excludePositionList?: integer[][]
}

/**
 * ダンジョンマップ
 * 
 * 管理する物
 * - ダンジョンの部屋と通路、扉の位置
 * - プレイヤーの位置と移動
 * - 配置しているオブジェクトの位置とイベント呼び出し
 */
export class DungeonMap {
  private _map: integer[];
  private _mapFog: integer[];
  private _mapWalked: integer[];
  private _width: integer;
  private _height: integer;
  private _enableFog: boolean = true;

  private _minRoomLength: integer = 3;
  private _viewRange: integer = 3;

  private _rooms: Rect[];
  private _roomsWithCorridors: {
    room: Rect,
    corridors: Rect[],
  }[];

  private _player: {
    x: integer,
    y: integer,
    direction: MapDirection,
  };

  private _object_counter: integer = 0;
  private _objects: Map<integer, MapObject>;
  private _mapObjects: Map<integer, MapObject[]>;

  constructor(width: integer, height: integer, viewRange = 3, enableFog = true) {
    this._width = width + 2;
    this._height = height + 2;
    this._viewRange = viewRange;
    this._enableFog = enableFog;
  }

  /**
   * ダンジョンマップを初期化する
   * 全てのマップデータをクリアし、プレイヤーの初期位置を設定する
   */
  public init() {
    this._map = [];
    this._mapFog = [];
    this._mapWalked = [];
    this._rooms = [];
    this._roomsWithCorridors = [];
    this._objects = new Map<integer, MapObject>();
    this._mapObjects = new Map<integer, MapObject[]>();
    const fog = this._enableFog ? 1 : 0;
    for (let i = 0; i < this._width * this._height; i++) {
      this._map[i] = -1;
      this._mapFog[i] = fog;
      this._mapWalked[i] = 0;
    }
    this._player = {
      x: 0,
      y: 0,
      direction: MapDirection.EAST,
    };
  }

  /**
   * X,Y座標から1次元配列のインデックスを計算する
   * @param x X座標
   * @param y Y座標
   * @returns 1次元配列のインデックス、範囲外の場合undefined
   */
  private _calcPos(x: integer, y: integer) {
    const pos = (y + 0) * this._width + x;
    return (pos >= this._map.length || pos < 0) ? undefined : pos;
  }

  /**
   * 指定座標のマップ値を取得する
   * @param x X座標
   * @param y Y座標
   * @returns マップ値、範囲外の場合-1
   */
  public getAt(x: integer, y: integer): integer {
    const pos = this._calcPos(x, y);
    return pos === undefined ? -1 : this._map[pos];
  }

  /**
   * 指定座標のフォグ状態を取得する
   * @param x X座標
   * @param y Y座標
   * @returns フォグ値（0=見える、1=見えない）、範囲外の場合1
   */
  public getFogAt(x: integer, y: integer): integer {
    const pos = this._calcPos(x, y);
    return pos === undefined ? 1 : this._mapFog[pos];
  }

  /**
   * 指定座標のフォグ状態を設定する
   * @param x X座標
   * @param y Y座標
   * @param value フォグ値（0=見える、1=見えない）
   */
  public setFogAt(x: integer, y: integer, value: integer): void {
    const pos = this._calcPos(x, y);
    if (pos !== undefined) {
      this._mapFog[pos] = value;
    }
  }

  /**
   * 指定座標の歩行済み状態を取得する
   * @param x X座標
   * @param y Y座標
   * @returns 歩行済み値（0=未歩行、1=歩行済み）、範囲外の場合1
   */
  public getWalkedAt(x: integer, y: integer): integer {
    const pos = this._calcPos(x, y);
    return pos === undefined ? 1 : this._mapWalked[pos];
  }

  /**
   * 指定座標の歩行済み状態を設定する
   * @param x X座標
   * @param y Y座標
   * @param value 歩行済み値（0=未歩行、1=歩行済み）
   */
  public setWalkedAt(x: integer, y: integer, value: integer): void {
    const pos = this._calcPos(x, y);
    if (pos !== undefined) {
      this._mapWalked[pos] = value;
    }
  }

  /**
   * 指定座標のマップ値を設定する
   * @param x X座標
   * @param y Y座標
   * @param value マップ値
   */
  public setAt(x: integer, y: integer, value: integer): void {
    const pos = this._calcPos(x, y);
    if (pos !== undefined) {
      this._map[pos] = value;
    }
  }

  /**
   * マップの幅を取得する（境界を除く）
   * @returns マップの幅
   */
  public getWidth(): integer {
    return this._width - 2;
  }

  /**
   * マップの高さを取得する（境界を除く）
   * @returns マップの高さ
   */
  public getHeight(): integer {
    return this._height - 2;
  }

  /**
   * 指定座標のマップ値に値を加算する
   * @param x X座標
   * @param y Y座標
   * @param value 加算する値
   */
  public updateAt(x: integer, y: integer, value: integer): void {
    const pos = this._calcPos(x, y);
    if (pos !== undefined) {
      this._map[pos] += value;
    }
  }

  /**
   * プレイヤーの現在位置と向きを取得する
   * @returns プレイヤーの位置情報（x座標、y座標、向き）
   */
  public getPlayerPos(): { x: integer, y: integer, direction: MapDirection } {
    return {
      x: this._player.x,
      y: this._player.y,
      direction: this._player.direction,
    }
  }

  /**
   * ダンジョンに部屋を生成する
   * 横方向と縦方向に分割線を配置し、矩形の部屋を作成する
   */
  public makeRoom(): void {
    if (this._map.length <= 0) {
      return
    }

    const minRoomLength = this._minRoomLength;

    const hMax = Math.floor((this._height - 3) / (minRoomLength + 1))
    const vMax = Math.floor((this._width - 3) / (minRoomLength + 1))

    // 横方向に切る
    const horizontalLines: integer[] = [];
    const hLines: integer[] = [];
    for (let i = minRoomLength; i < this._height - 2 - minRoomLength; i++) {
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
    for (let i = minRoomLength; i < this._width - 2 - minRoomLength; i++) {
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
      rooms.push(new Rect(prevVertical + 1, prevHorizon + 1, this._width - 2, horizon));
      prevHorizon = horizon
      prevVertical = 0
    }
    for (const vertical of verticalLines.sort((a, b) => a - b)) {
      rooms.push(new Rect(prevVertical + 1, prevHorizon + 1, vertical, this._height - 2));
      prevVertical = vertical
    }
    rooms.push(new Rect(prevVertical + 1, prevHorizon + 1, this._width - 2, this._height - 2));
    this._rooms = rooms;
  }

  /**
   * 部屋を削って通路を作る
   * 各部屋の辺に通路を作成し、部屋同士を接続する
   */
  public makeCorridor() {
    if (this._map.length <= 0 || this._rooms.length <= 0) {
      return
    }

    const newRooms: { room: Rect, corridors: Rect[] }[] = [];
    for (let room of this._rooms) {
      const corridors = []
      // 部屋のいくつの辺に通路を作るか
      const corNum = [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4][getRandomInt(0, 24)];
      //console.log(room)
      //console.log(corNum)
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
          //console.log(direction)
          const tempRoom = new Rect(room)
          switch (direction) {
            // 東
            case MapDirection.EAST:
              if (room.x2 === this._width - 2 || room.x2 - room.x1 <= this._minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x2, room.y1, room.x2, room.y2);
              tempRoom.x2 -= 1
              cond = isConflict({ x: room.x2, y: room.y1 }, 'x');
              break;
            // 南
            case MapDirection.SOUTH:
              if (room.y2 === this._height - 2 || room.y2 - room.y1 <= this._minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x1, room.y2, room.x2, room.y2);
              tempRoom.y2 -= 1
              cond = isConflict({ x: room.x1, y: room.y2 }, 'y');
              break;
            // 西
            case MapDirection.WEST:
              if (room.x1 === 1 || room.x2 - room.x1 <= this._minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x1, room.y1, room.x1, room.y2);
              tempRoom.x1 += 1
              cond = isConflict({ x: room.x1, y: room.y1 }, 'x');
              break;
            // 北
            case MapDirection.NORTH:
              if (room.y1 === 1 || room.y2 - room.y1 <= this._minRoomLength) {
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

            // console.log('corridor')
            // console.log(corridor)
          }
        }
      }

      newRooms.push({ room, corridors });
    }

    this._roomsWithCorridors = newRooms;
    //console.dir(newRooms, { depth: null })
  }

  /**
   * マップの各マスに壁と扉を設定する
   * 部屋と通路の配置に基づいて壁の配置を決定し、扉を配置する
   */
  public setWall() {
    const roomsWithCorridors = this._roomsWithCorridors
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
      //console.log(connected)
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
          this.setAt(i, j, block ? -1 : (_set(i, j, roomWithCorridors.room) & connect))
        }
      }
      for (const corridor of roomWithCorridors.corridors) {
        for (let i = corridor.x1; i <= corridor.x2; i++) {
          for (let j = corridor.y1; j <= corridor.y2; j++) {
            this.setAt(i, j, _set(i, j, corridor))
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
              // console.log('first')
              // console.dir(corridor, { depth: null })
              // console.dir(nextCorridor, { depth: null })
              this.updateAt(k, corridor.y2, -2);
              this.updateAt(k, corridor.y2 + 1, -8);
            }
          } else if (nextCorridor.y2 + 1 === corridor.y1) {
            for (let k = corridor.x1; k <= corridor.x2; k++) {
              // console.log('second')
              // console.dir(corridor, { depth: null })
              // console.dir(nextCorridor, { depth: null })
              this.updateAt(k, corridor.y1, -8);
              this.updateAt(k, corridor.y1 - 1, -2);
            }
          }
        } else if (corridor.x1 <= nextCorridor.x1 && nextCorridor.x2 <= corridor.x2) {
          if (nextCorridor.y1 - 1 === corridor.y2) {
            for (let k = nextCorridor.x1; k <= nextCorridor.x2; k++) {
              // console.log('third')
              // console.dir(corridor, { depth: null })
              // console.dir(nextCorridor, { depth: null })
              this.updateAt(k, corridor.y2, -2);
              this.updateAt(k, corridor.y2 + 1, -8);
            }
          } else if (nextCorridor.y2 + 1 === corridor.y1) {
            for (let k = nextCorridor.x1; k <= nextCorridor.x2; k++) {
              // console.log('forth')
              // console.dir(corridor, { depth: null })
              // console.dir(nextCorridor, { depth: null })
              this.updateAt(k, corridor.y1, -8);
              this.updateAt(k, corridor.y1 - 1, -2);
            }
          }
        } else if (nextCorridor.y1 <= corridor.y1 && corridor.y2 <= nextCorridor.y2) {
          if (nextCorridor.x1 - 1 === corridor.x2) {
            for (let k = corridor.y1; k <= corridor.y2; k++) {
              // console.log('fifth')
              // console.dir(corridor, { depth: null })
              // console.dir(nextCorridor, { depth: null })
              this.updateAt(corridor.x2, k, -1);
              this.updateAt(corridor.x2 + 1, k, -4);
            }
          } else if (nextCorridor.x2 + 1 === corridor.x1) {
            for (let k = corridor.y1; k <= corridor.y2; k++) {
              // console.log('sixth')
              // console.dir(corridor, { depth: null })
              // console.dir(nextCorridor, { depth: null })
              this.updateAt(corridor.x1, k, -4);
              this.updateAt(corridor.x1 - 1, k, -1);
            }
          }
        } else if (corridor.y1 <= nextCorridor.y1 && nextCorridor.y2 <= corridor.y2) {
          if (nextCorridor.x1 - 1 === corridor.x2) {
            for (let k = nextCorridor.y1; k <= nextCorridor.y2; k++) {
              // console.log('seventh')
              // console.dir(corridor, { depth: null })
              // console.dir(nextCorridor, { depth: null })
              this.updateAt(corridor.x2, k, -1);
              this.updateAt(corridor.x2 + 1, k, -4);
            }
          } else if (nextCorridor.x2 + 1 === corridor.x1) {
            for (let k = nextCorridor.y1; k <= nextCorridor.y2; k++) {
              // console.log('eighth')
              // console.dir(corridor, { depth: null })
              // console.dir(nextCorridor, { depth: null })
              this.updateAt(corridor.x1, k, -4);
              this.updateAt(corridor.x1 - 1, k, -1);
            }
          }
        }
      }
    }

    // 扉
    const existsDoor = (direction: integer, x1: integer, y1: integer, x2: integer, y2: integer) => {
      for (let i = x1; i <= x2; i++) {
        for (let j = y1; j <= y2; j++) {
          if ((this.getAt(i, j) & direction) === direction) {
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
        if ((this.getAt(room.x2, y) & 1) === 1 && (this.getAt(room.x2 + 1, y) & 4) === 4 && this.getAt(room.x2 + 1, y) !== -1) {
          this.setAt(room.x2, y, this.getAt(room.x2, y) | 16);
          this.setAt(room.x2 + 1, y, this.getAt(room.x2 + 1, y) | 64);
        }
      }
      if (!existsDoor(32, room.x1, room.y2, room.x2, room.y2)) {
        const x = getRandomInt(room.x1, room.x2 + 1)
        if ((this.getAt(x, room.y2) & 2) === 2 && (this.getAt(x, room.y2 + 1) & 8) === 8 && this.getAt(x, room.y2 + 1) !== -1) {
          this.setAt(x, room.y2, this.getAt(x, room.y2) | 32);
          this.setAt(x, room.y2 + 1, this.getAt(x, room.y2 + 1) | 128);
        }
      }
      if (!existsDoor(64, room.x1, room.y1, room.x1, room.y2)) {
        const y = getRandomInt(room.y1, room.y2 + 1)
        if ((this.getAt(room.x1, y) & 4) === 4 && (this.getAt(room.x1 - 1, y) & 1) === 1 && this.getAt(room.x1 - 1, y) !== -1) {
          this.setAt(room.x1, y, this.getAt(room.x1, y) | 64);
          this.setAt(room.x1 - 1, y, this.getAt(room.x1 - 1, y) | 16);
        }
      }
      if (!existsDoor(128, room.x1, room.y1, room.x2, room.y1)) {
        const x = getRandomInt(room.x1, room.x2 + 1)
        if ((this.getAt(x, room.y1) & 8) === 8 && (this.getAt(x, room.y1 - 1) & 2) === 2 && this.getAt(x, room.y1 - 1) !== -1) {
          this.setAt(x, room.y1, this.getAt(x, room.y1) | 128);
          this.setAt(x, room.y1 - 1, this.getAt(x, room.y1 - 1) | 32);
        }
      }
    }
  }

  /**
   * デバッグ用にマップの状態をコンソールに出力する
   * @param doorOff trueの場合扉の表示を無効にする
   */
  public dump(doorOff = false) {
    let buffer = '';
    const bias = doorOff ? 15 : -1;
    const playerPos = this._calcPos(this._player.x, this._player.y);
    for (let i = 0; i < this._map.length; i++) {
      if (i === playerPos) {
        switch (this._player.direction) {
          case 0:
            buffer += '→';
            break;
          case 1:
            buffer += '↓';
            break;
          case 2:
            buffer += '←';
            break;
          case 3:
            buffer += '↑';
            break;
        }
        continue;
      }
      switch (this._map[i] & bias) {
        case -1 & bias:
          buffer += '☆';
          break;
        case 1:
          buffer += '┤';
          break;
        case 2:
          buffer += '┴';
          break;
        case 3:
          buffer += '┘';
          break;
        case 4:
          buffer += '├';
          break;
        case 5:
          buffer += '||';
          break;
        case 6:
          buffer += '└';
          break;
        case 7:
          buffer += '┻';
          break;
        case 8:
          buffer += '┬';
          break;
        case 9:
          buffer += '┐';
          break;
        case 10:
          buffer += '＝';
          break;
        case 11:
          buffer += '┫';
          break;
        case 12:
          buffer += '┌';
          break;
        case 13:
          buffer += '┳';
          break;
        case 14:
          buffer += '┣';
          break;
        case 15:
          buffer += '□';
          break;
        default:
          if (16 <= this._map[i] && this._map[i] <= 255) {
            buffer += '扉'
          } else {
            buffer += '　'
          }
          break;
      }
      if ((i + 1) % this._width === 0) {
        buffer += '\n';
      }
    }
    console.log(buffer)
  }

  /**
   * ダンジョン全体を構築する
   * 初期化、部屋生成、通路生成、壁設定、プレイヤー配置を順次実行する
   */
  public build() {
    this.init();
    this.makeRoom();
    this.makeCorridor();
    this.setWall();
    this.setPlayerRandom();
  }

  /**
   * プレイヤーの視界範囲内のフォグをクリアする
   * プレイヤーの向きと視界範囲に基づいて、見える範囲のフォグを除去する
   */
  public clearFogWithinPlayer(): void {
    const direction = this._player.direction;

    let x = this._player.x, y = this._player.y;
    for (let i = 0; i < this._viewRange; i++) {
      this.setFogAt(x, y, 0);
      const value = this.getAt(x, y);

      switch (direction) {
        case MapDirection.EAST:
          if (!(value & 2)) {
            this.setFogAt(x, y + 1, 0);
            if (!(this.getAt(x, y + 1) & 1)) {
              this.setFogAt(x + 1, y + 1, 0);
            }
          } else if (value & 32) {
            this.setFogAt(x, y + 1, 0);
          }
          if (!(value & 8)) {
            this.setFogAt(x, y - 1, 0);
            if (!(this.getAt(x, y - 1) & 1)) {
              this.setFogAt(x + 1, y - 1, 0);
            }
          } else if (value & 128) {
            this.setFogAt(x, y - 1, 0);
          }
          x += 1;
          if (value & 1) {
            if (value & 16) {
              this.setFogAt(x, y, 0);
            }
            return;
          }
          break;
        case MapDirection.SOUTH:
          if (!(value & 4)) {
            this.setFogAt(x - 1, y, 0);
            if (!(this.getAt(x - 1, y) & 2)) {
              this.setFogAt(x - 1, y + 1, 0);
            }
          } else if (value & 64) {
            this.setFogAt(x - 1, y, 0);
          }
          if (!(value & 1)) {
            this.setFogAt(x + 1, y, 0);
            if (!(this.getAt(x + 1, y) & 2)) {
              this.setFogAt(x + 1, y + 1, 0);
            }
          } else if (value & 16) {
            this.setFogAt(x + 1, y, 0);
          }
          y += 1;
          if (value & 2) {
            if (value & 32) {
              this.setFogAt(x, y, 0);
            }
            return;
          }
          break;
        case MapDirection.WEST:
          if (!(value & 8)) {
            this.setFogAt(x, y - 1, 0);
            if (!(this.getAt(x, y - 1) & 4)) {
              this.setFogAt(x - 1, y - 1, 0);
            }
          } else if (value & 128) {
            this.setFogAt(x, y - 1, 0);
          }
          if (!(value & 2)) {
            this.setFogAt(x, y + 1, 0);
            if (!(this.getAt(x, y + 1) & 4)) {
              this.setFogAt(x - 1, y + 1, 0);
            }
          } else if (value & 32) {
            this.setFogAt(x, y + 1, 0);
          }
          x -= 1;
          if (value & 4) {
            if (value & 64) {
              this.setFogAt(x, y, 0);
            }
            return;
          }
          break;
        case MapDirection.NORTH:
          if (!(value & 1)) {
            this.setFogAt(x + 1, y, 0);
            if (!(this.getAt(x + 1, y) & 8)) {
              this.setFogAt(x + 1, y - 1, 0);
            }
          } else if (value & 16) {
            this.setFogAt(x + 1, y, 0);
          }
          if (!(value & 4)) {
            this.setFogAt(x - 1, y, 0);
            if (!(this.getAt(x - 1, y) & 8)) {
              this.setFogAt(x - 1, y - 1, 0);
            }
          } else if (value & 64) {
            this.setFogAt(x - 1, y, 0);
          }
          y -= 1;
          if (value & 8) {
            if (value & 128) {
              this.setFogAt(x, y, 0);
            }
            return;
          }
          break;
      }

      this.setFogAt(x, y, 0);
    }
  }

  /**
   * 条件に従ってランダムな位置を取得する
   * @param config ランダム位置取得の設定オプション
   * @returns ランダムな位置の座標配列[x, y]、取得できない場合は空配列
   */
  public getRandomPos({ withoutCorridor = false, withoutDoor = false, withoutPlayer = false, excludePositionList = [] }: RandomPosConfig): integer[] {
    let x: integer = 0, y: integer = 0, pos = -1;
    const limit = 1000, playerPos = this._calcPos(this._player.x, this._player.y);
    for (let i = 0; i < limit && pos === -1; i++) {
      x = getRandomInt(1, this._width - 1);
      y = getRandomInt(1, this._height - 1);
      pos = this.getAt(x, y);
      if (pos !== -1 && withoutCorridor) {
        for (const roomWithCorridor of this._roomsWithCorridors) {
          for (const corridor of roomWithCorridor.corridors) {
            if (corridor.x1 <= x && x <= corridor.x2 && corridor.y1 <= y && y <= corridor.y2) {
              // 通路内をキャンセル
              pos = -1;
            }
          }
        }
      }
      if (pos !== -1 && withoutDoor) {
        if (pos & 0xF0) {
          // ドア横をキャンセル
          pos = -1;
        }
      }
      if (pos !== -1 && withoutPlayer) {
        if (pos === playerPos) {
          // プレイヤー直上をキャンセル
          pos = -1;
        }
      }
      if (excludePositionList.length > 0) {
        for (const exPos of excludePositionList) {
          if (pos === this._calcPos(exPos[0], exPos[1])) {
            // 除外リストに一致すればキャンセル
            pos = -1;
            break;
          }
        }
      }
    }

    if (pos === -1) {
      console.error('fault random pos');
      return [];
    } else {
      return [x, y];
    }
  }

  /**
   * 複数のランダムな位置を取得する
   * @param count 取得する位置の数
   * @param permitSamePos 同じ位置の重複を許可するかどうか
   * @param config ランダム位置取得の設定オプション
   * @returns ランダムな位置の座標配列のリスト
   */
  public getRandomPosList(count: integer, permitSamePos: boolean = false, config: RandomPosConfig = { withoutCorridor: false, withoutDoor: false, withoutPlayer: false, excludePositionList: [] }) {
    const result: integer[][] = [];
    for (let i = 0; i < count; i++) {
      const res = this.getRandomPos(config);
      if (res.length > 0) {
        result.push(res);
      } else {
        // 座標が見つからなかった場合、次の座標検索でも見つからないはずなので、ループを抜ける
        break;
      }
      if (!permitSamePos) {
        config.excludePositionList = result;
      }
    }

    return result;
  }

  /**
   * プレイヤーをランダムな位置に配置する
   * @returns 配置に成功した場合true、失敗した場合false
   */
  public setPlayerRandom() {
    const pos = this.getRandomPos({});
    if (pos.length === 0) {
      console.error('fault player set');
      return false;
    } else {
      this._player.x = pos[0];
      this._player.y = pos[1];
      this._player.direction = getRandomDirection();
      this.clearFogWithinPlayer();
      this.setWalkedAt(this._player.x, this._player.y, 1);
      return true;
    }
  }

  /**
   * プレイヤーを指定方向に移動させる
   * @param direction 移動方向
   * @returns 移動に成功した場合1、壁や扉で移動できない場合0
   */
  public movePlayer(direction: MapDirection): integer {
    const value = this.getAt(this._player.x, this._player.y)
    if (value & (2 ** direction)) {
      if (!(value & (2 ** (direction + 4)))) {
        return 0;
      }
    }
    switch (direction) {
      case MapDirection.EAST:
        this._player.x += 1;
        break;
      case MapDirection.SOUTH:
        this._player.y += 1;
        break;
      case MapDirection.WEST:
        this._player.x -= 1;
        break;
      case MapDirection.NORTH:
        this._player.y -= 1;
        break;
    }

    this._player.direction = direction;
    this.clearFogWithinPlayer();
    this.setWalkedAt(this._player.x, this._player.y, 1);
    
    this.dispatchObjectEvent();
    return 1;
  }

  /**
   * プレイヤーを現在の向きに向かって前進させる
   * @returns 移動に成功した場合1、移動できない場合0
   */
  public goPlayer(): integer {
    return this.movePlayer(this._player.direction)
  }

  /**
   * プレイヤーを現在の向きから右方向に移動させる
   * @returns 移動に成功した場合1、移動できない場合0
   */
  public goRightPlayer(): integer {
    return this.movePlayer(rotateDirection(this._player.direction, 1))
  }

  /**
   * プレイヤーを現在の向きから左方向に移動させる
   * @returns 移動に成功した場合1、移動できない場合0
   */
  public goLeftPlayer(): integer {
    return this.movePlayer(rotateDirection(this._player.direction, 3))
  }

  /**
   * プレイヤーを右（時計回り）に90度回転させる
   * @returns 常にtrue
   */
  public turnRightPlayer(): boolean {
    const now = this._player.direction;
    this._player.direction = rotateDirection(now, 1);
    this.clearFogWithinPlayer();
    return true;
  }

  /**
   * プレイヤーを左（反時計回り）に90度回転させる
   * @returns 常にtrue
   */
  public turnLeftPlayer(): boolean {
    const now = this._player.direction;
    this._player.direction = rotateDirection(now, 3);
    this.clearFogWithinPlayer();
    return true;
  }

  /**
   * プレイヤーを180度回転させる（振り返り）
   * @returns 常にtrue
   */
  public turnBackPlayer(): boolean {
    const now = this._player.direction;
    this._player.direction = rotateDirection(now, 2);
    this.clearFogWithinPlayer();
    return true;
  }

  /**
   * マップの各セルを順次取得するイテレータ
   * @yields マップセルの情報（座標、壁状態、フォグ、進入可能性、歩行済み状態）
   */
  public * mapIterator() {
    for (let x = 1; x < this._width - 1; x++) {
      for (let y = 1; y < this._height - 1; y++) {
        const value = this.getAt(x, y);
        const wallState = {
          wall: [false, false, false, false],
          door: [false, false, false, false],
        }
        if (value & 1) {
          wallState.wall[MapDirection.EAST] = true;
        }
        if (value & 2) {
          wallState.wall[MapDirection.SOUTH] = true;
        }
        if (value & 4) {
          wallState.wall[MapDirection.WEST] = true;
        }
        if (value & 8) {
          wallState.wall[MapDirection.NORTH] = true;
        }
        if (value & 16) {
          wallState.door[MapDirection.EAST] = true;
        }
        if (value & 32) {
          wallState.door[MapDirection.SOUTH] = true;
        }
        if (value & 64) {
          wallState.door[MapDirection.WEST] = true;
        }
        if (value & 128) {
          wallState.door[MapDirection.NORTH] = true;
        }
        yield {
          x,
          y,
          wallState,
          fog: this.getFogAt(x, y),
          enter: value !== -1,
          walked: this.getWalkedAt(x, y),
        }
      }
    }
  }

  /**
   * マップ上の全オブジェクトを取得する
   * @returns オブジェクトのMapコレクション
   */
  public getObjects() {
    return this._objects;
  }

  /**
   * 指定座標にあるオブジェクトのリストを取得する
   * @param x X座標
   * @param y Y座標
   * @returns 指定座標にあるオブジェクトの配列
   */
  public getObject(x: integer, y: integer) {
    const list: MapObject[] = [];
    for (const object of this._objects.values()) {
      if (object.x === x && object.y === y) {
        list.push(object)
      }
    }
    return list;
  }

  /**
   * マップにオブジェクトを追加する
   * @param x X座標
   * @param y Y座標
   * @param mark オブジェクトの表示マーク
   * @param event オブジェクトのイベント関数
   * @param color オブジェクトの色（デフォルト: 白）
   * @param alpha オブジェクトの透明度（デフォルト: 1）
   * @param sphere 球体として表示するかどうか（デフォルト: false）
   * @param visible オブジェクトの可視性（デフォルト: true）
   * @returns 追加されたオブジェクトのID
   */
  public addObject(x: integer, y: integer, mark: string, events: Map<string, ObjectEvent>, color: integer = 0xFFFFFF, alpha: integer = 1, sphere = false, visible = true) {
    const obj = new MapObject()
    obj.x = x;
    obj.y = y;
    obj.mark = mark;
    obj.events = events;
    obj.color = color;
    obj.alpha = alpha;
    obj.sphere = sphere;
    obj.visible = visible;
    this._object_counter++;
    this._objects.set(this._object_counter, obj);
    return this._object_counter;
  }

  /**
   * dispatchObjectEvent
   */
  public dispatchObjectEvent() {
    for (const object of this._objects.values()) {
      if (this._player.x === object.x && this._player.y === object.y) {
        const event = object.events.get('around-0')
        if (event) {
          event(this, object)
        }
      }
    }
  }
}
