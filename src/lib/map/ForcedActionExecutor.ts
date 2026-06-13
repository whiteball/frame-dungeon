/**
 * 状態異常 onAction の「強制行動（force）」をプレイヤーに対して実行する。
 *
 * 入力ゲートウェイ（Game.ts）が、その手番のディレクティブを解決して force があれば
 * ここを呼ぶ。各 verb は中核処理（attackEnemyAt / useConsumableItem 等）を直接呼び、
 * **常にターンを消費する**（中核が消費しなければ dispatchObjectEvent で空ターンを足す）。
 */

import { EventBus } from '../../game/EventBus';
import { BaseLoader } from '../BaseLoader';
import { StatsLoader } from '../StatsLoader';
import { SkillsLoader } from '../SkillsLoader';
import { getRandomInt } from '../util/random';
import { getDirectionOffset, rotateDirection } from './MapDirection';
import { MOVE_TOKENS, type ForceVerb, type MoveToken, type SlotToken } from '../effects/StatusActionResolver';
import type { DungeonMap } from '../MapGenerator';
import type { Player } from '../Player';

function pickRandom<T>(arr: readonly T[]): T | undefined {
    if (arr.length === 0) return undefined;
    return arr[getRandomInt(0, arr.length)];
}

/** 正面 中央→右→左 の順で、攻撃可能な敵がいる最初のセルを返す（無ければ null）。 */
function autoFrontEnemyCell(dungeon: DungeonMap): { x: number; y: number } | null {
    const { x, y, direction } = dungeon.getPlayerPos();
    const [fdx, fdy] = getDirectionOffset(direction);
    const [rdx, rdy] = getDirectionOffset(rotateDirection(direction, 1));
    const center = { x: x + fdx, y: y + fdy };
    const right = { x: center.x + rdx, y: center.y + rdy };
    const left = { x: center.x - rdx, y: center.y - rdy };
    for (const c of [center, right, left]) {
        if (dungeon.getEnemy(c.x, c.y) && dungeon.canAttack(x, y, c.x, c.y)) return c;
    }
    return null;
}

const MOVE_FNS: Record<MoveToken, (d: DungeonMap) => number> = {
    forward: d => d.goPlayer(),
    back: d => d.goBackPlayer(),
    left: d => d.goLeftPlayer(),
    right: d => d.goRightPlayer(),
};

function resolveMoveToken(arg?: string): MoveToken {
    if (arg && (MOVE_TOKENS as readonly string[]).includes(arg)) return arg as MoveToken;
    return MOVE_TOKENS[getRandomInt(0, MOVE_TOKENS.length)];
}

/** 発動可能（active）な習得スキルからランダムに 1 つ選ぶ。 */
function pickRandomActiveSkill(player: Player): string | undefined {
    const loader = SkillsLoader.getInstance();
    const candidates = player.getLearnedSkillNames().filter((name: string) => {
        const def = loader.getCompiledSkill(name)?.definition;
        return def !== undefined && (def.trigger ?? 'active') === 'active';
    });
    return pickRandom(candidates);
}

/** 自分自身への攻撃（データ駆動ダメージ式・被弾経路経由。パッシブは発動させない）。 */
function executeAttackSelf(dungeon: DungeonMap, player: Player, turn: number): void {
    const base = BaseLoader.getInstance();
    const vars = player.getEffectiveFormulaVars();
    const damage = base.calculateDamageFromPlayer(vars, vars);
    const stat = base.getDefaultDamageStat();
    player.addStat(stat, -damage);
    EventBus.emit('attack-flash', 0xFF2222);
    EventBus.emit('message-log',
        `自分を攻撃した！ ${damage}のダメージ！ (残り${StatsLoader.getInstance().getAbbreviation(stat)}: ${player.getStat(stat)}/${player.getEffectiveMaxStat(stat)})`,
        turn);
    const cleared = player.notifyDamageTaken();
    for (const c of cleared) {
        EventBus.emit('message-log', `${c.label}が解けた`, turn);
    }
    // on_attack / on_damage パッシブは自傷では発動させない。死亡判定は dispatchObjectEvent 後の tick が担う。
    dungeon.dispatchObjectEvent();
}

/**
 * 強制行動を実行する。必ずターンを消費する。
 */
export function executePlayerForce(dungeon: DungeonMap, leaf: { verb: ForceVerb; arg?: string }): void {
    const turn = dungeon.getTurnCount();
    const player = dungeon.getPlayerInstance();
    if (!player) { dungeon.dispatchObjectEvent(); return; }

    switch (leaf.verb) {
        case 'skip': {
            EventBus.emit('message-log', leaf.arg ?? '動けない！', turn);
            dungeon.dispatchObjectEvent();
            return;
        }
        case 'attack': {
            const cell = autoFrontEnemyCell(dungeon);
            if (cell) {
                dungeon.attackEnemyAt(cell.x, cell.y);
            } else {
                EventBus.emit('message-log', '攻撃する相手がいない！', turn);
                dungeon.dispatchObjectEvent();
            }
            return;
        }
        case 'attack_self': {
            executeAttackSelf(dungeon, player, turn);
            return;
        }
        case 'move': {
            const moved = MOVE_FNS[resolveMoveToken(leaf.arg)](dungeon);
            if (moved <= 0) dungeon.dispatchObjectEvent(); // 壁等で進めなくてもターンは消費
            return;
        }
        case 'use_item': {
            const pool = player.getInventory().getConsumableItems();
            const item = leaf.arg ? pool.find(i => i.getName() === leaf.arg) : pickRandom(pool);
            if (!item) {
                EventBus.emit('message-log', '使えるアイテムを持っていない！', turn);
                dungeon.dispatchObjectEvent();
                return;
            }
            if (!dungeon.useConsumableItem(item.getInstanceId())) dungeon.dispatchObjectEvent();
            return;
        }
        case 'equip': {
            const pool = player.getInventory().getEquippableItems();
            const item = leaf.arg ? pool.find(i => i.getName() === leaf.arg) : pickRandom(pool);
            if (!item) {
                EventBus.emit('message-log', '装備できるものを持っていない！', turn);
                dungeon.dispatchObjectEvent();
                return;
            }
            const res = dungeon.changeEquipment(item.getInstanceId());
            if (!res.consumedTurn) dungeon.dispatchObjectEvent();
            return;
        }
        case 'unequip': {
            const slot = leaf.arg as SlotToken | undefined;
            if (!slot) { dungeon.dispatchObjectEvent(); return; }
            const removed = player.unequipItem(slot);
            EventBus.emit('message-log',
                removed ? `${removed.getLabelWithModifiers()}が外れた` : '外す装備がない', turn);
            dungeon.dispatchObjectEvent();
            return;
        }
        case 'use_skill': {
            const name = leaf.arg ?? pickRandomActiveSkill(player);
            if (!name || !player.hasSkill(name)) { dungeon.dispatchObjectEvent(); return; }
            const def = SkillsLoader.getInstance().getCompiledSkill(name)?.definition;
            let cell: { x: number; y: number } | undefined;
            if (def?.target === 'front') {
                const fc = autoFrontEnemyCell(dungeon);
                if (!fc) { dungeon.dispatchObjectEvent(); return; }
                cell = fc;
            }
            if (!dungeon.useSkill(name, cell)) dungeon.dispatchObjectEvent();
            return;
        }
    }
}
