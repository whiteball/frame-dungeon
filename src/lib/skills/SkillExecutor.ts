import { Player } from '../Player';
import { BaseLoader } from '../BaseLoader';
import { StatsLoader } from '../StatsLoader';
import type { CompiledSkill } from '../SkillsLoader';

/**
 * コスト formula を評価し、各ステータスの差分（負値）を返す。
 * 端数は Math.floor、負値結果は警告 + 0 にクランプ。
 * 評価変数は player.getEffectiveFormulaVarsWithMax（実効値 + <stat>_max）。
 */
export function evaluateCost(player: Player, compiled: CompiledSkill): Map<string, number> {
    const vars = player.getEffectiveFormulaVarsWithMax();
    const deltas = new Map<string, number>();
    for (const [stat, formula] of compiled.cost) {
        let raw: unknown;
        try {
            raw = formula.evaluate(vars);
        } catch (e) {
            console.warn(`Failed to evaluate cost for ${stat} in skill "${compiled.definition.name}":`, e);
            raw = 0;
        }
        let cost = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
        if (cost < 0) {
            console.warn(`Negative cost for ${stat} in skill "${compiled.definition.name}": ${cost}, clamped to 0`);
            cost = 0;
        }
        deltas.set(stat, -cost);
    }
    return deltas;
}

/**
 * コスト適用後のステータスが破綻しないか検証する。
 * - いずれかのステータスが < 0 にならないか
 * - BaseLoader.isDead が真にならないか
 * 仮想評価のみで、player のステータスは変更しない。
 */
export function canPayCost(player: Player, deltas: Map<string, number>): boolean {
    const postVars: Record<string, number> = { ...player.getFormulaVars() };
    for (const [stat, delta] of deltas) {
        const next = (postVars[stat] ?? 0) + delta;
        if (next < 0) return false;
        postVars[stat] = next;
    }
    if (BaseLoader.getInstance().isDead(postVars)) return false;
    return true;
}

/**
 * コストを実際に適用する（addStat 経由で fluctuation クランプを通す）。
 * 事前に canPayCost で OK を確認してから呼ぶこと。
 */
export function payCost(player: Player, deltas: Map<string, number>): void {
    for (const [stat, delta] of deltas) {
        player.addStat(stat, delta);
    }
}

/**
 * コスト要約文字列を生成する。例: "HP:10, MP:2"
 * 値が 0 のエントリは省略。
 */
export function formatCostSummary(deltas: Map<string, number>): string {
    const stats = StatsLoader.getInstance();
    const parts: string[] = [];
    for (const [stat, delta] of deltas) {
        if (delta === 0) continue;
        const abbr = stats.getAbbreviation(stat);
        parts.push(`${abbr}:${-delta}`);
    }
    return parts.join(', ');
}
