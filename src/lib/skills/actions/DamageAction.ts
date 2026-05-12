import { Parser, type Expression } from 'expr-eval-fork';
import { Player } from '../../Player';
import { Enemy } from '../../Enemy';
import { EventBus } from '../../../game/EventBus';
import { SkillsLoader } from '../../SkillsLoader';
import { BaseLoader } from '../../BaseLoader';
import type { DungeonMap } from '../../MapGenerator';
import type { TargetCell } from '../TargetResolver';

const parser = new Parser();
const formulaCache = new Map<string, Expression>();

function getFormula(src: string): Expression | null {
    let expr = formulaCache.get(src);
    if (expr) return expr;
    try {
        expr = parser.parse(src);
        formulaCache.set(src, expr);
        return expr;
    } catch (e) {
        console.warn(`Failed to parse damage formula "${src}":`, e);
        return null;
    }
}

/**
 * damage action: target スコープ内の各敵対エンティティに独自 formula でダメージを与える。
 *
 * 変数：
 *   - caster の実効値（<stat>）と最大値（<stat>_max）、level、exp
 *   - target の生ステータス（target_<stat>）と最大値（target_<stat>_max）
 *
 * 端数は Math.floor のみ。Math.max(1, ...) クランプは行わず 0 ダメージや負値も許容する
 * （負値の場合は addStat で fluctuation クランプを通すため、敵の HP 上限を超えて回復することはない）。
 *
 * 死亡時は除去 + caster の経験値加算 + レベルアップ + mastery 抽選ログを発行する。
 */
export function executeDamageAction(
    dungeon: DungeonMap,
    caster: Player,
    cells: TargetCell[],
    param: number | string,
): void {
    const enemies: Enemy[] = [];
    for (const { x, y } of cells) {
        const enemy = dungeon.getEnemy(x, y);
        if (enemy && enemy.isAlive()) enemies.push(enemy);
    }
    if (enemies.length === 0) return;

    const src = typeof param === 'number' ? String(param) : param;
    const formula = getFormula(src);
    if (!formula) return;

    EventBus.emit('attack-flash', 0xFFFFFF);
    const casterVarsBase = caster.getEffectiveFormulaVarsWithMax();
    const turn = dungeon.getTurnCount();
    const skillsLoader = SkillsLoader.getInstance();
    const damageStat = BaseLoader.getInstance().getDefaultEnemyDamageStat();

    for (const enemy of enemies) {
        const vars: Record<string, number> = { ...casterVarsBase };
        for (const [k, v] of enemy.getStats()) {
            vars[`target_${k}`] = v;
            vars[`target_${k}_max`] = enemy.getMaxStat(k);
        }

        let raw: unknown;
        try {
            raw = formula.evaluate(vars);
        } catch (e) {
            console.warn(`Failed to evaluate damage formula "${src}" for enemy "${enemy.getLabel()}":`, e);
            continue;
        }
        const damage = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;

        enemy.addStat(damageStat, -damage);
        EventBus.emit('message-log', `${enemy.getLabel()}に${damage}のダメージ！`, turn);

        if (!enemy.isAlive()) {
            dungeon.removeEnemy(enemy.x, enemy.y);
            const result = caster.addExp(enemy.getExp());
            EventBus.emit('message-log', `${enemy.getLabel()}を倒した！`, turn);
            for (const lv of result.levels) {
                EventBus.emit('message-log', `レベルアップ！Lv${lv.level}`, turn);
                for (const skillName of lv.learnedSkills) {
                    const label = skillsLoader.getSkill(skillName)?.label ?? skillName;
                    EventBus.emit('message-log', `スキル「${label}」を習得した！`, turn);
                }
            }
        }
    }
}
