import { SkillsLoader } from '../SkillsLoader';
import { EffectsLoader } from '../EffectsLoader';
import { BaseLoader } from '../BaseLoader';
import { EventBus } from '../../game/EventBus';
import type { DungeonMap } from '../MapGenerator';
import type { Enemy } from '../Enemy';
import { parseActionEntry } from './SkillExecutor';

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

    for (const entry of def.action) {
        const { name, param } = parseActionEntry(entry);
        if (name === 'apply_effect') {
            applyEffectToPlayer(enemy, player, param, turn);
        }
        // 将来拡張: 'damage' → プレイヤーへの追加ダメージ など
    }
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
