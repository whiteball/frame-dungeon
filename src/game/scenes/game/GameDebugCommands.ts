import { EventBus } from '../../EventBus';
import { ItemObject, TrapObject } from '../../../lib/map/MapObjects';
import { ItemFactory } from '../../../lib/ItemFactory';
import { EnemyFactory } from '../../../lib/EnemyFactory';
import { TrapsLoader } from '../../../lib/TrapsLoader';
import { SkillsLoader } from '../../../lib/SkillsLoader';
import { buildTrapObject } from './mapObjectFactory';
import type { Enemy } from '../../../lib/Enemy';
import type { Game } from '../Game';

/**
 * DevTools コンソールから利用するデバッグ用関数を `window` に公開する。
 * 全関数は `（debug）` プレフィックス付きでメッセージログに発行する。
 *
 * 設定ダイアログの「デバッグコマンド」が ON のときのみ Game.create() から呼ばれる。
 */
export function setupDebugCommands(game: Game): void {
    const w = window as unknown as Record<string, unknown>;

    // window.listMapItems() - 現在フロアの床アイテム一覧
    w.listMapItems = () => {
        const turn = game.dungeon.getTurnCount();
        const result: Array<{ x: number; y: number; name: string; label: string; modifiers: Record<string, number> }> = [];
        for (const obj of game.dungeon.getObjects().values()) {
            if (obj instanceof ItemObject) {
                const modifiers = Object.fromEntries(obj.item.getModifiers());
                result.push({
                    x: obj.x,
                    y: obj.y,
                    name: obj.item.getName(),
                    label: obj.item.getLabelWithModifiers(),
                    modifiers,
                });
            }
        }
        console.log(`[listMapItems] 床アイテム ${result.length} 個 (floor=${game.floor}):`);
        console.table(result);
        EventBus.emit('message-log', `（debug）床アイテム ${result.length} 個（詳細はコンソール参照）`, turn);
        return result;
    };

    // window.addItem('iron sword', 1) - 名前指定でアイテムをインベントリに追加（modifier 抽選なし）
    w.addItem = (name: string, count: number = 1): number => {
        const turn = game.dungeon.getTurnCount();
        const inventory = game.player.getInventory();
        let added = 0;
        for (let i = 0; i < count; i++) {
            const item = ItemFactory.createItem(name);
            if (!item) {
                EventBus.emit('message-log', `（debug）${name} は未定義アイテム`, turn);
                break;
            }
            if (!inventory.addItem(item)) {
                EventBus.emit('message-log', `（debug）インベントリ満杯のため追加中断`, turn);
                break;
            }
            added++;
        }
        if (added > 0) {
            EventBus.emit('message-log', `（debug）${name} を ${added} 個追加`, turn);
            game.render();
        }
        return added;
    };

    // window.addTestItems() - 動作確認用の代表アイテムを一括追加
    w.addTestItems = (): string[] => {
        const turn = game.dungeon.getTurnCount();
        const names = ['iron sword', 'round shield', 'silver ring', 'potion', 'power potion', 'mana potion'];
        const inventory = game.player.getInventory();
        const added: string[] = [];
        for (const name of names) {
            const item = ItemFactory.createItem(name);
            if (!item) continue;
            if (!inventory.addItem(item)) break;
            added.push(name);
        }
        EventBus.emit('message-log', `（debug）テストアイテム ${added.length} 個を追加`, turn);
        game.render();
        return added;
    };

    // window.addItemModifier('weapon', 'power_reinforced', 2) - 装備中アイテムに modifier 付与
    w.addItemModifier = (slot: 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2', name: string, count: number = 1): boolean => {
        const target = game.player.getItemInSlot(slot);
        const turn = game.dungeon.getTurnCount();
        if (!target) {
            EventBus.emit('message-log', `（debug）${slot} に装備中のアイテムがありません`, turn);
            return false;
        }
        const ok = target.setModifierCount(name, count);
        if (ok) {
            EventBus.emit('message-log', `（debug）${target.getLabelWithModifiers()} に ${name} を付与`, turn);
            game.render();
        } else {
            EventBus.emit('message-log', `（debug）${name} は未定義 or 対象 type 不一致`, turn);
        }
        return ok;
    };

    // window.removeItemModifier('weapon', 'cursed') - modifier 除去
    w.removeItemModifier = (slot: 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2', name: string): boolean => {
        const target = game.player.getItemInSlot(slot);
        const turn = game.dungeon.getTurnCount();
        if (!target) {
            EventBus.emit('message-log', `（debug）${slot} に装備中のアイテムがありません`, turn);
            return false;
        }
        const ok = target.removeModifier(name);
        if (ok) {
            EventBus.emit('message-log', `（debug）${target.getLabelWithModifiers()} から ${name} を除去`, turn);
            game.render();
        } else {
            EventBus.emit('message-log', `（debug）${target.getLabel()} は ${name} を持っていません`, turn);
        }
        return ok;
    };

    // window.applyStatusEffect('poison') - プレイヤーに状態異常を付与
    w.applyStatusEffect = (name: string): string => {
        const result = game.player.applyStatusEffect(name);
        if (result === 'applied') {
            EventBus.emit('message-log', `（debug）${name} を付与`, game.dungeon.getTurnCount());
            game.render();
        } else if (result === 'resisted') {
            EventBus.emit('message-log', `（debug）${name} を耐性で防いだ`, game.dungeon.getTurnCount());
        } else {
            EventBus.emit('message-log', `（debug）${name} は未定義 effect`, game.dungeon.getTurnCount());
        }
        return result;
    };

    // window.applyStatusEffectToEnemy('poison') - 敵に状態異常付与
    // instanceId 未指定なら視界内で最も近い生存敵を選択
    w.applyStatusEffectToEnemy = (name: string, instanceId?: string): string => {
        const turn = game.dungeon.getTurnCount();
        const enemies = game.dungeon.getEnemies().filter(e => e.isAlive());
        let target: Enemy | null = (instanceId ? enemies.find(e => e.getInstanceId() === instanceId) : undefined) ?? null;
        if (!target) {
            const { x: px, y: py } = game.dungeon.getPlayerPos();
            let best: Enemy | null = null;
            let bestDist = Infinity;
            for (const e of enemies) {
                if (!game.dungeon.hasLineOfSight(e.x, e.y, px, py)) continue;
                const d = Math.max(Math.abs(e.x - px), Math.abs(e.y - py));
                if (d < bestDist) { best = e; bestDist = d; }
            }
            target = best;
        }
        if (!target) {
            EventBus.emit('message-log', `（debug）対象の敵が見つかりません`, turn);
            return 'no-target';
        }
        const result = target.applyStatusEffect(name);
        if (result === 'applied') {
            EventBus.emit('message-log', `（debug）${target.getLabel()}に${name}を付与`, turn);
            game.render();
        } else if (result === 'resisted') {
            EventBus.emit('message-log', `（debug）${target.getLabel()}は${name}を耐性で防いだ`, turn);
        } else {
            EventBus.emit('message-log', `（debug）${name} は未定義 effect`, turn);
        }
        return result;
    };

    // window.learnSkill('double_attack') - スキル習得
    w.learnSkill = (name: string): boolean => {
        const ok = game.player.learnSkill(name);
        EventBus.emit('message-log',
            ok ? `（debug）スキル「${name}」を習得` : `（debug）スキル「${name}」習得失敗（未定義 or 既習得）`,
            game.dungeon.getTurnCount());
        return ok;
    };

    // window.forgetSkill('double_attack') - スキル習得取り消し
    w.forgetSkill = (name: string): boolean => {
        const ok = game.player.forgetSkill(name);
        EventBus.emit('message-log',
            ok ? `（debug）スキル「${name}」を忘却` : `（debug）スキル「${name}」は未習得`,
            game.dungeon.getTurnCount());
        return ok;
    };

    // window.listSkills() - 習得済みスキル一覧
    w.listSkills = (): string[] => game.player.getLearnedSkillNames();

    // window.addExp(50) - 経験値加算（mastery 抽選含む）
    w.addExp = (n: number) => {
        const result = game.player.addExp(n);
        EventBus.emit('message-log', `（debug）経験値+${n}`, game.dungeon.getTurnCount());
        const skillsLoader = SkillsLoader.getInstance();
        for (const lv of result.levels) {
            EventBus.emit('message-log', `レベルアップ！Lv${lv.level}`, game.dungeon.getTurnCount());
            for (const skillName of lv.learnedSkills) {
                const label = skillsLoader.getSkill(skillName)?.label ?? skillName;
                EventBus.emit('message-log', `スキル「${label}」を習得した！`, game.dungeon.getTurnCount());
            }
        }
        game.render();
        return result;
    };

    // window.levelUpN(3) - 経験値を介さず直接 n 回 levelUp（mastery 抽選確認用）
    w.levelUpN = (n: number = 1): string[] => {
        const allLearned: string[] = [];
        for (let i = 0; i < n; i++) {
            const learned = game.player.levelUp();
            allLearned.push(...learned);
            EventBus.emit('message-log', `（debug）レベルアップ！Lv${game.player.level}`, game.dungeon.getTurnCount());
            for (const skillName of learned) {
                const label = SkillsLoader.getInstance().getSkill(skillName)?.label ?? skillName;
                EventBus.emit('message-log', `スキル「${label}」を習得した！`, game.dungeon.getTurnCount());
            }
        }
        game.render();
        return allLearned;
    };

    // window.addEnemyAt(3, 5, 'slime') - 任意座標に敵を追加（name 省略時はフロアプールから抽選）
    // 成功で true。範囲外/壁・プレイヤー直上・既に敵/宝箱/ブロッキングイベントで占有のセルは false。
    w.addEnemyAt = (x: integer, y: integer, name?: string): boolean => {
        const turn = game.dungeon.getTurnCount();
        if (game.dungeon.getAt(x, y) === -1) {
            EventBus.emit('message-log', `（debug）(${x},${y}) は進入禁止セル`, turn);
            return false;
        }
        const playerPos = game.dungeon.getPlayerPos();
        if (x === playerPos.x && y === playerPos.y) {
            EventBus.emit('message-log', `（debug）(${x},${y}) はプレイヤーの位置`, turn);
            return false;
        }
        if (game.dungeon.isCellBlocked(x, y)) {
            EventBus.emit('message-log', `（debug）(${x},${y}) は既に占有されている`, turn);
            return false;
        }
        const enemy = name
            ? EnemyFactory.createEnemy(name, x, y)
            : EnemyFactory.createRandomEnemy(game.floor, x, y);
        if (!enemy) {
            EventBus.emit('message-log', `（debug）敵を生成できません（${name ?? `floor ${game.floor} のプールが空`}）`, turn);
            return false;
        }
        game.dungeon.addEnemy(enemy);
        EventBus.emit('message-log', `（debug）(${x},${y}) に ${enemy.getLabel()} を追加`, turn);
        game.render();
        return true;
    };

    // window.addTrapAt(3, 5, 'pitfall') - 任意座標にトラップを追加（name 省略時は全定義から抽選）
    // 成功で true。範囲外/壁・既にトラップ存在・敵/宝箱/ブロッキングイベントで占有のセルは false。
    w.addTrapAt = (x: integer, y: integer, name?: string): boolean => {
        const turn = game.dungeon.getTurnCount();
        if (game.dungeon.getAt(x, y) === -1) {
            EventBus.emit('message-log', `（debug）(${x},${y}) は進入禁止セル`, turn);
            return false;
        }
        if (game.dungeon.getObject(x, y).some(o => o instanceof TrapObject)) {
            EventBus.emit('message-log', `（debug）(${x},${y}) には既にトラップがある`, turn);
            return false;
        }
        if (game.dungeon.isCellBlocked(x, y)) {
            EventBus.emit('message-log', `（debug）(${x},${y}) は既に占有されている`, turn);
            return false;
        }
        const trapDef = name
            ? TrapsLoader.getInstance().getTrap(name)
            : TrapsLoader.getInstance().getRandomTrap();
        if (!trapDef) {
            EventBus.emit('message-log', `（debug）トラップ定義が見つかりません（${name ?? '定義なし'}）`, turn);
            return false;
        }
        const cb = game.buildDungeonRestoreCallbacks();
        const trapObj = buildTrapObject(trapDef, cb.applyTrapEffects, cb.enterTrapConfirmMode);
        trapObj.x = x;
        trapObj.y = y;
        game.dungeon.placeObject(trapObj);
        EventBus.emit('message-log', `（debug）(${x},${y}) に ${trapDef.label} を追加`, turn);
        game.render();
        return true;
    };

    // window.findPath(1,1,2,7,false) - 経路探索結果をコンソール出力
    w.findPath = (
        startX: integer,
        startY: integer,
        endX: integer,
        endY: integer,
        room: boolean,
        blacked: [number, number][] = []
    ) => {
        const result = game.dungeon.findPath(startX, startY, endX, endY, { scope: room ? 'room' : 'full', blockedPositions: blacked });
        console.debug(result);
    };
}
