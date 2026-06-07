'use strict';

import { EventBus } from '../../game/EventBus';
import { BaseLoader } from '../BaseLoader';
import { StatsLoader } from '../StatsLoader';
import { EffectsLoader } from '../EffectsLoader';
import { SkillsLoader } from '../SkillsLoader';
import { ItemObject } from './MapObjects';
import { MapDirection } from './MapDirection';
import { findDropTarget, tryEnemyDrop } from './EnemyDropResolver';
import { executeDamageAction } from '../skills/actions/DamageAction';
import { executeApplyEffectAction } from '../skills/actions/ApplyEffectAction';
import type { DungeonMap } from '../MapGenerator';
import type { Player } from '../Player';
import type { Enemy } from '../Enemy';
import type { Item } from '../Item';
import type { ThrowEffectEntry } from '../ItemsLoader';
import type { TargetCell } from '../skills/TargetResolver';

/**
 * アイテム投擲の着弾・命中解決をまとめるモジュール。
 *
 * プレイヤー位置を起点に単位ベクトル (stepDx, stepDy)（cardinal または diagonal）で
 * 直線走査し、壁・扉・進入不可オブジェクト・射程到達で停止して床にドロップ、
 * 敵に命中したら効果を発揮してアイテムを消滅させる。
 *
 * - 走査の境界判定（扉も「壁」として遮蔽）は {@link canProjectileStep}
 * - 着地ドロップ先は {@link findDropTarget}（ItemObject・敵・トラップ・プレイヤーを回避）
 * - 命中効果の優先順位: throwEffect ＞ 武器の仮装備ダメージ ＞ 消費アイテムの効果転用 ＞ 投げ損
 */

/** 指定セル・指定方向に壁ビットがあるか（扉も壁として扱う＝投擲は扉で停止する） */
function isAnyWall(dungeon: DungeonMap, x: integer, y: integer, dir: MapDirection): boolean {
    return !!(dungeon.getAt(x, y) & (1 << dir));
}

/**
 * (fromX, fromY) から単位ベクトル (dx, dy) 方向へ投擲物が進めるかを判定する。
 * 扉も壁扱いで遮蔽する点が canAttack と異なる。斜めは canAttack と同じ
 * 2 本の L 字経路（pathA / pathB）のいずれかが開いていれば通過可。
 */
function canProjectileStep(dungeon: DungeonMap, fromX: integer, fromY: integer, dx: integer, dy: integer): boolean {
    const toX = fromX + dx;
    const toY = fromY + dy;
    if (dungeon.getAt(toX, toY) === -1) return false;

    if (dy === 0) {
        return !isAnyWall(dungeon, fromX, fromY, dx > 0 ? MapDirection.EAST : MapDirection.WEST);
    }
    if (dx === 0) {
        return !isAnyWall(dungeon, fromX, fromY, dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH);
    }
    const hDir = dx > 0 ? MapDirection.EAST : MapDirection.WEST;
    const vDir = dy > 0 ? MapDirection.SOUTH : MapDirection.NORTH;
    const pathA = !isAnyWall(dungeon, fromX, fromY, hDir) && !isAnyWall(dungeon, toX, fromY, vDir);
    const pathB = !isAnyWall(dungeon, fromX, fromY, vDir) && !isAnyWall(dungeon, fromX, toY, hDir);
    return pathA || pathB;
}

/**
 * 投擲物を直線走査して着弾・命中を解決する。
 * 呼び出し側（PlayerActions.throwItem）は事前にアイテムをインベントリから除去し、
 * 「○を投げた」ログを出した上でこの関数に Item インスタンスを渡す。
 */
export function resolveThrow(
    dungeon: DungeonMap,
    player: Player,
    item: Item,
    stepDx: integer,
    stepDy: integer,
): void {
    const turn = dungeon.getTurnCount();
    const { x: px, y: py } = dungeon.getPlayerPos();

    const baseRange = BaseLoader.getInstance().getThrowRange();
    const range = baseRange > 0
        ? baseRange + Math.max(0, player.getEffectiveStat('throwRange'))
        : Infinity;

    let cx = px;
    let cy = py;
    let steps = 0;

    while (true) {
        // 境界（壁・扉）で停止して手前セルにドロップ
        if (!canProjectileStep(dungeon, cx, cy, stepDx, stepDy)) {
            dropThrownItem(dungeon, item, cx, cy, turn);
            return;
        }
        const nx = cx + stepDx;
        const ny = cy + stepDy;

        // 敵に命中 → 効果発揮してアイテム消滅
        const enemy = dungeon.getEnemy(nx, ny);
        if (enemy && enemy.isAlive()) {
            EventBus.emit('message-log', `${enemy.getLabel()}に当たった！`, turn);
            applyThrowHit(dungeon, player, item, enemy, turn);
            return;
        }

        // 進入不可オブジェクト（宝箱・blocking イベント）→ 手前で停止しドロップ
        if (dungeon.isCellBlocked(nx, ny)) {
            dropThrownItem(dungeon, item, cx, cy, turn);
            return;
        }

        cx = nx;
        cy = ny;
        steps++;
        if (steps >= range) {
            dropThrownItem(dungeon, item, cx, cy, turn);
            return;
        }
    }
}

/** 着地セル (x, y)（置けなければ近傍）に ItemObject として配置する。 */
function dropThrownItem(dungeon: DungeonMap, item: Item, x: integer, y: integer, turn: number): void {
    const target = findDropTarget(dungeon, x, y);
    if (!target) {
        EventBus.emit('message-log', `${item.getLabelWithModifiers()}は落ちる場所がなく失われた`, turn);
        return;
    }
    const obj = new ItemObject(item);
    obj.x = target.x;
    obj.y = target.y;
    dungeon.placeObject(obj);
    EventBus.emit('message-log', `${item.getLabelWithModifiers()}が床に落ちた`, turn);
}

/** 敵に命中したときの効果を優先順位に従って適用する（アイテムは呼び出し側で既に消滅扱い）。 */
function applyThrowHit(dungeon: DungeonMap, player: Player, item: Item, enemy: Enemy, turn: number): void {
    const def = item.getDefinition();

    // 1. throwEffect 最優先
    if (def.throwEffect && def.throwEffect.length > 0) {
        applyThrowEffectEntries(dungeon, player, enemy, def.throwEffect, turn);
        return;
    }

    // 2. 武器 → 仮装備ダメージ
    if (item.isWeapon()) {
        EventBus.emit('attack-flash', 0xFFFFFF);
        const { dealt, cleared } = enemy.takeDamageFromPlayer(player.getThrownWeaponFormulaVars(item));
        EventBus.emit('message-log', `${enemy.getLabel()}に${dealt}のダメージ！`, turn);
        for (const c of cleared) {
            EventBus.emit('message-log', `${enemy.getLabel()}の${c.label}が解けた`, turn);
        }
        if (!enemy.isAlive()) awardEnemyDefeat(dungeon, player, enemy, turn);
        return;
    }

    // 3. 消費アイテム → 敵に転用可能な効果のみ適用
    if (item.isConsumable()) {
        applyConsumableToEnemy(dungeon, player, enemy, item, turn);
        return;
    }

    // 4. 防具・その他 → 投げ損
    EventBus.emit('message-log', `${item.getLabelWithModifiers()}は当たったが、特に効果はなかった`, turn);
}

/** throwEffect エントリ配列を順次適用する。各 action 前に敵の生存を確認する。 */
function applyThrowEffectEntries(
    dungeon: DungeonMap,
    player: Player,
    enemy: Enemy,
    entries: ThrowEffectEntry[],
    turn: number,
): void {
    const effectsLoader = EffectsLoader.getInstance();
    for (const entry of entries) {
        if (!enemy.isAlive()) break;
        const cell: TargetCell = { x: enemy.x, y: enemy.y };

        if (entry.damage !== undefined) {
            // executeDamageAction が死亡時の除去・経験値・ドロップまで処理する
            executeDamageAction(dungeon, player, [cell], entry.damage);
            if (!enemy.isAlive()) continue;
        }
        if (entry.apply_effect !== undefined) {
            executeApplyEffectAction(dungeon, player, [cell], entry.apply_effect as string | Record<string, number | string>);
        }
        if (entry.clear_effect !== undefined) {
            if (enemy.clearStatusEffect(entry.clear_effect)) {
                const label = effectsLoader.getEffect(entry.clear_effect)?.label ?? entry.clear_effect;
                EventBus.emit('message-log', `${enemy.getLabel()}の${label}が解けた`, turn);
            }
        }
    }
}

/**
 * 消費アイテムの効果のうち、敵に転用可能なもののみを適用する。
 * immediate:
 * - applyEffect: 状態異常付与
 * - clearEffect: 状態異常解除（利敵も許容）
 * - 数値 stat: addStat（max クランプ・死亡フラグは Enemy 側で処理。life 減少はダメージ表記）
 * continuous: 数ターンの能力値変動／耐性を敵にも付与（Enemy.applyContinuousEffect）。
 * learnSkill / executeSkill / add_modifier / remove_modifier_kind は無視（敵に無意味）。
 */
function applyConsumableToEnemy(
    dungeon: DungeonMap,
    player: Player,
    enemy: Enemy,
    item: Item,
    turn: number,
): void {
    const effectsLoader = EffectsLoader.getInstance();
    const statsLoader = StatsLoader.getInstance();
    const damageStat = BaseLoader.getInstance().getDefaultEnemyDamageStat();
    let anything = false;

    for (const spec of item.getEffectSpecs()) {
        const imm = spec.immediate;
        if (imm) {
            for (const [key, value] of Object.entries(imm)) {
                if (!enemy.isAlive()) break;
                if (key === 'applyEffect') {
                    if (typeof value !== 'string') continue;
                    const r = enemy.applyStatusEffect(value);
                    const label = effectsLoader.getEffect(value)?.label ?? value;
                    if (r === 'applied') {
                        EventBus.emit('message-log', `${enemy.getLabel()}は${label}状態になった！`, turn);
                        anything = true;
                    } else if (r === 'resisted') {
                        EventBus.emit('message-log', `${enemy.getLabel()}は${label}を耐性で防いだ`, turn);
                        anything = true;
                    }
                } else if (key === 'clearEffect') {
                    if (typeof value === 'string' && enemy.clearStatusEffect(value)) {
                        const label = effectsLoader.getEffect(value)?.label ?? value;
                        EventBus.emit('message-log', `${enemy.getLabel()}の${label}が解けた`, turn);
                        anything = true;
                    }
                } else if (typeof value === 'number') {
                    const before = enemy.getStat(key);
                    enemy.addStat(key, value);
                    const delta = enemy.getStat(key) - before;
                    if (delta === 0) continue;
                    anything = true;
                    if (key === damageStat && delta < 0) {
                        EventBus.emit('attack-flash', 0xFF2222);
                        EventBus.emit('message-log', `${enemy.getLabel()}に${-delta}のダメージ！`, turn);
                        const cleared = enemy.notifyDamageTaken();
                        for (const c of cleared) {
                            EventBus.emit('message-log', `${enemy.getLabel()}の${c.label}が解けた`, turn);
                        }
                    } else {
                        const abbr = statsLoader.getAbbreviation(key) || key;
                        EventBus.emit('message-log', `${enemy.getLabel()}の${abbr}が${delta > 0 ? '+' : ''}${delta}`, turn);
                    }
                }
            }
        }
        // continuous（持続効果）を敵に付与する
        if (spec.continuous && enemy.isAlive()) {
            const applied = enemy.applyContinuousEffect(spec.continuous, item.getLabel());
            const parts: string[] = [];
            for (const [stat, value] of applied) {
                const abbr = statsLoader.getAbbreviation(stat) || stat;
                parts.push(`${abbr}が${value > 0 ? '+' : ''}${value}`);
            }
            if (Array.isArray(spec.continuous.resist)) {
                for (const effName of spec.continuous.resist) {
                    const label = effectsLoader.getEffect(effName)?.label ?? effName;
                    parts.push(`${label}に耐性`);
                }
            }
            if (parts.length) {
                EventBus.emit('message-log', `${enemy.getLabel()}は${spec.continuous.turns}ターンの間 ${parts.join('、')}`, turn);
                anything = true;
            }
        }
    }

    if (!anything) {
        EventBus.emit('message-log', `${item.getLabelWithModifiers()}は当たったが、特に効果はなかった`, turn);
    }
    if (!enemy.isAlive()) {
        awardEnemyDefeat(dungeon, player, enemy, turn);
    }
}

/**
 * 敵撃破時の共通処理（マップ除去・撃破数・ドロップ・経験値・レベルアップログ）。
 * AttackAction / DamageAction の撃破処理と同等。投擲の武器ダメージ・数値 stat 経路で共用する。
 */
function awardEnemyDefeat(dungeon: DungeonMap, player: Player, enemy: Enemy, turn: number): void {
    dungeon.removeEnemy(enemy.x, enemy.y);
    player.incrementEnemiesDefeated();
    tryEnemyDrop(dungeon, enemy, dungeon.getCurrentFloor());
    const result = player.addExp(enemy.getExp());
    EventBus.emit('message-log', `${enemy.getLabel()}を倒した！`, turn);
    const skillsLoader = SkillsLoader.getInstance();
    for (const lv of result.levels) {
        EventBus.emit('message-log', `レベルアップ！Lv${lv.level}`, turn);
        for (const skillName of lv.learnedSkills) {
            const label = skillsLoader.getSkill(skillName)?.label ?? skillName;
            EventBus.emit('message-log', `スキル「${label}」を習得した！`, turn);
        }
    }
}
