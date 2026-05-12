import { Parser, type Expression } from 'expr-eval-fork';
import { Player } from '../../Player';
import { Enemy } from '../../Enemy';
import { EventBus } from '../../../game/EventBus';
import { BaseLoader } from '../../BaseLoader';
import { StatsLoader } from '../../StatsLoader';
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
        console.warn(`Failed to parse heal formula "${src}":`, e);
        return null;
    }
}

/**
 * heal action: target スコープ内のエンティティ（caster 含む可能性あり）に
 * defaultDamageStat（通常 life=HP）を回復させる。
 *
 * 変数：
 *   - caster の実効値 <stat> / <stat>_max / level / exp
 *   - target の生ステータス target_<stat> / target_<stat>_max
 *
 * 端数は Math.floor。負値は警告 + 0 クランプ。回復は addStat で適用されるため
 * fluctuation クランプ（最大値上限）が自動で通る。
 *
 * 対象判定：
 *   - cells に caster の現在位置が含まれる場合（target: self）→ caster を対象に含む
 *   - 各 cell の Enemy が生存中なら対象に含む
 */
export function executeHealAction(
    dungeon: DungeonMap,
    caster: Player,
    cells: TargetCell[],
    param: number | string,
): void {
    const { x: px, y: py } = dungeon.getPlayerPos();
    const entities: Array<Player | Enemy> = [];
    for (const { x, y } of cells) {
        if (x === px && y === py) {
            entities.push(caster);
        }
        const enemy = dungeon.getEnemy(x, y);
        if (enemy && enemy.isAlive()) {
            entities.push(enemy);
        }
    }
    if (entities.length === 0) return;

    const src = typeof param === 'number' ? String(param) : param;
    const formula = getFormula(src);
    if (!formula) return;

    const casterVarsBase = caster.getEffectiveFormulaVarsWithMax();
    const turn = dungeon.getTurnCount();
    const healStat = BaseLoader.getInstance().getDefaultDamageStat();
    const abbr = StatsLoader.getInstance().getAbbreviation(healStat);

    for (const entity of entities) {
        // target_<stat> / target_<stat>_max を vars に追加
        const vars: Record<string, number> = { ...casterVarsBase };
        if (entity instanceof Enemy) {
            for (const [k, v] of entity.getStats()) {
                vars[`target_${k}`] = v;
                vars[`target_${k}_max`] = entity.getMaxStat(k);
            }
        } else {
            // caster 自身（target=self）
            for (const [k] of caster.getStats()) {
                vars[`target_${k}`] = caster.getStat(k);
                vars[`target_${k}_max`] = caster.getMaxStat(k);
            }
        }

        let raw: unknown;
        try {
            raw = formula.evaluate(vars);
        } catch (e) {
            console.warn(`Failed to evaluate heal formula "${src}":`, e);
            continue;
        }
        let heal = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
        if (heal < 0) {
            console.warn(`Negative heal value (${heal}) in skill heal action, clamped to 0`);
            heal = 0;
        }
        if (heal === 0) continue;

        const before = entity.getStat(healStat);
        entity.addStat(healStat, heal);
        const actualDelta = entity.getStat(healStat) - before;
        if (actualDelta === 0) continue;

        if (entity instanceof Enemy) {
            EventBus.emit('message-log', `${entity.getLabel()}の${abbr}が${actualDelta}回復した`, turn);
        } else {
            EventBus.emit('message-log', `${abbr}が${actualDelta}回復した`, turn);
        }
    }
}
