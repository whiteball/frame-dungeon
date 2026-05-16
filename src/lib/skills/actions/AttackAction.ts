import { Player } from '../../Player';
import { Enemy } from '../../Enemy';
import { EventBus } from '../../../game/EventBus';
import { SkillsLoader } from '../../SkillsLoader';
import type { DungeonMap } from '../../MapGenerator';
import type { TargetCell } from '../TargetResolver';

/**
 * attack action: target スコープ内の各敵に base.yml の damageFromPlayer formula で
 * ダメージを与え、死亡時は除去 + 経験値 + mastery 抽選 を行う。
 *
 * 攻撃フラッシュは「ヒットした敵が 1 体以上いる場合」のみ 1 回発行。
 * 有効対象（敵）が 0 体なら何もせず return（スキル全体のターン消費は呼び出し側で行う）。
 */
export function executeAttackAction(
    dungeon: DungeonMap,
    caster: Player,
    cells: TargetCell[],
): void {
    const enemies: Enemy[] = [];
    for (const { x, y } of cells) {
        const enemy = dungeon.getEnemy(x, y);
        if (enemy && enemy.isAlive()) enemies.push(enemy);
    }
    if (enemies.length === 0) return;

    EventBus.emit('attack-flash', 0xFFFFFF);
    const casterVars = caster.getEffectiveFormulaVars();
    const turn = dungeon.getTurnCount();
    const skillsLoader = SkillsLoader.getInstance();

    for (const enemy of enemies) {
        const { dealt, cleared } = enemy.takeDamageFromPlayer(casterVars);
        EventBus.emit('message-log', `${enemy.getLabel()}に${dealt}のダメージ！`, turn);
        for (const c of cleared) {
            EventBus.emit('message-log', `${enemy.getLabel()}の${c.label}が解けた`, turn);
        }

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
