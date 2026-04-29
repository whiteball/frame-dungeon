'use strict';

import type { Enemy } from './Enemy';
import type { MapObject, ObjectEvent } from './MapObject';
import type { Player } from './Player';
import { getRandomInt } from './util/random';
import type { Rect } from './map/Rect';
import { MapDirection, getRandomDirection, rotateDirection } from './map/MapDirection';
import { MapBuilder, type RoomWithCorridors } from './map/MapBuilder';
import { MapObjectStore } from './map/MapObjectStore';
import * as PlayerActions from './map/PlayerActions';
import { dumpDungeon } from './map/MapDebug';

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
  private _roomsWithCorridors: RoomWithCorridors[];

  private _player: {
    x: integer,
    y: integer,
    direction: MapDirection,
  };

  private _objectStore: MapObjectStore = new MapObjectStore();
  private _playerInstance: Player | null = null;
  private _turnCount: number = 0;

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
    this._objectStore.clear();
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
   * 現在のフロアの部屋数を取得する
   * @returns 部屋数
   */
  public getRoomCount(): integer {
    return this._rooms.length;
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
   * デバッグ用にマップの状態をコンソールに出力する
   * @param doorOff trueの場合扉の表示を無効にする
   */
  public dump(doorOff = false): void {
    dumpDungeon(this._map, this._width, this._player, doorOff);
  }

  /**
   * ダンジョン全体を構築する
   * 初期化、部屋生成、通路生成、壁設定、プレイヤー配置を順次実行する
   */
  public build() {
    this.init();
    if (this._map.length > 0) {
      const builder = new MapBuilder(this, this._width, this._height, this._minRoomLength);
      this._rooms = builder.makeRoom();
      this._roomsWithCorridors = builder.makeCorridor(this._rooms);
      builder.setWall(this._roomsWithCorridors);
    }
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
    const limit = 1000;
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
        if (x === this._player.x && y === this._player.y) {
          // プレイヤー直上をキャンセル
          pos = -1;
        }
      }
      if (excludePositionList.length > 0) {
        for (const exPos of excludePositionList) {
          if (x === exPos[0] && y === exPos[1]) {
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
    // excludePositionListの変更が呼び出し元に影響を与えないようにコピーを作る
    const configLocal: RandomPosConfig = {...config};
    configLocal.excludePositionList = config.excludePositionList ? [...config.excludePositionList] : [];
    for (let i = 0; i < count; i++) {
      const res = this.getRandomPos(configLocal);
      if (res.length > 0) {
        result.push(res);
      } else {
        // 座標が見つからなかった場合、次の座標検索でも見つからないはずなので、ループを抜ける
        break;
      }
      if (!permitSamePos) {
        configLocal.excludePositionList.push(res);
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

    // 移動先の座標を計算
    let nx = this._player.x;
    let ny = this._player.y;
    switch (direction) {
      case MapDirection.EAST:
        nx += 1;
        break;
      case MapDirection.SOUTH:
        ny += 1;
        break;
      case MapDirection.WEST:
        nx -= 1;
        break;
      case MapDirection.NORTH:
        ny -= 1;
        break;
    }

    // 移動先に敵がいる場合は移動できない
    if (this.getEnemy(nx, ny)) {
      return 0;
    }

    this._player.x = nx;
    this._player.y = ny;
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
   * 2点間に壁がなく攻撃可能かを判定する（Chebyshev距離1の隣接セル限定）
   */
  public canAttack(fromX: integer, fromY: integer, toX: integer, toY: integer): boolean {
    return PlayerActions.canAttack(this, fromX, fromY, toX, toY);
  }

  /**
   * プレイヤーが正面の敵を攻撃する
   */
  public attackPlayer(): boolean {
    return PlayerActions.attackPlayer(this);
  }

  /**
   * 指定座標の敵を攻撃する（隣接かつ攻撃可の場合のみ）
   */
  public attackEnemyAt(targetX: integer, targetY: integer): boolean {
    return PlayerActions.attackEnemyAt(this, targetX, targetY);
  }

  /**
   * プレイヤーが消耗品を使用する
   */
  public useConsumableItem(instanceId: string): boolean {
    return PlayerActions.useConsumableItem(this, instanceId);
  }

  /**
   * プレイヤーの装備を変更する
   */
  public changeEquipment(instanceId: string): PlayerActions.ChangeEquipmentResult {
    return PlayerActions.changeEquipment(this, instanceId);
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
  public getObjects(): Map<integer, MapObject> {
    return this._objectStore.getAll();
  }

  /**
   * 指定座標にあるオブジェクトのリストを取得する
   */
  public getObject(x: integer, y: integer): MapObject[] {
    return this._objectStore.getAt(x, y);
  }

  /**
   * マップにオブジェクトを追加する
   * @returns 追加されたオブジェクトのID
   */
  public addObject(x: integer, y: integer, mark: string, events: Map<string, ObjectEvent>, color: integer = 0xFFFFFF, alpha: integer = 1, sphere = false, visible = true): integer {
    return this._objectStore.addObject(x, y, mark, events, color, alpha, sphere, visible);
  }

  /**
   * プレイヤーとオブジェクトの距離に応じてイベントをディスパッチする
   * around-0: プレイヤーと同じマス
   * around-1: プレイヤーの周囲8マス（チェビシェフ距離1）
   */
  public dispatchObjectEvent(): void {
    this._objectStore.dispatchEvent(this, this._player.x, this._player.y, this._playerInstance);
    this._turnCount++;
  }

  /**
   * プレイヤー位置にあるオブジェクトに対して around-0-self イベントをディスパッチする
   */
  public dispatchSelfEvent(): boolean {
    return this._objectStore.dispatchSelfEvent(this, this._player.x, this._player.y);
  }

  /**
   * 指定された MapObject インスタンスを参照一致でマップから削除する
   */
  public removeMapObject(target: MapObject): boolean {
    return this._objectStore.remove(target);
  }

  /**
   * 敵をマップに追加する
   */
  public addEnemy(enemy: Enemy): integer {
    return this._objectStore.addEnemy(enemy);
  }

  /**
   * 指定座標の敵を取得する
   */
  public getEnemy(x: integer, y: integer): Enemy | undefined {
    return this._objectStore.getEnemy(x, y);
  }

  /**
   * 指定座標の敵を削除する
   */
  public removeEnemy(x: integer, y: integer): boolean {
    return this._objectStore.removeEnemy(x, y);
  }

  /**
   * 全ての敵を取得する
   */
  public getEnemies(): Enemy[] {
    return this._objectStore.getEnemies();
  }

  /**
   * プレイヤーの位置に敵がいるかチェック
   */
  public getEnemyAtPlayer(): Enemy | undefined {
    return this._objectStore.getEnemy(this._player.x, this._player.y);
  }

  /**
   * 敵の数を取得
   */
  public getEnemyCount(): integer {
    return this._objectStore.getEnemyCount();
  }

  /**
   * 全ての敵をクリア
   */
  public clearEnemies(): void {
    this._objectStore.clearEnemies();
  }

  /**
   * Playerインスタンスを設定する
   */
  public setPlayerInstance(player: Player): void {
    this._playerInstance = player;
  }

  /**
   * Playerインスタンスを取得する
   */
  public getPlayerInstance(): Player | null {
    return this._playerInstance;
  }

  public getTurnCount(): number {
    return this._turnCount;
  }
}
