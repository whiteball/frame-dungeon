'use strict';

import type { DungeonMap } from '../MapGenerator';
import { MapDirection } from './MapDirection';
import { EffectsLoader } from '../EffectsLoader';
import { EventBus } from '../../game/EventBus';

/**
 * プレイヤーのターン消費アクション群
 *
 * いずれも DungeonMap を引数に取り、戦闘・アイテム使用・装備変更を実行する。
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
 * プレイヤーが正面の敵を攻撃する
 * @returns 攻撃が実行された場合true、正面に敵がいない場合false
 */
export function attackPlayer(dungeon: DungeonMap): boolean {
  const { x, y, direction } = dungeon.getPlayerPos();
  let destX = x;
  let destY = y;
  switch (direction) {
    case MapDirection.EAST:  destX += 1; break;
    case MapDirection.SOUTH: destY += 1; break;
    case MapDirection.WEST:  destX -= 1; break;
    case MapDirection.NORTH: destY -= 1; break;
  }
  const enemy = dungeon.getEnemy(destX, destY);
  if (!enemy) return false;
  if (!canAttack(dungeon, x, y, destX, destY)) return false;

  const player = dungeon.getPlayerInstance();
  if (!player) return false;

  const playerPower = player.getEffectiveStat('power');
  const damage = enemy.takeDamageFromPlayer(playerPower);
  EventBus.emit('attack-flash', 0xFFFFFF);
  EventBus.emit('message-log', `${enemy.getLabel()}に${damage}のダメージ！`, dungeon.getTurnCount());

  if (!enemy.isAlive()) {
    dungeon.removeEnemy(destX, destY);
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
