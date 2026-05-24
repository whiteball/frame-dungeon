import { Parser, type Expression } from 'expr-eval-fork';
import { SkillsLoader } from '../SkillsLoader';
import { EffectsLoader } from '../EffectsLoader';
import { BaseLoader } from '../BaseLoader';
import { EventBus } from '../../game/EventBus';
import type { DungeonMap } from '../MapGenerator';
import type { Enemy } from '../Enemy';
import type { Player } from '../Player';
import { parseActionEntry } from './SkillExecutor';

const parser = new Parser();
const damageFormulaCache = new Map<string, Expression>();

function getDamageFormula(src: string): Expression | null {
    let expr = damageFormulaCache.get(src);
    if (expr) return expr;
    try {
        expr = parser.parse(src);
        damageFormulaCache.set(src, expr);
        return expr;
    } catch (e) {
        console.warn(`Failed to parse enemy damage formula "${src}":`, e);
        return null;
    }
}

/**
 * on_attack パッシブスキルを実行する。
 * attackPlayer() 完了後（ダメージ適用済み）に呼び出し、
 * プレイヤーが生存している場合のみ効果を付与する。
 */
export function executeEnemyOnAttackSkill(
    dungeon: DungeonMap,
    enemy: Enemy,
    skillName: string,
): void {
    const compiled = SkillsLoader.getInstance().getCompiledSkill(skillName);
    if (!compiled) {
        console.warn(`EnemySkillExecutor: skill "${skillName}" not found`);
        return;
    }
    const def = compiled.definition;
    if ((def.trigger ?? 'active') !== 'on_attack') {
        console.warn(`EnemySkillExecutor: skill "${skillName}" is not an on_attack trigger`);
        return;
    }

    const player = dungeon.getPlayerInstance();
    if (!player || BaseLoader.getInstance().isDead(player.getFormulaVars())) return;

    const turn = dungeon.getTurnCount();

    for (const entry of def.action ?? []) {
        const { name, param } = parseActionEntry(entry);
        if (name === 'apply_effect') {
            applyEffectToPlayer(enemy, player, param, turn);
        } else if (name === 'damage') {
            if (param === null || typeof param === 'object') {
                console.warn(`EnemySkillExecutor: damage action requires a scalar parameter in skill "${skillName}"`);
                continue;
            }
            applyAdditionalDamageToPlayer(enemy, player, param, turn);
            // ダメージで死亡したら以降の action は無意味
            if (BaseLoader.getInstance().isDead(player.getFormulaVars())) break;
        }
    }
}

/**
 * 敵の追加ダメージを計算してプレイヤーに適用する。
 * 通常攻撃のダメージとは別に message-log を発行する（attack-flash は二重発火を避けるため省略）。
 *
 * 変数：
 *   - caster（敵）側：<stat> / <stat>_max（生ステータス）
 *   - target（プレイヤー）側：target_<stat> / target_<stat>_max（実効値 + 実効最大）
 */
function applyAdditionalDamageToPlayer(
    enemy: Enemy,
    player: Player,
    param: number | string,
    turn: number,
): void {
    const src = typeof param === 'number' ? String(param) : param;
    const formula = getDamageFormula(src);
    if (!formula) return;

    const vars: Record<string, number> = {};
    for (const k of enemy.getStats().keys()) {
        vars[k] = enemy.getEffectiveStat(k);
        vars[`${k}_max`] = enemy.getMaxStat(k);
    }
    for (const k of player.getStats().keys()) {
        vars[`target_${k}`] = player.getEffectiveStat(k);
        vars[`target_${k}_max`] = player.getEffectiveMaxStat(k);
    }

    let raw: unknown;
    try {
        raw = formula.evaluate(vars);
    } catch (e) {
        console.warn(`Failed to evaluate enemy damage formula "${src}":`, e);
        return;
    }
    const damage = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
    if (damage === 0) return;

    const baseLoader = BaseLoader.getInstance();
    const targetStat = baseLoader.getDefaultDamageStat();
    player.addStat(targetStat, -damage);
    EventBus.emit('message-log', `${enemy.getLabel()}の追撃で${damage}のダメージ！`, turn);
}

function applyEffectToPlayer(
    enemy: Enemy,
    player: { applyStatusEffect(name: string): 'applied' | 'resisted' | 'unknown' },
    param: number | string | Record<string, number | string> | null,
    turn: number,
): void {
    let effectName: string;
    let rate = 1.0;

    if (typeof param === 'string') {
        effectName = param;
    } else if (param && typeof param === 'object') {
        effectName = String(param.effect ?? '');
        if (typeof param.rate === 'number') rate = param.rate;
    } else {
        console.warn('EnemySkillExecutor: apply_effect missing param');
        return;
    }

    if (!effectName) return;
    if (rate < 1.0 && Math.random() >= rate) return;

    const result = player.applyStatusEffect(effectName);
    const effLabel = EffectsLoader.getInstance().getEffect(effectName)?.label ?? effectName;
    if (result === 'applied') {
        EventBus.emit('message-log', `${enemy.getLabel()}の攻撃で${effLabel}状態になった！`, turn);
    } else if (result === 'resisted') {
        EventBus.emit('message-log', `${enemy.getLabel()}の${effLabel}を耐性で防いだ！`, turn);
    }
}
