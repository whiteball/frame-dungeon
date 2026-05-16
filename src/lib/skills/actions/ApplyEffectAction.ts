import { Parser, type Expression } from 'expr-eval-fork';
import { Player } from '../../Player';
import { EventBus } from '../../../game/EventBus';
import { EffectsLoader } from '../../EffectsLoader';
import type { DungeonMap } from '../../MapGenerator';
import type { TargetCell } from '../TargetResolver';

const parser = new Parser();
const formulaCache = new Map<string, Expression>();

function getRateFormula(src: string): Expression | null {
    let expr = formulaCache.get(src);
    if (expr) return expr;
    try {
        expr = parser.parse(src);
        formulaCache.set(src, expr);
        return expr;
    } catch (e) {
        console.warn(`Failed to parse apply_effect rate formula "${src}":`, e);
        return null;
    }
}

/**
 * apply_effect action: target スコープ内の各対象（プレイヤー or 敵）に状態異常を付与する。
 *
 * param 形式:
 *   - 文字列: effect 名（rate=1.0 固定）
 *   - オブジェクト: { effect: string, rate?: number | string }
 *     rate は数値リテラル([0,1]) または caster 実効値を変数とする数式文字列
 *
 * 付与結果:
 *   'applied'  → ログ発行
 *   'resisted' → 耐性ログ発行
 *   'unknown'  → 何もしない
 */
export function executeApplyEffectAction(
    dungeon: DungeonMap,
    caster: Player,
    cells: TargetCell[],
    param: string | Record<string, number | string>,
): void {
    let effectName: string;
    let rawRate: number | string = 1;

    if (typeof param === 'string') {
        effectName = param;
    } else {
        effectName = String(param.effect ?? '');
        if (param.rate !== undefined) rawRate = param.rate;
    }

    if (!effectName) {
        console.warn('apply_effect: effect name is empty');
        return;
    }

    let rate: number;
    if (typeof rawRate === 'number') {
        rate = rawRate;
    } else {
        const formula = getRateFormula(rawRate);
        if (!formula) {
            rate = 1;
        } else {
            const vars = caster.getEffectiveFormulaVarsWithMax();
            let raw: unknown;
            try {
                raw = formula.evaluate(vars);
            } catch (e) {
                console.warn(`apply_effect: failed to evaluate rate formula "${rawRate}":`, e);
                raw = 1;
            }
            const evaluated = typeof raw === 'number' && Number.isFinite(raw) ? raw : 1;
            rate = Math.min(1, Math.max(0, evaluated));
        }
    }

    const effectsLoader = EffectsLoader.getInstance();
    const effectLabel = effectsLoader.getEffect(effectName)?.label ?? effectName;
    const turn = dungeon.getTurnCount();
    const { x: px, y: py } = dungeon.getPlayerPos();

    for (const { x, y } of cells) {
        if (rate < 1.0 && Math.random() >= rate) continue;

        if (x === px && y === py) {
            const result = caster.applyStatusEffect(effectName);
            if (result === 'applied') {
                EventBus.emit('message-log', `${effectLabel}状態になった！`, turn);
            } else if (result === 'resisted') {
                EventBus.emit('message-log', `${effectLabel}を耐性で防いだ`, turn);
            }
        } else {
            const enemy = dungeon.getEnemy(x, y);
            if (!enemy || !enemy.isAlive()) continue;
            const result = enemy.applyStatusEffect(effectName);
            if (result === 'applied') {
                EventBus.emit('message-log', `${enemy.getLabel()}に${effectLabel}の状態になった！`, turn);
            } else if (result === 'resisted') {
                EventBus.emit('message-log', `${enemy.getLabel()}は${effectLabel}を耐性で防いだ`, turn);
            }
        }
    }
}
