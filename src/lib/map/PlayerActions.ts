'use strict';

import type { DungeonMap } from '../MapGenerator';
import { MapDirection, getDirectionOffset } from './MapDirection';
import { EffectsLoader } from '../EffectsLoader';
import { EventBus } from '../../game/EventBus';
import { Enemy } from '../Enemy';
import { MapMark } from '../MapObject';

/**
 * プレイヤーのターン消費アクション群
 *
 * いずれも DungeonMap を引数に取り、戦闘・アイテム使用・装備変更・調査を実行する。
 * EventBus を介したメッセージログ通知もここに集約する。DungeonMap 側は
 * 同名の薄い委譲メソッドを公開する。
 */

export type ChangeEquipmentResult = {
  success: boolean;
  consumedTurn: boolean;
  action: 'equipped' | 'unequipped' | 'none';
};

/**
 * 2点間に壁がなく攻撃可能かを判定する（Chebyshev距離1の隣接セル限定）
 * 斜め方向は、隣接する縦横両方向が壁で塞がれている場合のみ不可
 */
export function canAttack(dungeon: DungeonMap, fromX: integer, fromY: integer, toX: integer, toY: integer): boolean {
  const dx = toX - fromX;
  const dy = toY - fromY;
  if (Math.abs(dx) > 1 || Math.abs(dy) > 1) return false;

  const isSolidWall = (x: integer, y: integer, dir: number): boolean => {
    const val = dungeon.getAt(x, y);
    return !!(val & (1 << dir)) && !(val & (1 << (dir + 4)));
  };

  if (dy === 0) {
    return !isSolidWall(fromX, fromY, dx > 0 ? MapDirection.EAST : MapDirection.WEST);
  }
  if (dx === 0) {
    return !isSolidWall(fromX, fromY, dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH);
  }
  // 斜め: 角を回る2本のL字経路のうち、少なくとも1本が通れれば攻撃可
  // 経路A: 横→縦 (fromX,fromY)→(toX,fromY)→(toX,toY)
  // 経路B: 縦→横 (fromX,fromY)→(fromX,toY)→(toX,toY)
  const hDir = dx > 0 ? MapDirection.EAST : MapDirection.WEST;
  const vDir = dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH;
  const pathA = !isSolidWall(fromX, fromY, hDir) && !isSolidWall(toX, fromY, vDir);
  const pathB = !isSolidWall(fromX, fromY, vDir) && !isSolidWall(fromX, toY, hDir);
  return pathA || pathB;
}

/**
 * 指定座標の敵を攻撃する。隣接かつ canAttack を満たす必要がある。
 * @returns 攻撃が実行された場合true、対象なし／攻撃不可の場合false
 */
export function attackEnemyAt(dungeon: DungeonMap, targetX: integer, targetY: integer): boolean {
  const { x, y } = dungeon.getPlayerPos();
  const enemy = dungeon.getEnemy(targetX, targetY);
  if (!enemy) return false;
  if (!canAttack(dungeon, x, y, targetX, targetY)) return false;

  const player = dungeon.getPlayerInstance();
  if (!player) return false;

  const playerPower = player.getEffectiveStat('power');
  const damage = enemy.takeDamageFromPlayer(playerPower);
  EventBus.emit('attack-flash', 0xFFFFFF);
  EventBus.emit('message-log', `${enemy.getLabel()}に${damage}のダメージ！`, dungeon.getTurnCount());

  if (!enemy.isAlive()) {
    dungeon.removeEnemy(targetX, targetY);
    const levelsGained = player.addExp(enemy.getExp());
    EventBus.emit('message-log', `${enemy.getLabel()}を倒した！`, dungeon.getTurnCount());
    for (let i = 0; i < levelsGained; i++) {
      EventBus.emit('message-log', `レベルアップ！Lv${player.level}`, dungeon.getTurnCount());
    }
  }

  dungeon.dispatchObjectEvent();
  return true;
}

/**
 * プレイヤーが正面の敵を攻撃する
 * @returns 攻撃が実行された場合true、正面に敵がいない場合false
 */
export function attackPlayer(dungeon: DungeonMap): boolean {
  const { x, y, direction } = dungeon.getPlayerPos();
  const [dx, dy] = getDirectionOffset(direction);
  return attackEnemyAt(dungeon, x + dx, y + dy);
}

/**
 * プレイヤーが消耗品を使用する
 * @param instanceId 使用するアイテムのインスタンスID
 * @returns 使用に成功しターンを消費した場合true
 */
export function useConsumableItem(dungeon: DungeonMap, instanceId: string): boolean {
  const player = dungeon.getPlayerInstance();
  if (!player) return false;

  const inventory = player.getInventory();
  const item = inventory.getItemById(instanceId);
  if (!item || !item.isConsumable()) return false;

  const specs = item.getEffectSpecs();
  const hasAnyEffect = specs.some(s => s.immediate || s.continuous);

  if (!hasAnyEffect) {
    EventBus.emit('message-log', `${item.getLabel()}は何の効果も無い`, dungeon.getTurnCount());
    return false;
  }

  const messageParts: string[] = [];
  const effectsLoader = EffectsLoader.getInstance();

  for (const spec of specs) {
    if (spec.immediate) {
      const result = player.applyImmediateEffect(spec.immediate);
      const parts: string[] = [];
      for (const [stat, delta] of result.stats) {
        if (delta !== 0) parts.push(`${stat}が${delta > 0 ? '+' : ''}${delta}`);
      }
      for (const effName of result.appliedEffects) {
        const label = effectsLoader.getEffect(effName)?.label ?? effName;
        parts.push(`${label}状態になった`);
      }
      for (const effName of result.clearedEffects) {
        const label = effectsLoader.getEffect(effName)?.label ?? effName;
        parts.push(`${label}状態が消えた`);
      }
      if (parts.length) messageParts.push(parts.join('、'));
    }
    if (spec.continuous) {
      const applied = player.applyContinuousEffect(spec.continuous, item.getLabel());
      const parts: string[] = [];
      for (const [stat, value] of applied) {
        parts.push(`${stat}が${value > 0 ? '+' : ''}${value}`);
      }
      if (parts.length) messageParts.push(`${spec.continuous.turns}ターンの間 ${parts.join('、')}`);
    }
  }

  inventory.removeItemById(instanceId);
  EventBus.emit('message-log', `${item.getLabel()}を使った！${messageParts.length ? '（' + messageParts.join('、') + '）' : ''}`, dungeon.getTurnCount());

  dungeon.dispatchObjectEvent();
  return true;
}

/**
 * プレイヤーの装備を変更する
 * - 既に装備中のアイテムを指定した場合は装備解除（ターン消費なし）
 * - 未装備のアイテムを指定した場合は装備（1ターン消費）
 */
export function changeEquipment(dungeon: DungeonMap, instanceId: string): ChangeEquipmentResult {
  const player = dungeon.getPlayerInstance();
  if (!player) return { success: false, consumedTurn: false, action: 'none' };

  const inventory = player.getInventory();
  const item = inventory.getItemById(instanceId);
  if (!item || !item.isEquippable()) {
    return { success: false, consumedTurn: false, action: 'none' };
  }

  const slot = player.getEquippedSlotOf(item);
  if (slot !== null) {
    player.unequipItem(slot);
    EventBus.emit('message-log', `${item.getLabel()}を外した`, dungeon.getTurnCount());
    return { success: true, consumedTurn: false, action: 'unequipped' };
  }

  const previous = player.equipItem(item);
  if (previous) {
    EventBus.emit('message-log', `${previous.getLabel()}を外して${item.getLabel()}を装備した`, dungeon.getTurnCount());
  } else {
    EventBus.emit('message-log', `${item.getLabel()}を装備した`, dungeon.getTurnCount());
  }

  dungeon.dispatchObjectEvent();
  return { success: true, consumedTurn: true, action: 'equipped' };
}

export function searchAt(dungeon: DungeonMap, targetX: integer, targetY: integer): boolean {
  const { x, y } = dungeon.getPlayerPos();
  const turnCount = dungeon.getTurnCount();

  if (!dungeon.canAttack(x, y, targetX, targetY)) {
    // その方向は壁
    EventBus.emit('message-log', `そこには壁がある。`, turnCount);
  } else {
    const objects = dungeon.getObject(targetX, targetY);
    if (objects.length < 1) {
      EventBus.emit('message-log', `そこには何もない。`, turnCount);
    }
    for (const object of objects) {
      if (object instanceof Enemy) {
        EventBus.emit('message-log', `${object.getName()}がいる。`, turnCount);
      } else if (object.mark === MapMark.X_CROSS) {
        /** @todo 何が設置されているかが分かるように、トラップについてもMapObjectを継承したオブジェクトにするか、定義をMapObjectに持てるようにする */
        if (object.visible) {
          EventBus.emit('message-log', `トラップがある。`, turnCount);
        } else {
          object.visible = true;
          EventBus.emit('message-log', `トラップを発見した！`, turnCount);
        }
      } else if (object.mark === MapMark.CROSS) {
        /** @todo 何が設置されているかが分かるように、アイテムについてもMapObjectを継承したオブジェクトにするか、定義をMapObjectに持てるようにする */
        if (object.visible) {
          EventBus.emit('message-log', `アイテムがある。`, turnCount);
        } else {
          object.visible = true;
          EventBus.emit('message-log', `アイテムを発見した！`, turnCount);
        }
      } else if (object.mark === MapMark.CIRCLE) {
        /** @todo 何が設置されているかが分かるように、階段についてもMapObjectを継承したオブジェクトにするか、定義をMapObjectに持てるようにする */
        EventBus.emit('message-log', `階段がある。`, turnCount);
      }
    }
  }

  dungeon.dispatchObjectEvent();
  return true;
}