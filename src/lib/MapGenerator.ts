'use strict';

function getRandomInt(min: integer, max:integer):integer {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

// https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A3%E3%83%83%E3%82%B7%E3%83%A3%E3%83%BC%E2%80%93%E3%82%A4%E3%82%A7%E3%83%BC%E3%83%84%E3%81%AE%E3%82%B7%E3%83%A3%E3%83%83%E3%83%95%E3%83%AB
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

type ObjectEvent = (dungeon: DungeonMap, object: MapObject) => void;
export class MapObject {
  public mark: string = 'o';
  public color: integer = 0xFFFFFF;
  public alpha: integer = 1;
  public event: null | ObjectEvent = null;
  public x: integer = -1;
  public y: integer = -1;
}

export class DungeonMap {
  private _map: integer[];
  private _mapFog: integer[];
  private _width: integer;
  private _height: integer;

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
    direction: integer,
  };

  private _objects: MapObject[];

  constructor (width: integer, height: integer, viewRange = 3) {
    this._width = width + 2;
    this._height = height + 2;
    this._viewRange = viewRange;
    this.init();
  }

  public init () {
    this._map = [];
    this._mapFog = [];
    this._rooms = [];
    this._roomsWithCorridors = [];
    this._objects = [];
    for (let i = 0; i < this._width * this._height; i++) {
      this._map[i] = -1;
      this._mapFog[i] = 1;
    }
    this._player = {
      x: 0,
      y: 0,
      direction: 0,
    };
  }

  private _calcPos(x: integer, y: integer) {
    const pos = (y + 0) * this._width + x;
    return (pos >= this._map.length || pos < 0) ? undefined : pos;
  }

  public getAt(x: integer, y: integer): integer {
    const pos = this._calcPos(x, y);
    return pos === undefined ? -1 : this._map[pos];
  }

  public getFogAt(x: integer, y: integer): integer {
    const pos = this._calcPos(x, y);
    return pos === undefined ? 1 : this._mapFog[pos];
  }

  public setFogAt(x: integer, y: integer, value: integer): void {
    const pos = this._calcPos(x, y);
    if (pos !== undefined) {
      this._mapFog[pos] = value;
    }
  }

  public setAt(x: integer, y: integer, value: integer): void {
    const pos = this._calcPos(x, y);
    if (pos !== undefined) {
      this._map[pos] = value;
    }
  }

  public getWidth(): integer {
    return this._width - 2;
  }

  public getHeight(): integer {
    return this._height - 2;
  }

  public updateAt(x: integer, y: integer, value: integer): void {
    const pos = this._calcPos(x, y);
    if (pos !== undefined) {
      this._map[pos] += value;
    }
  }

  public getPlayerPos() : {x: integer, y: integer, direction: integer} {
    return {
      x: this._player.x,
      y: this._player.y,
      direction: this._player.direction,
    }
  }

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
      let temp: integer|undefined = 0, line = 0;
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

  /** 部屋を削って通路を作る */
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
      const directionArray = arrayShuffle([0, 1, 2, 3].slice())
      for (let i = 0; i < corNum; i++) {
        let cond = true;
        let corridor;
        for (let j = 0; j < 4 && cond && directionArray.length !== 0; j++) {
          const isConflict = (pos: {x: integer, y: integer}, direction: string) => newRooms.some(val =>
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
            case 0:
              if (room.x2 === this._width - 2 || room.x2 - room.x1 <= this._minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x2, room.y1, room.x2, room.y2);
              tempRoom.x2 -= 1
              cond = isConflict({ x: room.x2, y: room.y1 }, 'x');
              break;
            // 南
            case 1:
              if (room.y2 === this._height - 2 || room.y2 - room.y1 <= this._minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x1, room.y2, room.x2, room.y2);
              tempRoom.y2 -= 1
              cond = isConflict({ x: room.x1, y: room.y2 }, 'y');
              break;
            // 西
            case 2:
              if (room.x1 === 1 || room.x2 - room.x1 <= this._minRoomLength) {
                continue;
              }
              corridor = new Rect(room.x1, room.y1, room.x1, room.y2);
              tempRoom.x1 += 1
              cond = isConflict({ x: room.x1, y: room.y1 }, 'x');
              break;
            // 北
            case 3:
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
   */
  public setWall() {
    const roomsWithCorridors = this._roomsWithCorridors
    const _set = function (x: integer, y:integer, rect: Rect) {
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
      _addConnected = (roomNumber: integer, direction:integer) => {
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
        direction = getRandomInt(0, 4);
      if (blocked.some(v => v === temp)) {
        continue;
      }
      const room = roomsWithCorridors[temp].room
      if (direction === 0) {
        // 東
        if (temp + 1 < roomsWithCorridors.length && room.isContact(roomsWithCorridors[temp + 1].room) && !blocked.some(v => v === (temp + 1))) {
          _addConnected(temp, 1);
          _addConnected(temp + 1, 4);
        }
      } else if (direction === 1) {
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
      } else if (direction === 2) {
        // 西
        if (temp - 1 >= 0 && room.isContact(roomsWithCorridors[temp - 1].room) && !blocked.some(v => v === (temp - 1))) {
          _addConnected(temp, 4);
          _addConnected(temp - 1, 1);
        }
      } else if (direction === 3) {
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

  public build() {
    this.makeRoom();
    this.makeCorridor();
    this.setWall();
    this.setPlayerRandom();
  }

  public clearFogWithinPlayer (): void {
    const direction = this._player.direction;

    let x = this._player.x, y = this._player.y;
    for (let i = 0; i < this._viewRange; i++) {
      this.setFogAt(x, y, 0);
      const value = this.getAt(x, y);

      switch (direction) {
        case 0:
          if ( ! (value & 2)) {
            this.setFogAt(x, y + 1, 0);
            if ( ! (this.getAt(x, y + 1) & 1)) {
              this.setFogAt(x + 1, y + 1, 0);
            }
          } else if (value & 32) {
            this.setFogAt(x, y + 1, 0);
          }
          if ( ! (value & 8)) {
            this.setFogAt(x, y - 1, 0);
            if ( ! (this.getAt(x, y - 1) & 1)) {
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
        case 1:
          if ( ! (value & 4)) {
            this.setFogAt(x - 1, y, 0);
            if ( ! (this.getAt(x - 1, y) & 2)) {
              this.setFogAt(x - 1, y + 1, 0);
            }
          } else if (value & 64) {
            this.setFogAt(x - 1, y, 0);
          }
          if ( ! (value & 1)) {
            this.setFogAt(x + 1, y, 0);
            if ( ! (this.getAt(x + 1, y) & 2)) {
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
        case 2:
          if ( ! (value & 8)) {
            this.setFogAt(x, y - 1, 0);
            if ( ! (this.getAt(x, y - 1) & 4)) {
              this.setFogAt(x - 1, y - 1, 0);
            }
          } else if (value & 128) {
            this.setFogAt(x, y - 1, 0);
          }
          if ( ! (value & 2)) {
            this.setFogAt(x, y + 1, 0);
            if (! (this.getAt(x, y + 1) & 4)) {
              this.setFogAt(x - 1, y + 1, 0);
            }
          } else if (value & 32)  {
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
        case 3:
          if ( ! (value & 1)) {
            this.setFogAt(x + 1, y, 0);
            if ( ! (this.getAt(x + 1, y) & 8)) {
              this.setFogAt(x + 1, y - 1, 0);
            }
          } else if (value & 16) {
            this.setFogAt(x + 1, y, 0);
          }
          if ( ! (value & 4)) {
            this.setFogAt(x - 1, y, 0);
            if (  ! (this.getAt(x - 1, y) & 8)) {
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

  public getRandomPos(withoutCorridor: boolean = false): integer[] {
    let x: integer = 0, y: integer = 0, pos = -1;
    const limit = 1000;
    for (let i = 0; i < limit && pos === -1; i++) {
      x = getRandomInt(1, this._width - 1);
      y = getRandomInt(1, this._height - 1);
      pos = this.getAt(x, y);
      if (withoutCorridor) {
        for (const roomWithCorridor of this._roomsWithCorridors) {
          for (const corridor of roomWithCorridor.corridors) {
            if (corridor.x1 <= x && x <= corridor.x2 && corridor.y1 <= y && y <= corridor.y2) {
              // 通路内をキャンセル
              pos = -1;
            }
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
   * setPlayerRandom
   */
  public setPlayerRandom() {
    const pos = this.getRandomPos();
    if (pos.length === 0) {
      console.error('fault player set');
      return false;
    } else {
      this._player.x = pos[0];
      this._player.y = pos[1];
      this._player.direction = getRandomInt(0, 4);
      this.clearFogWithinPlayer();
      return true;
    }
  }

  public movePlayer(direction: integer): integer {
    const value = this.getAt(this._player.x, this._player.y)
    if (value & (2 ** direction)) {
      if ( ! (value & (2 ** (direction + 4)))) {
        return 0;
      }
    }
    switch (direction) {
      case 0:
        this._player.x += 1;
        break;
      case 1:
        this._player.y += 1;
        break;
      case 2:
        this._player.x -= 1;
        break;
      case 3:
        this._player.y -= 1;
        break;
    }
    
    this._player.direction = direction;
    this.clearFogWithinPlayer();
    for (const object of this._objects) {
      object.event && object.event(this, object);
    }
    return 1;
  }

  public goPlayer(): integer {
    return this.movePlayer(this._player.direction)
  }

  public goRightPlayer(): integer {
    return this.movePlayer((this._player.direction + 1) % 4)
  }

  public goLeftPlayer(): integer {
    return this.movePlayer((this._player.direction + 3) % 4)
  }

  public turnRightPlayer(): boolean {
    const now = this._player.direction;
    this._player.direction = (now + 1) % 4;
    this.clearFogWithinPlayer();
    return true;
  }

  public turnLeftPlayer(): boolean {
    const now = this._player.direction;
    this._player.direction = (now + 3) % 4;
    this.clearFogWithinPlayer();
    return true;
  }

  public turnBackPlayer(): boolean {
    const now = this._player.direction;
    this._player.direction = (now + 2) % 4;
    this.clearFogWithinPlayer();
    return true;
  }

  public * mapIterator() {
    for (let x = 1; x < this._width - 1; x++) {
      for (let y = 1; y < this._height - 1; y++) {
        const value = this.getAt(x, y);
        const wallState = {
          wall: [false, false, false, false],
          door: [false, false, false, false],
        }
        if (value & 1) {
          wallState.wall[0] = true;
        }
        if (value & 2) {
          wallState.wall[1] = true;
        }
        if (value & 4) {
          wallState.wall[2] = true;
        }
        if (value & 8) {
          wallState.wall[3] = true;
        }
        if (value & 16) {
          wallState.door[0] = true;
        }
        if (value & 32) {
          wallState.door[1] = true;
        }
        if (value & 64) {
          wallState.door[2] = true;
        }
        if (value & 128) {
          wallState.door[3] = true;
        }
        yield {
          x,
          y,
          wallState,
          fog: this.getFogAt(x, y),
          enter: value !== -1,
        }
      }
    }
  }

  public getObjects() {
    return this._objects;
  }

  public getObject(x: integer, y: integer) {
    const list: MapObject[] = [];
    for (const object of this._objects) {
      if (object.x === x && object.y === y) {
        list.push(object)
      }
    }
    return list;
  }

  public addObject(x: integer, y: integer, mark: string, event: ObjectEvent, color: integer = 0xFFFFFF, alpha: integer = 1) {
    const obj = new MapObject()
    obj.x = x;
    obj.y = y;
    obj.mark = mark;
    obj.event = event;
    obj.color = color;
    obj.alpha = alpha;
    this._objects.push(obj)
  }
}
