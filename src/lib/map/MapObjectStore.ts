'use strict';

import { Enemy } from '../Enemy';
import { MapObject } from '../MapObject';
import type { ObjectEvent } from '../MapObject';
import type { Player } from '../Player';
import type { DungeonMap } from '../MapGenerator';
import { EventBus } from '../../game/EventBus';
import { makeStatFluctuatedMessage } from '../util/text';
import { StatsLoader } from '../StatsLoader';
import { BaseLoader } from '../BaseLoader';

/**
 * マップ上のオブジェクト（階段・トラップ・敵など）を一元管理するストア。
 *
 * オブジェクトは ID をキーとした Map で保持し、Enemy は instanceof による
 * 動的フィルタで取り扱う。プレイヤー位置を引数で受け取ることでイベントを
 * ディスパッチする。
 */
export class MapObjectStore {
  private _objects: Map<integer, MapObject> = new Map<integer, MapObject>();
  private _counter: integer = 0;

  /**
   * 内部状態を空にする（フロア再生成時に呼ばれる）
   */
  public clear(): void {
    this._objects = new Map<integer, MapObject>();
    this._counter = 0;
  }

  /**
   * 全オブジェクトの Map を取得する
   */
  public getAll(): Map<integer, MapObject> {
    return this._objects;
  }

  /**
   * 指定座標にあるオブジェクトのリストを取得する
   */
  public getAt(x: integer, y: integer): MapObject[] {
    const list: MapObject[] = [];
    for (const object of this._objects.values()) {
      if (object.x === x && object.y === y) {
        list.push(object)
      }
    }
    return list;
  }

  /**
   * MapObject を直接登録する（Enemy など、座標とプロパティが既に設定されているもの向け）
   */
  public add(object: MapObject): integer {
    this._counter++;
    this._objects.set(this._counter, object);
    return this._counter;
  }

  /**
   * パラメータから新しい MapObject を生成して登録する
   */
  public addObject(
    x: integer,
    y: integer,
    mark: string,
    events: Map<string, ObjectEvent>,
    color: integer = 0xFFFFFF,
    alpha: integer = 1,
    sphere = false,
    visible = true,
  ): integer {
    const obj = new MapObject();
    obj.x = x;
    obj.y = y;
    obj.mark = mark;
    obj.events = events;
    obj.color = color;
    obj.alpha = alpha;
    obj.sphere = sphere;
    obj.visible = visible;
    return this.add(obj);
  }

  /**
   * 指定された MapObject インスタンスを参照一致で削除する
   */
  public remove(target: MapObject): boolean {
    for (const [id, object] of this._objects.entries()) {
      if (object === target) {
        this._objects.delete(id);
        return true;
      }
    }
    return false;
  }

  /**
   * プレイヤーとオブジェクトのチェビシェフ距離に応じてイベントをディスパッチする。
   * around-0: プレイヤーと同じマス
   * around-1: プレイヤーの周囲8マス
   *
   * 全イベント処理後、player の持続効果を1ターン進める。
   */
  public dispatchEvent(dungeon: DungeonMap, playerX: integer, playerY: integer, player: Player | null): void {
    for (const [id, object] of this._objects.entries()) {
      const dx = Math.abs(playerX - object.x);
      const dy = Math.abs(playerY - object.y);
      const distance = Math.max(dx, dy);

      const event = object.events.get(`around-${distance}`);
      if (event && !event(dungeon, object)) {
        this._objects.delete(id);
      }
    }

    if (player) {
      const expired = player.tickContinuousEffects();
      for (const entry of expired) {
        EventBus.emit('message-log', `${entry.sourceLabel}の効果が切れた`, dungeon.getTurnCount());
      }
      const statusResult = player.tickStatusEffects();
      const statsLoader = StatsLoader.getInstance();
      for (const a of statusResult.applied) {
        const statName = statsLoader.getAbbreviation(a.statName) || a.statName;
        EventBus.emit('message-log', `${a.label}で ${makeStatFluctuatedMessage(statName, a.delta)}`, dungeon.getTurnCount());
      }
      for (const c of statusResult.cleared) {
        EventBus.emit('message-log', `${c.label}が解けた`, dungeon.getTurnCount());
      }
      if (BaseLoader.getInstance().isDead(player.getFormulaVars())) {
        EventBus.emit('game-over');
      }
    }
  }

  /**
   * プレイヤー位置にあるオブジェクトに対して around-0-self イベントをディスパッチする
   */
  public dispatchSelfEvent(dungeon: DungeonMap, playerX: integer, playerY: integer): boolean {
    let dispatched = false;
    for (const [id, object] of this._objects.entries()) {
      if (playerX !== object.x || playerY !== object.y) continue;
      const event = object.events.get('around-0-self');
      if (!event) continue;
      dispatched = true;
      if (!event(dungeon, object)) {
        this._objects.delete(id);
      }
    }
    return dispatched;
  }

  /**
   * 敵をマップに追加する
   */
  public addEnemy(enemy: Enemy): integer {
    return this.add(enemy);
  }

  /**
   * 指定座標の敵を取得する
   */
  public getEnemy(x: integer, y: integer): Enemy | undefined {
    for (const object of this._objects.values()) {
      if (object instanceof Enemy && object.x === x && object.y === y) {
        return object;
      }
    }
    return undefined;
  }

  /**
   * 指定座標の敵を削除する
   */
  public removeEnemy(x: integer, y: integer): boolean {
    for (const [id, object] of this._objects.entries()) {
      if (object instanceof Enemy && object.x === x && object.y === y) {
        this._objects.delete(id);
        return true;
      }
    }
    return false;
  }

  /**
   * 全ての敵を配列で取得する
   */
  public getEnemies(): Enemy[] {
    const enemies: Enemy[] = [];
    for (const object of this._objects.values()) {
      if (object instanceof Enemy) {
        enemies.push(object);
      }
    }
    return enemies;
  }

  /**
   * 現在マップ上にいる敵の数を取得する
   */
  public getEnemyCount(): integer {
    let count = 0;
    for (const object of this._objects.values()) {
      if (object instanceof Enemy) {
        count++;
      }
    }
    return count;
  }

  /**
   * 全ての敵をマップから除去する
   */
  public clearEnemies(): void {
    const enemyIds: integer[] = [];
    for (const [id, object] of this._objects.entries()) {
      if (object instanceof Enemy) {
        enemyIds.push(id);
      }
    }
    for (const id of enemyIds) {
      this._objects.delete(id);
    }
  }
}
