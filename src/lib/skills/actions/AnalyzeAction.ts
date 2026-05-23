import { Player } from '../../Player';
import { Enemy } from '../../Enemy';
import { EventBus } from '../../../game/EventBus';
import { StatsLoader } from '../../StatsLoader';
import { SkillsLoader } from '../../SkillsLoader';
import type { DungeonMap } from '../../MapGenerator';
import type { TargetCell } from '../TargetResolver';

/**
 * analyze action: target スコープ内の敵について、ラベル・説明・主要ステータス・経験値・
 * 保有スキルを `--` で囲ったブロック形式でメッセージログに表示する。
 *
 * 表示するステータスは stats.yml の getMaxStat > 0 のもののみ（未定義の 0/0 を省く）。
 * fluctuation: true のステータスは `current/max`、それ以外は実効値のみを表示する。
 * 敵が存在しないセルは無視。複数の敵が範囲にいる場合はそれぞれブロックを発行する。
 */
export function executeAnalyzeAction(
    dungeon: DungeonMap,
    _caster: Player,
    cells: TargetCell[],
): void {
    const enemies: Enemy[] = [];
    for (const { x, y } of cells) {
        const enemy = dungeon.getEnemy(x, y);
        if (enemy && enemy.isAlive()) enemies.push(enemy);
    }
    if (enemies.length === 0) return;

    const statsLoader = StatsLoader.getInstance();
    const skillsLoader = SkillsLoader.getInstance();
    const turn = dungeon.getTurnCount();

    for (const enemy of enemies) {
        const lines: string[] = [];
        lines.push(`${enemy.getLabel()}：${enemy.getDescription()}`);

        for (const statName of statsLoader.getStatNames()) {
            const max = enemy.getMaxStat(statName);
            if (max <= 0) continue;
            const description = statsLoader.getDescription(statName);
            if (statsLoader.isFluctuationAllowed(statName)) {
                lines.push(`${description}：${enemy.getStat(statName)}/${max}`);
            } else {
                lines.push(`${description}：${enemy.getEffectiveStat(statName)}`);
            }
        }

        lines.push(`経験値：${enemy.getExp()}`);

        const skillDefs = enemy.getDefinition().skills ?? [];
        if (skillDefs.length > 0) {
            lines.push('スキル：');
            for (const entry of skillDefs) {
                const def = skillsLoader.getSkill(entry.name);
                const label = def?.label ?? entry.name;
                const desc = def?.description ?? '';
                lines.push(desc ? `${label}（${desc}）` : label);
            }
        }

        EventBus.emit('message-log', `--\n${lines.join('\n')}\n--`, turn);
    }
}
