import { type Expression } from 'expr-eval-fork';
import { Player } from '../Player';
import { BaseLoader } from '../BaseLoader';
import { StatsLoader } from '../StatsLoader';
import { EffectsLoader } from '../EffectsLoader';
import { ItemsLoader } from '../ItemsLoader';
import { ItemFactory } from '../ItemFactory';
import { EnemyFactory } from '../EnemyFactory';
import { EventBus } from '../../game/EventBus';
import { executeSkillFromItem } from '../skills/SkillExecutor';
import { EventObject, ItemObject } from '../map/MapObjects';
import type { DungeonMap } from '../MapGenerator';
import type {
    EventActionEntry,
    RandomOutcomeEntry,
    CompiledEventChoice,
} from '../EventsLoader';
import { compileEventFormula, evalWithPlayer } from './eventFormula';

// ===== formula 評価 =====
//
// イベント formula は `has_item("x")` / `item_count("x")` / `has_skill("x")` などのクエリ関数を
// 使えるよう、共有 `eventParser`（eventFormula.ts）で parse し、評価は `evalWithPlayer` で
// player 文脈をセットして行う。

function evalFormulaToInt(src: number | string, player: Player, contextLabel: string): number {
    if (typeof src === 'number') return Math.floor(src);
    const formula = compileEventFormula(src);
    if (!formula) return 0;
    const vars = player.getEffectiveFormulaVarsWithMax();
    try {
        const raw = evalWithPlayer(player, () => formula.evaluate(vars));
        if (typeof raw === 'number' && Number.isFinite(raw)) return Math.floor(raw);
    } catch (e) {
        console.warn(`Failed to evaluate event formula "${src}" (${contextLabel}):`, e);
    }
    return 0;
}

// ===== cost / rate =====

/**
 * イベント選択肢のコスト式を評価し、各ステータスの差分（負値）を返す。
 * skills の {@link evaluateCost} を簡略化したもの。
 */
export function evaluateChoiceCost(player: Player, costMap: Map<string, Expression>): Map<string, number> {
    const vars = player.getEffectiveFormulaVarsWithMax();
    const deltas = new Map<string, number>();
    for (const [stat, formula] of costMap) {
        let raw: unknown;
        try {
            raw = evalWithPlayer(player, () => formula.evaluate(vars));
        } catch (e) {
            console.warn(`Failed to evaluate event cost formula for ${stat}:`, e);
            raw = 0;
        }
        let cost = typeof raw === 'number' && Number.isFinite(raw) ? Math.floor(raw) : 0;
        if (cost < 0) cost = 0;
        deltas.set(stat, -cost);
    }
    return deltas;
}

/**
 * コスト適用後にステータスが破綻しないか検証する（仮想評価のみ）。
 */
export function canPayChoiceCost(player: Player, deltas: Map<string, number>): boolean {
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
 * 選択肢の rate を評価して [0,1] にクランプした数値を返す。null なら 1（常に成功）。
 */
export function evaluateChoiceRate(player: Player, rate: number | Expression | null): number {
    if (rate === null) return 1;
    if (typeof rate === 'number') return Math.max(0, Math.min(1, rate));
    const vars = player.getEffectiveFormulaVarsWithMax();
    try {
        const raw = evalWithPlayer(player, () => rate.evaluate(vars));
        if (typeof raw === 'number' && Number.isFinite(raw)) {
            return Math.max(0, Math.min(1, raw));
        }
    } catch (e) {
        console.warn(`Failed to evaluate event rate formula:`, e);
    }
    return 0;
}

/**
 * 選択肢の表示条件を評価する。null（未指定）なら常に true。
 * 数値は非 0 で真、formula は評価結果が非 0 で真（`has_item` 等のクエリ関数が使える）。
 */
export function evaluateChoiceCondition(player: Player, condition: number | Expression | null): boolean {
    if (condition === null) return true;
    if (typeof condition === 'number') return condition !== 0;
    const vars = player.getEffectiveFormulaVarsWithMax();
    try {
        const raw = evalWithPlayer(player, () => condition.evaluate(vars));
        if (typeof raw === 'boolean') return raw;
        if (typeof raw === 'number' && Number.isFinite(raw)) return raw !== 0;
    } catch (e) {
        console.warn(`Failed to evaluate event condition formula:`, e);
    }
    return false;
}

/**
 * コスト要約文字列を生成する（skill の formatCostSummary と同形）。
 */
export function formatChoiceCostSummary(deltas: Map<string, number>): string {
    const stats = StatsLoader.getInstance();
    const parts: string[] = [];
    for (const [stat, delta] of deltas) {
        if (delta === 0) continue;
        const abbr = stats.getAbbreviation(stat);
        parts.push(`${abbr}:${-delta}`);
    }
    return parts.join(', ');
}

// ===== action ディスパッチ =====

function parseActionEntry(entry: EventActionEntry): { name: string; param: unknown } {
    if (typeof entry === 'string') return { name: entry, param: null };
    const keys = Object.keys(entry);
    if (keys.length === 0) return { name: '', param: null };
    const key = keys[0];
    return { name: key, param: (entry as Record<string, unknown>)[key] };
}

/**
 * 重み付き抽選で random_outcome から 1 エントリを選ぶ。
 */
function pickRandomOutcome(entries: RandomOutcomeEntry[]): RandomOutcomeEntry | null {
    if (entries.length === 0) return null;
    const total = entries.reduce((s, e) => s + e.weight, 0);
    if (total <= 0) return null;
    let r = Math.random() * total;
    for (const e of entries) {
        r -= e.weight;
        if (r < 0) return e;
    }
    return entries[entries.length - 1];
}

/**
 * 8 マス近傍からランダム順に空きセルを返す（near='around' 用）。
 *
 * 注意: プレイヤーセルと候補セル間の壁/扉ビットは検査しないため、プレイヤーが壁際にいる場合は
 * 壁の向こう側の部屋に敵が出現することがある（例：プレイヤー = 部屋 A 内の壁ぎわ、
 * 候補セル = 隣接する部屋 B 内）。視覚的にはやや唐突に見える可能性があるが、
 * 「イベントから魔物が湧いた」演出としては許容範囲と判断し意図的に許容している。
 * 厳密に視線/通路を経由したセルのみに限定したい場合は `isInSameZone` などで絞ること。
 */
function getAroundEmptyCells(dungeon: DungeonMap): Array<[integer, integer]> {
    const { x: px, y: py } = dungeon.getPlayerPos();
    const cells: Array<[integer, integer]> = [];
    for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
            if (dx === 0 && dy === 0) continue;
            const nx = px + dx;
            const ny = py + dy;
            if (dungeon.getAt(nx, ny) === -1) continue;
            if (dungeon.isCellBlocked(nx, ny)) continue;
            cells.push([nx, ny]);
        }
    }
    // シャッフル
    for (let i = cells.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    return cells;
}

/**
 * 1 つのイベント action を実行する。self_destruct のときのみ true を返す。
 */
function executeOneAction(
    dungeon: DungeonMap,
    player: Player,
    eventObj: EventObject,
    entry: EventActionEntry,
): { selfDestruct: boolean; playerDied: boolean } {
    const { name, param } = parseActionEntry(entry);
    const turn = dungeon.getTurnCount();

    switch (name) {
        case 'self_destruct': {
            return { selfDestruct: true, playerDied: false };
        }
        case 'message': {
            if (typeof param === 'string') {
                EventBus.emit('message-log', param, turn);
            }
            break;
        }
        case 'heal': {
            if (typeof param !== 'number' && typeof param !== 'string') break;
            const amount = evalFormulaToInt(param, player, `${eventObj.eventDef.name}.heal`);
            if (amount <= 0) break;
            const healStat = BaseLoader.getInstance().getDefaultDamageStat();
            const before = player.getStat(healStat);
            player.addStat(healStat, amount);
            const actual = player.getStat(healStat) - before;
            if (actual > 0) {
                const abbr = StatsLoader.getInstance().getAbbreviation(healStat);
                EventBus.emit('message-log', `${abbr}が${actual}回復した`, turn);
            }
            break;
        }
        case 'damage': {
            if (typeof param !== 'number' && typeof param !== 'string') break;
            const amount = evalFormulaToInt(param, player, `${eventObj.eventDef.name}.damage`);
            if (amount <= 0) break;
            const damageStat = BaseLoader.getInstance().getDefaultDamageStat();
            const before = player.getStat(damageStat);
            player.addStat(damageStat, -amount);
            const actual = before - player.getStat(damageStat);
            EventBus.emit('attack-flash', 0xFF2222);
            const statsLoader = StatsLoader.getInstance();
            EventBus.emit('message-log',
                `${actual}のダメージ！(残り${statsLoader.getAbbreviation(damageStat)}: ${player.getStat(damageStat)}/${player.getEffectiveMaxStat(damageStat)})`,
                turn);
            const cleared = player.notifyDamageTaken();
            for (const c of cleared) {
                EventBus.emit('message-log', `${c.label}が解けた`, turn);
            }
            const deadVars = {
                ...player.getFormulaVars(),
                currentFloor: dungeon.getCurrentFloor(),
                maxFloor: BaseLoader.getInstance().getGoalFloor(),
            };
            if (BaseLoader.getInstance().isDead(deadVars)) {
                EventBus.emit('game-over');
                return { selfDestruct: false, playerDied: true };
            }
            break;
        }
        case 'apply_effect': {
            let effectName: string | undefined;
            let rate = 1;
            if (typeof param === 'string') {
                effectName = param;
            } else if (param && typeof param === 'object' && !Array.isArray(param)) {
                const p = param as Record<string, unknown>;
                if (typeof p.effect === 'string') effectName = p.effect;
                if (typeof p.rate === 'number') {
                    rate = Math.max(0, Math.min(1, p.rate));
                } else if (typeof p.rate === 'string') {
                    const formula = compileEventFormula(p.rate);
                    if (formula) {
                        try {
                            const raw = evalWithPlayer(player, () => formula.evaluate(player.getEffectiveFormulaVarsWithMax()));
                            if (typeof raw === 'number' && Number.isFinite(raw)) {
                                rate = Math.max(0, Math.min(1, raw));
                            }
                        } catch (e) {
                            console.warn(`Failed to evaluate apply_effect rate "${p.rate}":`, e);
                        }
                    }
                }
            }
            if (!effectName) break;
            if (Math.random() >= rate) break;
            const result = player.applyStatusEffect(effectName);
            const def = EffectsLoader.getInstance().getEffect(effectName);
            const label = def?.label ?? effectName;
            if (result === 'applied') {
                EventBus.emit('message-log', `${label}状態になった！`, turn);
            } else if (result === 'resisted') {
                EventBus.emit('message-log', `${label}を耐性で防いだ！`, turn);
            }
            break;
        }
        case 'learn_skill': {
            if (typeof param !== 'string') break;
            const r = player.applyImmediateEffect({ learnSkill: param });
            for (const sk of r.learnedSkills) {
                EventBus.emit('message-log', `スキル「${sk}」を習得した！`, turn);
            }
            for (const sk of r.alreadyLearnedSkills) {
                EventBus.emit('message-log', `スキル「${sk}」は既に習得済み`, turn);
            }
            break;
        }
        case 'add_modifier': {
            if (typeof param !== 'string') break;
            const r = player.applyImmediateEffect({ add_modifier: param });
            for (const m of r.addedModifiers) {
                const detail = m.countable ? ` (${m.newCount})` : '';
                EventBus.emit('message-log', `${m.itemLabel} に「${m.modifierLabel}」を付与${detail}`, turn);
            }
            if (r.modifierNoTarget) {
                EventBus.emit('message-log', `対象の装備が無かった`, turn);
            }
            break;
        }
        case 'remove_modifier_kind': {
            if (!param || typeof param !== 'object' || Array.isArray(param)) break;
            const r = player.applyImmediateEffect({ remove_modifier_kind: param as any });
            for (const rm of r.removedModifiers) {
                EventBus.emit('message-log', `${rm.itemLabel} から ${rm.modifierNames.join(' / ')} を解除した`, turn);
            }
            if (r.modifierNoTarget) {
                EventBus.emit('message-log', `解除対象が無かった`, turn);
            }
            break;
        }
        case 'execute_skill': {
            if (typeof param !== 'string') break;
            const ok = executeSkillFromItem(dungeon, player, param);
            if (!ok) {
                console.warn(`event '${eventObj.eventDef.name}': execute_skill "${param}" failed (target=front skills not supported in events)`);
            }
            break;
        }
        case 'give_item': {
            let itemName: string | undefined;
            let count = 1;
            let modifiers: Array<{ name: string; count: number }> = [];
            if (typeof param === 'string') {
                itemName = param;
            } else if (param && typeof param === 'object' && !Array.isArray(param)) {
                const p = param as Record<string, unknown>;
                if (typeof p.name === 'string') itemName = p.name;
                if (typeof p.count === 'number' && p.count > 0) count = Math.floor(p.count);
                if (Array.isArray(p.modifiers)) {
                    for (const m of p.modifiers) {
                        if (m && typeof m === 'object' && typeof (m as any).name === 'string') {
                            const c = typeof (m as any).count === 'number' ? Math.floor((m as any).count) : 1;
                            if (c > 0) modifiers.push({ name: (m as any).name, count: c });
                        }
                    }
                }
            }
            if (!itemName) break;
            for (let k = 0; k < count; k++) {
                const item = ItemFactory.createItem(itemName);
                if (!item) continue;
                for (const m of modifiers) item.setModifierCount(m.name, m.count);
                const label = item.getLabelWithModifiers();
                if (player.getInventory().addItem(item)) {
                    EventBus.emit('message-log', `${label}を入手した`, turn);
                } else {
                    // インベントリ満杯 → 足下にドロップ（宝箱開封時と同じ流儀）
                    const { x: px, y: py } = dungeon.getPlayerPos();
                    const itemObj = new ItemObject(item);
                    itemObj.x = px;
                    itemObj.y = py;
                    dungeon.placeObject(itemObj);
                    EventBus.emit('message-log', `${label}が足下に転がった`, turn);
                }
            }
            break;
        }
        case 'consume_item': {
            let itemName: string | undefined;
            let count = 1;
            if (typeof param === 'string') {
                itemName = param;
            } else if (param && typeof param === 'object' && !Array.isArray(param)) {
                const p = param as Record<string, unknown>;
                if (typeof p.name === 'string') itemName = p.name;
                if (typeof p.count === 'number' && p.count > 0) count = Math.floor(p.count);
            }
            if (!itemName) break;
            const def = ItemsLoader.getInstance().getItem(itemName);
            const label = def?.label ?? itemName;
            const removed = player.getInventory().removeItemByName(itemName, count);
            if (removed > 0) {
                EventBus.emit('message-log', `${label}を${removed}個渡した`, turn);
            }
            break;
        }
        case 'unlock_door': {
            // param: 'self' のときのみ EventObject.linkedDoor を unlock。
            // 鍵オブジェクトと施錠扉の紐付けは FloorPopulator / deserialize 時に EventObject.linkedDoor へ書き込まれる。
            if (param !== 'self') {
                console.warn(`event '${eventObj.eventDef.name}': unlock_door の param は 'self' のみサポート（received: ${JSON.stringify(param)}）`);
                break;
            }
            const ld = eventObj.linkedDoor;
            if (!ld) {
                console.warn(`event '${eventObj.eventDef.name}': unlock_door: self を指定しましたが linkedDoor が未設定です`);
                break;
            }
            dungeon.unlockDoor(ld.x, ld.y, ld.dir);
            break;
        }
        case 'spawn_enemy': {
            let enemyName: string | undefined;
            let count = 1;
            let near: 'around' | 'room' = 'around';
            if (typeof param === 'string') {
                enemyName = param;
            } else if (param && typeof param === 'object' && !Array.isArray(param)) {
                const p = param as Record<string, unknown>;
                if (typeof p.name === 'string') enemyName = p.name;
                if (typeof p.count === 'number' && p.count > 0) count = Math.floor(p.count);
                if (p.near === 'room' || p.near === 'around') near = p.near;
            }
            if (!enemyName) break;

            const cells = collectSpawnCells(dungeon, near, count);
            let spawned = 0;
            for (let k = 0; k < count && k < cells.length; k++) {
                const [sx, sy] = cells[k];
                const enemy = EnemyFactory.createEnemy(enemyName, sx, sy);
                if (!enemy) continue;
                dungeon.addEnemy(enemy);
                spawned++;
            }
            if (spawned > 0) {
                EventBus.emit('message-log', `敵が${spawned}体現れた！`, turn);
            }
            break;
        }
        default: {
            console.warn(`Unknown event action "${name}" in event "${eventObj.eventDef.name}"`);
        }
    }
    return { selfDestruct: false, playerDied: false };
}

/**
 * near 指定に応じた空きセル候補リストを返す（最大 count 件）。
 * 'around' で足りない場合は 'room'（プレイヤーゾーン）にフォールバックする。
 */
function collectSpawnCells(dungeon: DungeonMap, near: 'around' | 'room', count: integer): Array<[integer, integer]> {
    if (near === 'around') {
        const cells = getAroundEmptyCells(dungeon);
        if (cells.length >= count) return cells.slice(0, count);
        // 不足 → room を追加してマージ（重複は最初の around 優先）
        const seen = new Set(cells.map(c => `${c[0]},${c[1]}`));
        for (const [rx, ry] of getRoomEmptyCells(dungeon)) {
            const key = `${rx},${ry}`;
            if (seen.has(key)) continue;
            seen.add(key);
            cells.push([rx, ry]);
            if (cells.length >= count) break;
        }
        return cells.slice(0, count);
    }
    // near === 'room'
    return getRoomEmptyCells(dungeon).slice(0, count);
}

function getRoomEmptyCells(dungeon: DungeonMap): Array<[integer, integer]> {
    const { x: px, y: py } = dungeon.getPlayerPos();
    const zone = dungeon.getCellsInZone(px, py);
    const result: Array<[integer, integer]> = [];
    for (const [cx, cy] of zone) {
        if (cx === px && cy === py) continue;
        if (dungeon.getAt(cx, cy) === -1) continue;
        if (dungeon.isCellBlocked(cx, cy)) continue;
        result.push([cx, cy]);
    }
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/**
 * action 配列を順次実行する。self_destruct が出たら最後に EventObject を除去する。
 * player 死亡時は以降の action をスキップ。
 */
export function executeActionArray(
    dungeon: DungeonMap,
    player: Player,
    eventObj: EventObject,
    actions: EventActionEntry[],
): void {
    let shouldDestruct = false;
    for (const entry of actions) {
        const r = executeOneAction(dungeon, player, eventObj, entry);
        if (r.selfDestruct) shouldDestruct = true;
        if (r.playerDied) {
            if (shouldDestruct) dungeon.removeMapObject(eventObj);
            return;
        }
    }
    if (shouldDestruct) dungeon.removeMapObject(eventObj);
}

/**
 * 選択肢メニュー無しのイベント実行（action または random_outcome）。
 * 呼び出し元 (MapInteractionHandler.investigateEvent) は事前に flavor を message-log に出していること。
 */
export function executeEventImmediate(dungeon: DungeonMap, player: Player, eventObj: EventObject): void {
    const def = eventObj.eventDef;
    if (def.action) {
        executeActionArray(dungeon, player, eventObj, def.action);
    } else if (def.random_outcome) {
        const picked = pickRandomOutcome(def.random_outcome);
        if (picked) {
            const turn = dungeon.getTurnCount();
            if (picked.label) {
                EventBus.emit('message-log', `（${picked.label}）`, turn);
            }
            executeActionArray(dungeon, player, eventObj, picked.action);
        }
    }
}

/**
 * 選択肢の 1 つを選んで実行する。
 * - rate あり → 抽選結果に応じて on_success / on_fail を実行
 * - rate なし → action を実行
 *
 * 呼び出し元 (SceneModeController.enterEventChoiceMode の onSelect コールバック) が
 * 事前にコスト支払い可能性をチェック・支払い済みである前提（disabled UI で防止）。
 */
export function executeEventChoice(
    dungeon: DungeonMap,
    player: Player,
    eventObj: EventObject,
    compiledChoice: CompiledEventChoice,
): void {
    const choice = compiledChoice.choice;
    // UI 側でフィルタ済みだが、念のため condition を再判定（すり抜け防止）
    if (!evaluateChoiceCondition(player, compiledChoice.condition)) {
        console.warn(`event '${eventObj.eventDef.name}': choice "${choice.label}" の condition が偽のため実行をスキップ`);
        return;
    }
    if (choice.rate !== undefined) {
        const r = evaluateChoiceRate(player, compiledChoice.rate);
        const success = Math.random() < r;
        const actions = success ? (choice.on_success ?? []) : (choice.on_fail ?? []);
        executeActionArray(dungeon, player, eventObj, actions);
    } else if (choice.action) {
        executeActionArray(dungeon, player, eventObj, choice.action);
    }
}
