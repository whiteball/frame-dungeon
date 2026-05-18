'use strict';

import { Enemy } from './Enemy';
import { MapObject, newMapEvent, type ObjectEvent } from './MapObject';
import type { Player } from './Player';
import { getRandomInt } from './util/random';
import { Rect } from './map/Rect';
import { MapDirection, getRandomDirection, rotateDirection, getDirectionOffset } from './map/MapDirection';
import { MapBuilder, type RoomWithCorridors } from './map/MapBuilder';
import { MapObjectStore } from './map/MapObjectStore';
import * as PlayerActions from './map/PlayerActions';
import { dumpDungeon } from './map/MapDebug';
import { findPath, findContainingZone, isInZone, hasLineOfSight, type FindPathOptions } from './map/Pathfinding';
import { BaseLoader } from './BaseLoader';
import { StairsObject, TrapObject, ItemObject } from './map/MapObjects';
import { ItemsLoader } from './ItemsLoader';
import { Item } from './Item';
import { TrapsLoader } from './TrapsLoader';
import { EnemyLoader } from './EnemyLoader';
import { StatsLoader } from './StatsLoader';
import type { DungeonSaveData } from './SaveManager';
import type { TrapDefinition } from './TrapsLoader';
import { EventBus } from '../game/EventBus';
import { makeStatFluctuatedMessage } from './util/text';

export type DungeonRestoreCallbacks = {
    onEnterStair: (dungeon: DungeonMap) => void;
    applyTrapEffects: (def: TrapDefinition) => void;
    enterTrapConfirmMode: (def: TrapDefinition, obj: MapObject) => void;
};

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
  private _mapCurrentView: integer[];
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
  private _floorStartTurnCount: number = 0;
  private _currentFloor: number = 1;

  constructor(width: integer, height: integer, viewRange = 3, enableFog = true) {
    this.resize(width, height);
    this._viewRange = viewRange;
    this._enableFog = enableFog;
  }

  resize(width: integer, height: integer): void {
    this._width = width + 2;
    this._height = height + 2;
  }

  /**
   * ダンジョンマップを初期化する
   * 全てのマップデータをクリアし、プレイヤーの初期位置を設定する
   */
  public init() {
    this._map = [];
    this._mapFog = [];
    this._mapWalked = [];
    this._mapCurrentView = [];
    this._rooms = [];
    this._roomsWithCorridors = [];
    this._objectStore.clear();
    const fog = this._enableFog ? 1 : 0;
    for (let i = 0; i < this._width * this._height; i++) {
      this._map[i] = -1;
      this._mapFog[i] = fog;
      this._mapWalked[i] = 0;
      this._mapCurrentView[i] = 0;
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
    if (x < 0 || y < 0) return undefined;
    if (x > this._width || y > this._height) return undefined;
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

  public getCurrentViewAt(x: integer, y: integer): integer {
    const pos = this._calcPos(x, y);
    return pos === undefined ? 0 : this._mapCurrentView[pos];
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
   * 境界を含めたマップの幅を取得する
   * @returns マップの幅
   */
  public getInternalWidth(): integer {
    return this._width;
  }

  /**
   * 境界を含めたマップの高さを取得する
   * @returns マップの高さ
   */
  public getInternalHeight(): integer {
    return this._height;
  }

  /**
   * 現在のフロアの部屋数を取得する
   * @returns 部屋数
   */
  public getRoomCount(): integer {
    return this._rooms.length;
  }

  /**
   * プレイヤーの視界の長さを取得する
   * @returns 視界のマス数
   */
  public getViewRange(): integer {
    return this._viewRange;
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
   * プレイヤーの視界範囲内のフォグをクリアする（扇状視界）
   *
   * 深さ d では横オフセット ±d まで可視（扇形）。
   * ① 前進伝播: 深さ d の可視タイルを深さ d+1 へ伝播
   * ② 扇状横展開: 深さ d+1 を左→右・右→左の 2 パスで壁に沿って拡張（最大 ±(d+1)）
   * 扉は現在と同じく前方・横いずれも先1マスのみ開示して伝播を止める。
   *
   * マップ値のビット構成（東=bit0、南=bit1、西=bit2、北=bit3 が壁、bit4〜7 が対応する扉）:
   *   壁ビット = 1 << direction、扉ビット = 16 << direction
   */
  public clearFogWithinPlayer(): void {
    this._mapCurrentView.fill(0);
    const direction = this._player.direction;
    const [dx, dy] = getDirectionOffset(direction);
    const leftDir  = (direction + 1) % 4 as MapDirection;
    const rightDir = (direction + 3) % 4 as MapDirection;
    const [lx, ly] = getDirectionOffset(leftDir);

    const forwardWallBit = 1 << direction;
    const forwardDoorBit = 16 << direction;
    const leftWallBit    = 1 << leftDir;
    const rightWallBit   = 1 << rightDir;
    const leftDoorBit    = 16 << leftDir;
    const rightDoorBit   = 16 << rightDir;

    const vr  = this._viewRange;
    const mid = vr; // vis 配列の横オフセット 0 に対応するインデックス

    // vis[d][j+mid]: 深さ d・横オフセット j のタイルが可視かどうか
    // j > 0 = leftDir 方向、j < 0 = rightDir 方向
    const vis: boolean[][] = Array.from({ length: vr + 1 }, () =>
      new Array(2 * vr + 1).fill(false)
    );

    const coord = (d: number, j: number): [number, number] => [
      this._player.x + d * dx + j * lx,
      this._player.y + d * dy + j * ly,
    ];
    const tileVal = (d: number, j: number): number => {
      const [tx, ty] = coord(d, j);
      return this.getAt(tx, ty);
    };
    const reveal = (d: number, j: number): void => {
      const [tx, ty] = coord(d, j);
      this.setFogAt(tx, ty, 0);
      const pos = this._calcPos(tx, ty);
      if (pos !== undefined) this._mapCurrentView[pos] = 1;
    };

    // 深さ 0: プレイヤー位置は常に可視
    vis[0][mid] = true;
    reveal(0, 0);

    // プレイヤーの両隣: 壁がなければ（扉も含む）そのマスを開示
    const pVal = tileVal(0, 0);
    if (pVal >= 0) {
      if (!(pVal & leftWallBit) || (pVal & leftDoorBit))   reveal(0,  1);
      if (!(pVal & rightWallBit) || (pVal & rightDoorBit)) reveal(0, -1);
    }

    for (let d = 0; d < vr; d++) {
      // ── ① 前進伝播: 深さ d の可視タイル → 深さ d+1 ──
      for (let j = -d; j <= d; j++) {
        if (!vis[d][j + mid]) continue;
        const val = tileVal(d, j);
        if (val < 0) continue;
        if (!(val & forwardWallBit)) {
          if (!vis[d + 1][j + mid]) {
            vis[d + 1][j + mid] = true;
            reveal(d + 1, j);
          }
        } else if (val & forwardDoorBit) {
          reveal(d + 1, j); // 扉の先1マスのみ開示、伝播しない
        }
      }

      // ── ② 扇状横展開: 深さ d+1 で最大 ±(d+1) まで広げる ──
      // 横展開できるのは「前の深さ d でも可視だったタイル」からのみ。
      // T字路など直角方向の通路を「前の深さで壁だった列」から連鎖展開すると
      // 視線の通っていない角の先まで開示されてしまうため、この条件で防ぐ。
      // パス1: j 小→大（leftDir 側へ拡張）
      for (let j = -(d + 1); j < d + 1; j++) {
        if (!vis[d + 1][j + mid]) continue;
        if (!vis[d][j + mid]) continue; // 前の深さで不可視なら角越え展開を禁止
        const val = tileVal(d + 1, j);
        if (val < 0) continue;
        if (!(val & leftWallBit)) {
          if (!vis[d + 1][j + 1 + mid]) {
            vis[d + 1][j + 1 + mid] = true;
            reveal(d + 1, j + 1);
          }
        } else if (val & leftDoorBit) {
          reveal(d + 1, j + 1); // 扉タイルのみ開示
        }
      }
      // パス2: j 大→小（rightDir 側へ拡張）
      for (let j = d + 1; j > -(d + 1); j--) {
        if (!vis[d + 1][j + mid]) continue;
        if (!vis[d][j + mid]) continue; // 前の深さで不可視なら角越え展開を禁止
        const val = tileVal(d + 1, j);
        if (val < 0) continue;
        if (!(val & rightWallBit)) {
          if (!vis[d + 1][j - 1 + mid]) {
            vis[d + 1][j - 1 + mid] = true;
            reveal(d + 1, j - 1);
          }
        } else if (val & rightDoorBit) {
          reveal(d + 1, j - 1); // 扉タイルのみ開示
        }
      }
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
   * 指定座標のマスにあるものをログに表示する。
   * 未発見のオブジェクト（トラップ）があれば表示する。
   */
  public searchAt(targetX: integer, targetY: integer): boolean {
    return PlayerActions.searchAt(this, targetX, targetY);
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
   * プレイヤーがスキルを発動する
   * @param selectedTarget target=front の場合に UI で選ばれた対象セル
   */
  public useSkill(skillName: string, selectedTarget?: { x: integer; y: integer }): boolean {
    return PlayerActions.useSkill(this, skillName, selectedTarget);
  }

  /**
   * プレイヤーを現在の向きから右方向に移動させる（向きは変わらない）
   * @returns 移動に成功した場合1、移動できない場合0
   */
  public goRightPlayer(): integer {
    const savedDirection = this._player.direction;
    const result = this.movePlayer(rotateDirection(this._player.direction, 1));
    if (result > 0) {
      this._player.direction = savedDirection;
      this.clearFogWithinPlayer();
    }
    return result;
  }

  /**
   * プレイヤーを現在の向きから左方向に移動させる（向きは変わらない）
   * @returns 移動に成功した場合1、移動できない場合0
   */
  public goLeftPlayer(): integer {
    const savedDirection = this._player.direction;
    const result = this.movePlayer(rotateDirection(this._player.direction, 3));
    if (result > 0) {
      this._player.direction = savedDirection;
      this.clearFogWithinPlayer();
    }
    return result;
  }

  /**
   * プレイヤーを現在の向きから後方向に移動させる（向きは変わらない）
   * @returns 移動に成功した場合1、移動できない場合0
   */
  public goBackPlayer(): integer {
    const savedDirection = this._player.direction;
    const result = this.movePlayer(rotateDirection(this._player.direction, 2));
    if (result > 0) {
      this._player.direction = savedDirection;
      this.clearFogWithinPlayer();
    }
    return result;
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
   * 
   * aroundPlayerに1以上の数値を渡すと、プレイヤーの周囲のその数値分の距離だけを対象にする。
   * excludeOutOfMapにtrueを設定すると、プレイヤーがマップ端付近にいてaroundPlayerに1以上の時に、マップ外を対象に含めないようにする。
   * 例えばプレイヤーが[2, 2]にいてaroundPlayerが3の場合、取得範囲はRect(1, 1, 7, 7)になる。
   * 
   * @yields マップセルの情報（座標、壁状態、フォグ、進入可能性、歩行済み状態）
   */
  public * mapIterator(aroundPlayer: number = 0, excludeOutOfMap = false) {
    const area = aroundPlayer === 0
        ? new Rect(1, 1, this._width - 1, this._height - 1)
        : new Rect(this._player.x - aroundPlayer, this._player.y - aroundPlayer,
              this._player.x + aroundPlayer + 1, this._player.y + aroundPlayer + 1);
    if (area.x2 - area.x1 > this._width) {
      area.x1 = 1;
      area.x2 = this._width - 1;
    } else if (excludeOutOfMap) {
      if (area.x1 < 1) {
        area.x2 += 1 - area.x1;
        area.x1 = 1;
      } else if (area.x2 > this._width - 1) {
        area.x1 += this._width - 1 - area.x2;
        area.x2 = this._width - 1;
      }
    }
    if (area.y2 - area.y1 > this._height) {
      area.y1 = 1;
      area.y2 = this._height - 1;
    } else if (excludeOutOfMap) {
      if (area.y1 < 1) {
        area.y2 += 1 - area.y1;
        area.y1 = 1;
      } else if (area.y2 > this._height - 1) {
        area.y1 += this._height - 1 - area.y2;
        area.y2 = this._height - 1;
      }
    }
    for (let x = area.x1; x < area.x2; x++) {
      for (let y = area.y1; y < area.y2; y++) {
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
          inView: this.getCurrentViewAt(x, y),
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
   * 構築済みの MapObject インスタンスをマップに登録する
   * @returns 追加されたオブジェクトのID
   */
  public placeObject(object: MapObject): integer {
    return this._objectStore.add(object);
  }

  /**
   * プレイヤーとオブジェクトの距離に応じてイベントをディスパッチする
   * around-0: プレイヤーと同じマス
   * around-1: プレイヤーの周囲8マス（チェビシェフ距離1）
   *
   * 敵ターンはターン番号インクリメント前に実行する。これによりプレイヤー行動と
   * 敵反応のメッセージが同一ターン番号で message-log に並ぶ
   */
  public dispatchObjectEvent(): void {
    this._objectStore.dispatchEvent(this, this._player.x, this._player.y, this._playerInstance);
    this.tickEnemies();

    // 一定ターンごとに僅かに回復させる
    // @todo この処理をここに置くべきか要検討。また回復量や回復ペース、対象のステータスを設定可能にする。
    if (this._turnCount % 10 === 0 && this._playerInstance) {
      const target = BaseLoader.getInstance().getDefaultDamageStat();
      const max = this._playerInstance.getMaxStat(target);
      const delta = Math.floor(max * 0.01);
      this._playerInstance.addStat(target, delta < 1 ? 1 : delta);
    }

    this._turnCount++;
  }

  /**
   * 敵を指定方向に1マス移動させる
   * 壁・閉じた扉・進入不可マス・プレイヤー位置・他の敵位置のいずれかに該当する場合は失敗
   * @returns 移動に成功した場合true、移動できない場合false
   */
  public tryMoveEnemy(enemy: Enemy, direction: MapDirection): boolean {
    const value = this.getAt(enemy.x, enemy.y);
    if (value & (2 ** direction)) {
      if (!(value & (2 ** (direction + 4)))) return false;
    }

    const [dx, dy] = getDirectionOffset(direction);
    const nx = enemy.x + dx;
    const ny = enemy.y + dy;

    if (this.getAt(nx, ny) === -1) return false;
    if (this._player.x === nx && this._player.y === ny) return false;
    if (this.getEnemy(nx, ny)) return false;

    enemy.x = nx;
    enemy.y = ny;
    return true;
  }

  /**
   * 全ての生存している敵に行動の機会を与える
   */
  public tickEnemies(): void {
    const enemies = this.getEnemies();
    const turn = this._turnCount;
    const statsLoader = StatsLoader.getInstance();
    for (const enemy of enemies) {
      if (!enemy.isAlive()) continue;
      enemy.act(this);
      if (!enemy.isAlive()) continue;

      const result = enemy.tickStatusEffects();
      for (const a of result.applied) {
        const statName = statsLoader.getAbbreviation(a.statName) || a.statName;
        EventBus.emit('message-log', `${enemy.getLabel()}は${a.label}で ${makeStatFluctuatedMessage(statName, a.delta)}`, turn);
      }
      for (const c of result.cleared) {
        EventBus.emit('message-log', `${enemy.getLabel()}の${c.label}が解けた`, turn);
      }
      if (!enemy.isAlive()) {
        EventBus.emit('message-log', `${enemy.getLabel()}は力尽きた`, turn);
        this.removeEnemy(enemy.x, enemy.y);
      }
    }
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

  public getFloorTurnCount(): number {
    return this._turnCount - this._floorStartTurnCount;
  }

  public resetFloorTurnCount(): void {
    this._floorStartTurnCount = this._turnCount;
  }

  public getCurrentFloor(): integer {
    return this._currentFloor;
  }

  public setCurrentFloor(floor: integer): void {
    this._currentFloor = floor;
  }

  /**
   * 2点が同じゾーン（部屋または通路ゾーン）に属するか判定する
   */
  public isInSameZone(x1: integer, y1: integer, x2: integer, y2: integer): boolean {
    const zone = findContainingZone(x1, y1, this._roomsWithCorridors);
    if (zone === null) return false;
    return isInZone(x2, y2, zone);
  }

  public hasLineOfSight(x1: integer, y1: integer, x2: integer, y2: integer): boolean {
    return hasLineOfSight(this, x1, y1, x2, y2);
  }

  /**
   * 指定座標を起点に、壁・扉で囲まれた視覚的開放空間内のすべてのセルを BFS で列挙する。
   * 扉は「視覚的境界」とみなして突破しない（getDoorTargetsInZone と同方針）。
   * スキルの target: room 解決に使用する。
   */
  public getCellsInZone(startX: integer, startY: integer): [integer, integer][] {
    const cells: [integer, integer][] = [];
    const visited = new Set<integer>();
    const queue: [integer, integer][] = [[startX, startY]];
    visited.add(startY * this._width + startX);

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const val = this.getAt(cx, cy);
      if (val === -1) continue;
      cells.push([cx, cy]);

      for (let d = 0; d < 4; d++) {
        // 壁または扉があるならその方向には進まない（扉ビットは壁ビットと共に立つ前提）
        if (val & (1 << d)) continue;
        const [dx, dy] = getDirectionOffset(d as MapDirection);
        const nx = cx + dx;
        const ny = cy + dy;
        if (nx < 0 || ny < 0 || nx >= this._width || ny >= this._height) continue;
        const nKey = ny * this._width + nx;
        if (visited.has(nKey)) continue;
        visited.add(nKey);
        queue.push([nx, ny]);
      }
    }
    return cells;
  }

  /**
   * 壁・扉のない境界を BFS で展開し、視覚的に繋がった開放空間内の扉から
   * 1マス外側の座標リストを返す。
   * (enemyX, enemyY) のMooreネイバーフッド（チェビシェフ距離1）に含まれる座標は除外する。
   */
  public getDoorTargetsInZone(enemyX: integer, enemyY: integer): [integer, integer][] {
    const targets: [integer, integer][] = [];
    const seen = new Set<integer>();
    const visited = new Set<integer>();

    const queue: [integer, integer][] = [[enemyX, enemyY]];
    visited.add(enemyY * this._width + enemyX);

    while (queue.length > 0) {
      const [cx, cy] = queue.shift()!;
      const val = this.getAt(cx, cy);
      if (val === -1) continue;

      for (let d = 0; d < 4; d++) {
        if (val & (16 << d)) {
          const [dx, dy] = getDirectionOffset(d as MapDirection);
          const tx = cx + dx;
          const ty = cy + dy;
          if (Math.abs(tx - enemyX) <= 1 && Math.abs(ty - enemyY) <= 1) continue;
          const key = ty * this._width + tx;
          if (!seen.has(key)) {
            seen.add(key);
            targets.push([tx, ty]);
          }
        } else if (!(val & (1 << d))) {
          const [dx, dy] = getDirectionOffset(d as MapDirection);
          const nx = cx + dx;
          const ny = cy + dy;
          if (nx < 0 || ny < 0 || nx >= this._width || ny >= this._height) continue;
          const nKey = ny * this._width + nx;
          if (visited.has(nKey)) continue;
          visited.add(nKey);
          queue.push([nx, ny]);
        }
      }
    }

    return targets;
  }

  /**
   * A* 法で2点間の経路を求める
   * @param startX 開始X座標
   * @param startY 開始Y座標
   * @param endX 終了X座標
   * @param endY 終了Y座標
   * @param options scope:'room' を指定すると開始地点が属する部屋/通路ゾーン内だけを探索する
   * @returns 移動方向の配列。同一地点なら空配列、到達不可なら undefined
   */
  public findPath(
    startX: integer,
    startY: integer,
    endX: integer,
    endY: integer,
    options?: FindPathOptions,
  ): MapDirection[] | undefined {
    return findPath(this, this._roomsWithCorridors, startX, startY, endX, endY, options);
  }

  public serialize(): DungeonSaveData {
    const objects: DungeonSaveData['objects'] = [];
    const enemies: DungeonSaveData['enemies'] = [];

    for (const obj of this._objectStore.getAll().values()) {
      if (obj instanceof Enemy) {
        enemies.push(obj.serialize());
      } else if (obj instanceof StairsObject) {
        objects.push({ type: 'stairs', x: obj.x, y: obj.y });
      } else if (obj instanceof TrapObject) {
        objects.push({ type: 'trap', x: obj.x, y: obj.y, trapName: obj.trapDef.name, visible: obj.visible });
      } else if (obj instanceof ItemObject) {
        objects.push({ type: 'item', x: obj.x, y: obj.y, item: obj.item.serialize() });
      }
    }

    return {
      width: this._width,
      height: this._height,
      map: [...this._map],
      mapFog: [...this._mapFog],
      mapWalked: [...this._mapWalked],
      playerX: this._player.x,
      playerY: this._player.y,
      playerDirection: this._player.direction,
      turnCount: this._turnCount,
      floorStartTurnCount: this._floorStartTurnCount,
      rooms: this._rooms.map(r => ({ x1: r.x1, y1: r.y1, x2: r.x2, y2: r.y2 })),
      roomsWithCorridors: this._roomsWithCorridors.map(rwc => ({
        room: { x1: rwc.room.x1, y1: rwc.room.y1, x2: rwc.room.x2, y2: rwc.room.y2 },
        corridors: rwc.corridors.map(c => ({ x1: c.x1, y1: c.y1, x2: c.x2, y2: c.y2 })),
      })),
      objects,
      enemies,
    };
  }

  public deserialize(data: DungeonSaveData, callbacks: DungeonRestoreCallbacks): void {
    this._width = data.width;
    this._height = data.height;
    this._map = [...data.map];
    this._mapFog = [...data.mapFog];
    this._mapWalked = [...data.mapWalked];
    this._mapCurrentView = new Array(this._width * this._height).fill(0);
    this._turnCount = data.turnCount;
    this._floorStartTurnCount = data.floorStartTurnCount ?? data.turnCount;
    this._player = {
      x: data.playerX,
      y: data.playerY,
      direction: data.playerDirection as MapDirection,
    };
    this._rooms = data.rooms.map(r => new Rect(r.x1, r.y1, r.x2, r.y2));
    this._roomsWithCorridors = data.roomsWithCorridors.map(rwc => ({
      room: new Rect(rwc.room.x1, rwc.room.y1, rwc.room.x2, rwc.room.y2),
      corridors: rwc.corridors.map(c => new Rect(c.x1, c.y1, c.x2, c.y2)),
    }));

    this._objectStore.clear();

    const itemsLoader = ItemsLoader.getInstance();
    const trapsLoader = TrapsLoader.getInstance();
    const enemyLoader = EnemyLoader.getInstance();

    for (const objData of data.objects) {
      if (objData.type === 'stairs') {
        const obj = new StairsObject();
        const handler: ObjectEvent = (dungeon) => { callbacks.onEnterStair(dungeon); return true; };
        newMapEvent('around-0', handler, obj.events);
        newMapEvent('around-0-self', handler, obj.events);
        obj.x = objData.x;
        obj.y = objData.y;
        this._objectStore.add(obj);
      } else if (objData.type === 'trap') {
        const trapDef = trapsLoader.getTrap(objData.trapName);
        if (!trapDef) continue;
        const obj = new TrapObject(trapDef);
        const onTrigger: ObjectEvent = (_, object) => {
          if (object.visible) return true;
          object.visible = true;
          callbacks.applyTrapEffects(trapDef);
          return true;
        };
        const onSelfTrigger: ObjectEvent = (_, object) => {
          callbacks.enterTrapConfirmMode(trapDef, object);
          return true;
        };
        newMapEvent('around-0', onTrigger, obj.events);
        newMapEvent('around-0-self', onSelfTrigger, obj.events);
        obj.x = objData.x;
        obj.y = objData.y;
        obj.visible = objData.visible;
        this._objectStore.add(obj);
      } else if (objData.type === 'item') {
        // 新形式（item: ItemSaveData）優先、旧形式（itemName のみ）は legacy フォールバック
        let item: Item | null = null;
        if (objData.item) {
          const def = itemsLoader.getItem(objData.item.name);
          if (def) item = Item.deserialize(objData.item, def);
        } else if (objData.itemName) {
          const def = itemsLoader.getItem(objData.itemName);
          if (def) item = new Item(def);
        }
        if (!item) continue;
        const obj = new ItemObject(item);
        obj.x = objData.x;
        obj.y = objData.y;
        this._objectStore.add(obj);
      }
    }

    for (const enemyData of data.enemies) {
      const def = enemyLoader.getEnemy(enemyData.name);
      if (!def) continue;
      const enemy = new Enemy(def, enemyData.x, enemyData.y, enemyData.instanceId);
      enemy.restoreAfterLoad(enemyData.stats, enemyData.maxStats, enemyData.isDead, enemyData.target, enemyData.activeStatusEffects);
      this._objectStore.add(enemy);
    }

    this.clearFogWithinPlayer();
  }
}
