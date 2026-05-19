'use strict';

import type { DungeonMap } from '../MapGenerator';
import { MapDirection, getDirectionOffset } from './MapDirection';
import { EffectsLoader } from '../EffectsLoader';
import { SkillsLoader } from '../SkillsLoader';
import { evaluateCost, canPayCost, payCost, executeActions } from '../skills/SkillExecutor';
import { resolveTarget, type TargetCell } from '../skills/TargetResolver';
import { EventBus } from '../../game/EventBus';
import { Enemy } from '../Enemy';
import { StairsObject, TrapObject, ItemObject } from './MapObjects';
import { tryEnemyDrop } from './EnemyDropResolver';

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
    if (!(val & (1 << dir))) return false;
    return !dungeon.isDoorPassable(x, y, dir as MapDirection);
  };

  if (dy === 0) {
    return !isSolidWall(fromX, fromY, dx > 0 ? MapDirection.EAST : MapDirection.WEST);
  }
  if (dx === 0) {
    return !isSolidWall(fromX, fromY, dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH);
  }
  // 斜め: 扉も通行不可として扱い、壁のない通路の角のみ通過可
  // 経路A: 横→縦 (fromX,fromY)→(toX,fromY)→(toX,toY)
  // 経路B: 縦→横 (fromX,fromY)→(fromX,toY)→(toX,toY)
  const isAnyWall = (x: integer, y: integer, dir: number): boolean => {
    return !!(dungeon.getAt(x, y) & (1 << dir));
  };
  const hDir = dx > 0 ? MapDirection.EAST : MapDirection.WEST;
  const vDir = dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH;
  const pathA = !isAnyWall(fromX, fromY, hDir) && !isAnyWall(toX, fromY, vDir);
  const pathB = !isAnyWall(fromX, fromY, vDir) && !isAnyWall(fromX, toY, hDir);
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

  const { dealt, cleared } = enemy.takeDamageFromPlayer(player.getEffectiveFormulaVars());
  EventBus.emit('attack-flash', 0xFFFFFF);
  EventBus.emit('message-log', `${enemy.getLabel()}に${dealt}のダメージ！`, dungeon.getTurnCount());
  for (const c of cleared) {
    EventBus.emit('message-log', `${enemy.getLabel()}の${c.label}が解けた`, dungeon.getTurnCount());
  }

  if (!enemy.isAlive()) {
    dungeon.removeEnemy(targetX, targetY);
    player.incrementEnemiesDefeated();
    tryEnemyDrop(dungeon, enemy, dungeon.getCurrentFloor());
    const result = player.addExp(enemy.getExp());
    EventBus.emit('message-log', `${enemy.getLabel()}を倒した！`, dungeon.getTurnCount());
    const skillsLoader = SkillsLoader.getInstance();
    for (const lv of result.levels) {
      EventBus.emit('message-log', `レベルアップ！Lv${lv.level}`, dungeon.getTurnCount());
      for (const skillName of lv.learnedSkills) {
        const label = skillsLoader.getSkill(skillName)?.label ?? skillName;
        EventBus.emit('message-log', `スキル「${label}」を習得した！`, dungeon.getTurnCount());
      }
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
    EventBus.emit('message-log', `${item.getLabelWithModifiers()}は何の効果も無い`, dungeon.getTurnCount());
    return false;
  }

  const messageParts: string[] = [];
  const effectsLoader = EffectsLoader.getInstance();

  const skillsLoader = SkillsLoader.getInstance();

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
      for (const effName of result.resistedEffects) {
        const label = effectsLoader.getEffect(effName)?.label ?? effName;
        parts.push(`${label}を耐性で防いだ`);
      }
      for (const effName of result.clearedEffects) {
        const label = effectsLoader.getEffect(effName)?.label ?? effName;
        parts.push(`${label}状態が消えた`);
      }
      for (const skillName of result.learnedSkills) {
        const label = skillsLoader.getSkill(skillName)?.label ?? skillName;
        parts.push(`スキル「${label}」を習得した`);
      }
      for (const skillName of result.alreadyLearnedSkills) {
        const label = skillsLoader.getSkill(skillName)?.label ?? skillName;
        parts.push(`スキル「${label}」は習得済み`);
      }
      for (const m of result.addedModifiers) {
        if (m.countable) {
          parts.push(`${m.itemLabel}に「${m.modifierLabel}」が付与（count=${m.newCount}）`);
        } else {
          parts.push(`${m.itemLabel}に「${m.modifierLabel}」が付与`);
        }
      }
      for (const r of result.removedModifiers) {
        parts.push(`${r.itemLabel}から ${r.modifierNames.length} 個の修飾状態を解除`);
      }
      if (result.modifierNoTarget && result.addedModifiers.length === 0 && result.removedModifiers.length === 0) {
        parts.push(`しかし何も起こらなかった`);
      }
      if (parts.length) messageParts.push(parts.join('、'));
    }
    if (spec.continuous) {
      const applied = player.applyContinuousEffect(spec.continuous, item.getLabel());
      const parts: string[] = [];
      for (const [stat, value] of applied) {
        parts.push(`${stat}が${value > 0 ? '+' : ''}${value}`);
      }
      if (Array.isArray(spec.continuous.resist)) {
        for (const effName of spec.continuous.resist) {
          const label = effectsLoader.getEffect(effName)?.label ?? effName;
          parts.push(`${label}に耐性`);
        }
      }
      if (parts.length) messageParts.push(`${spec.continuous.turns}ターンの間 ${parts.join('、')}`);
    }
  }

  inventory.removeItemById(instanceId);
  player.incrementItemsUsed();
  EventBus.emit('message-log', `${item.getLabelWithModifiers()}を使った！${messageParts.length ? '（' + messageParts.join('、') + '）' : ''}`, dungeon.getTurnCount());

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

  const turnCount = dungeon.getTurnCount();
  const slot = player.getEquippedSlotOf(item);
  if (slot !== null) {
    if (!item.canUnequip()) {
      EventBus.emit('message-log', `${item.getLabelWithModifiers()}は呪われていて外せない！`, turnCount);
      return { success: false, consumedTurn: false, action: 'none' };
    }
    player.unequipItem(slot);
    EventBus.emit('message-log', `${item.getLabelWithModifiers()}を外した`, turnCount);
    return { success: true, consumedTurn: false, action: 'unequipped' };
  }

  // 新規装備: 置き換え対象スロットの既存装備が外せないかを事前検査
  const targetSlot = player.predictEquipSlot(item);
  if (targetSlot) {
    const blocking = player.getItemInSlot(targetSlot);
    if (blocking && !blocking.canUnequip()) {
      EventBus.emit('message-log', `${blocking.getLabelWithModifiers()}は呪われていて外せない！`, turnCount);
      return { success: false, consumedTurn: false, action: 'none' };
    }
  }

  const previous = player.equipItem(item);
  if (previous) {
    EventBus.emit('message-log', `${previous.getLabelWithModifiers()}を外して${item.getLabelWithModifiers()}を装備した`, turnCount);
  } else {
    EventBus.emit('message-log', `${item.getLabelWithModifiers()}を装備した`, turnCount);
  }

  dungeon.dispatchObjectEvent();
  return { success: true, consumedTurn: true, action: 'equipped' };
}

/**
 * プレイヤーがスキルを発動する（Phase 8: attack action 実装）
 *
 * 現時点で実装済み：コスト評価・支払い・差し戻し + target スコープ解決 +
 * action 配列の順次実行（attack のみ実装、他はモック）。
 * 後続フェーズで以下を実装する：
 *   - Phase 9〜11: 各 action（damage / heal / reveal_trap）
 *   - Phase 12: スタン中の発動ブロック
 *
 * @param skillName 発動するスキル名
 * @param selectedTarget target=front の場合に UI で選ばれた対象セル
 * @returns 発動成功時 true（ターン消費あり）。
 *          プレイヤー未設定／未習得／未定義／front 対象未選択／コスト支払い不能の場合 false（ターン非消費）
 */
export function useSkill(
  dungeon: DungeonMap,
  skillName: string,
  selectedTarget?: TargetCell,
): boolean {
  const player = dungeon.getPlayerInstance();
  if (!player) return false;

  // スタン中（_action: skip）はスキル発動も封じる。W/Space と同じ「動けない！」処理
  if (player.getPlayerActionDirective() === 'skip') {
    EventBus.emit('message-log', '動けない！', dungeon.getTurnCount());
    dungeon.dispatchObjectEvent();
    return true;
  }

  if (!player.hasSkill(skillName)) return false;
  const compiled = SkillsLoader.getInstance().getCompiledSkill(skillName);
  if (!compiled) return false;
  const def = compiled.definition;

  // on_attack パッシブスキルはプレイヤーが能動的に使用できない
  if ((def.trigger ?? 'active') === 'on_attack') return false;

  // target 解決（front は selectedTarget 必須）
  const targetCells = resolveTarget(def.target, dungeon, selectedTarget);
  if (def.target === 'front' && targetCells.length === 0) {
    EventBus.emit('message-log',
      `スキル「${def.label}」を発動できない（対象が選択されていない）`,
      dungeon.getTurnCount());
    return false;
  }

  // コスト評価・検証（差し戻し時はステータス未変更）
  const deltas = evaluateCost(player, compiled);
  if (!canPayCost(player, deltas)) {
    EventBus.emit('message-log',
      `スキル「${def.label}」を発動できない（コストを支払えない）`,
      dungeon.getTurnCount());
    return false;
  }

  // コスト支払い
  payCost(player, deltas);

  // 発動開始ログ（区切り用）
  EventBus.emit('message-log',
    `スキル「${def.label}」を発動した！`,
    dungeon.getTurnCount());

  // action 配列を順次実行
  executeActions(dungeon, player, compiled, targetCells);

  dungeon.dispatchObjectEvent();
  return true;
}

export function searchAt(dungeon: DungeonMap, targetX: integer, targetY: integer): boolean {
  const { x, y } = dungeon.getPlayerPos();
  const turnCount = dungeon.getTurnCount();

  // 隠し扉判定: ターゲットセル（前方／前方斜め）に対応する位置の隠し扉があれば顕在化
  // - 前方（dx,dy）: プレイヤーのその方向の壁
  // - 前方斜め: 前方セルの縦方向壁、または横セルの横方向壁（斜めから見える 2 つの壁を候補に）
  const dx = targetX - x;
  const dy = targetY - y;
  const candidateDoors: { x: integer, y: integer, dir: MapDirection }[] = [];
  if (Math.abs(dx) === 1 && dy === 0) {
    candidateDoors.push({ x, y, dir: dx > 0 ? MapDirection.EAST : MapDirection.WEST });
  } else if (dx === 0 && Math.abs(dy) === 1) {
    candidateDoors.push({ x, y, dir: dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH });
  } else if (Math.abs(dx) === 1 && Math.abs(dy) === 1) {
    const hDir = dx > 0 ? MapDirection.EAST : MapDirection.WEST;
    const vDir = dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH;
    // 前方セルの縦壁（前方→斜め）
    candidateDoors.push({ x: x + dx, y, dir: vDir });
    // 横セルの横壁（横→斜め）
    candidateDoors.push({ x, y: y + dy, dir: hDir });
  }
  for (const c of candidateDoors) {
    if (dungeon.isDisguisedDoor(c.x, c.y, c.dir)) {
      dungeon.revealDisguisedDoor(c.x, c.y, c.dir);
      EventBus.emit('message-log', `隠し扉を発見した！`, turnCount);
      dungeon.dispatchObjectEvent();
      return true;
    }
  }

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
        EventBus.emit('message-log', `${object.getLabel()}がいる。`, turnCount);
      } else if (object instanceof TrapObject) {
        if (object.visible) {
          EventBus.emit('message-log', `${object.trapDef.label}がある。`, turnCount);
        } else {
          object.visible = true;
          EventBus.emit('message-log', `${object.trapDef.label}を発見した！`, turnCount);
        }
      } else if (object instanceof ItemObject) {
        if (object.visible) {
          EventBus.emit('message-log', `${object.item.getLabelWithModifiers()}がある。`, turnCount);
        } else {
          object.visible = true;
          EventBus.emit('message-log', `${object.item.getLabelWithModifiers()}を発見した！`, turnCount);
        }
      } else if (object instanceof StairsObject) {
        EventBus.emit('message-log', `階段がある。`, turnCount);
      }
    }
  }

  dungeon.dispatchObjectEvent();
  return true;
}