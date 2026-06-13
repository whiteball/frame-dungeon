import { SkillsLoader } from '../SkillsLoader';
import { BaseLoader } from '../BaseLoader';
import type { DungeonMap } from '../MapGenerator';
import type { Player } from '../Player';
import type { Enemy } from '../Enemy';
import { evaluateCost, canPayCost, payCost, executeActions } from './SkillExecutor';
import type { TargetCell } from './TargetResolver';

/**
 * プレイヤー側パッシブスキル実行統合
 *
 * 既存の能動的 useSkill フロー（PlayerActions.useSkill）と異なり、
 * パッシブ発動は：
 *   - 一覧 UI を経由しない
 *   - ターン消費しない（呼び出し元のターンに便乗）
 *   - rate 抽選で発動可否を判定
 *   - cost 支払い不能時は静かに skip（ログ無し）
 *   - target は trigger 種別に応じて自動解決（self / hit）
 *
 * `EnemySkillExecutor` と並列の責務だが、こちらはプレイヤー視点の
 * SkillExecutor.executeActions 全アクション（attack/damage/heal/apply_effect/...）
 * を利用できる。
 */

type Trigger = 'on_attack' | 'on_turn' | 'on_damage';

function tryActivatePassive(
    dungeon: DungeonMap,
    player: Player,
    skillName: string,
    rate: number,
    expectedTrigger: Trigger,
    cells: TargetCell[],
    contextVars?: Record<string, number>,
): boolean {
    if (rate < 1.0 && Math.random() >= rate) return false;

    const compiled = SkillsLoader.getInstance().getCompiledSkill(skillName);
    if (!compiled) {
        console.warn(`PlayerSkillExecutor: skill "${skillName}" not found`);
        return false;
    }
    const def = compiled.definition;
    if ((def.trigger ?? 'active') !== expectedTrigger) {
        console.warn(`PlayerSkillExecutor: skill "${skillName}" trigger mismatch (expected ${expectedTrigger})`);
        return false;
    }

    // コスト評価（コスト未定義なら deltas は空 Map）
    const deltas = evaluateCost(player, compiled);
    if (!canPayCost(player, deltas)) {
        // 支払い不能時は静かに skip（既存の useSkill のような失敗ログは出さない）
        return false;
    }
    payCost(player, deltas);

    executeActions(dungeon, player, compiled, cells, contextVars);
    return true;
}

/**
 * プレイヤーの on_attack パッシブを 1 件発動する。
 * target=hit は hitEnemy のセルを 1 つだけ含む配列として解決される。
 */
export function executePlayerOnAttackSkill(
    dungeon: DungeonMap,
    player: Player,
    hitEnemy: Enemy,
    skillName: string,
    rate: number,
): void {
    tryActivatePassive(
        dungeon, player, skillName, rate, 'on_attack',
        [{ x: hitEnemy.x, y: hitEnemy.y }],
    );
}

/**
 * プレイヤーの on_turn パッシブを 1 件発動する。
 * target=self 限定（SkillsLoader でバリデーション済み）。
 */
export function executePlayerOnTurnSkill(
    dungeon: DungeonMap,
    player: Player,
    skillName: string,
    rate: number,
): void {
    const { x, y } = dungeon.getPlayerPos();
    tryActivatePassive(
        dungeon, player, skillName, rate, 'on_turn',
        [{ x, y }],
    );
}

/**
 * プレイヤーの on_damage パッシブを 1 件発動する。
 * - target=self: caster セルを対象
 * - target=hit: 攻撃元（attackerEnemy）のセルを対象（thorns 等の反撃用途）
 * - `incoming_damage` 変数を contextVars に注入する。
 */
export function executePlayerOnDamageSkill(
    dungeon: DungeonMap,
    player: Player,
    attackerEnemy: Enemy,
    incomingDamage: number,
    skillName: string,
    rate: number,
): void {
    const compiled = SkillsLoader.getInstance().getCompiledSkill(skillName);
    if (!compiled) return;
    const def = compiled.definition;
    let cells: TargetCell[];
    if (def.target === 'hit') {
        cells = [{ x: attackerEnemy.x, y: attackerEnemy.y }];
    } else {
        const { x, y } = dungeon.getPlayerPos();
        cells = [{ x, y }];
    }
    tryActivatePassive(
        dungeon, player, skillName, rate, 'on_damage',
        cells,
        { incoming_damage: incomingDamage },
    );
}

/**
 * プレイヤーが現在 stun 中など、パッシブ発動を抑制すべき状態か。
 * - on_attack / on_turn / on_damage は操作系トリガーと連動するため抑制対象
 * - passive（常時 stat 修飾）は別経路（getEffectiveStat 内）で常時適用される
 */
export function isPlayerPassiveBlocked(player: Player): boolean {
    // 完全行動不能（force が skip に解決される）ときのみパッシブを抑制（既存スタン挙動を維持）。
    // 他の強制行動（attack/use_skill 等）は中核処理が通常のパッシブ hook を発火する。
    return player.getPlayerActionDirective().force?.verb === 'skip';
}

/**
 * プレイヤー死亡判定（複数パッシブ連鎖中の break チェック用）
 */
export function isPlayerDead(player: Player): boolean {
    return BaseLoader.getInstance().isDead(player.getFormulaVars());
}

