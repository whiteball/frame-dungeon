import { Player } from '../Player';
import { BaseLoader } from '../BaseLoader';
import { StatsLoader } from '../StatsLoader';
import type { CompiledSkill, SkillActionEntry } from '../SkillsLoader';
import type { DungeonMap } from '../MapGenerator';
import type { TargetCell } from './TargetResolver';
import { executeAttackAction } from './actions/AttackAction';
import { executeDamageAction } from './actions/DamageAction';
import { executeHealAction } from './actions/HealAction';

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

/**
 * スキルの action 配列を順次実行する。
 * 各 action は target セル全体を独立に処理する（[attack, attack] なら全敵を 2 回叩く）。
 * 未知の action 名は警告のみで継続する。
 */
export function executeActions(
    dungeon: DungeonMap,
    caster: Player,
    compiled: CompiledSkill,
    cells: TargetCell[],
): void {
    for (const entry of compiled.definition.action) {
        const { name, param } = parseActionEntry(entry);
        switch (name) {
            case 'attack':
                executeAttackAction(dungeon, caster, cells);
                break;
            case 'damage':
                if (param === null) {
                    console.warn(`damage action requires a parameter in skill "${compiled.definition.name}"`);
                    break;
                }
                executeDamageAction(dungeon, caster, cells, param);
                break;
            case 'heal':
                if (param === null) {
                    console.warn(`heal action requires a parameter in skill "${compiled.definition.name}"`);
                    break;
                }
                executeHealAction(dungeon, caster, cells, param);
                break;
            // Phase 11: case 'reveal_trap':
            default:
                console.warn(`Unknown skill action "${name}" in skill "${compiled.definition.name}"`);
        }
    }
}

function parseActionEntry(entry: SkillActionEntry): { name: string; param: number | string | null } {
    if (typeof entry === 'string') return { name: entry, param: null };
    const keys = Object.keys(entry);
    if (keys.length === 0) return { name: '', param: null };
    const key = keys[0];
    return { name: key, param: entry[key] };
}
