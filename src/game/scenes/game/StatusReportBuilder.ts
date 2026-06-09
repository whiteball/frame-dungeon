import { StatsLoader } from '../../../lib/StatsLoader';
import { BaseLoader } from '../../../lib/BaseLoader';
import type { Player } from '../../../lib/Player';
import type { DungeonMap } from '../../../lib/MapGenerator';

type DisplayStatData = {
    bonus: number;
    hasFluctuation: boolean;
    maxValue: number | null;
    currentValue: number;
};

/**
 * バフ・デバフで小数化した stat 値を小数第1位までに丸めて表示用文字列にする。
 * 丸めた結果が整数値（.0）になる場合は整数として返す。
 */
function formatStatNumber(n: number): string {
    return Number(n.toFixed(1)).toString();
}

/**
 * stat の現在値を、bonus 表記（(+N)）と変動値（current/max）を組み合わせた
 * 表示用文字列に整形する。bonus=0 かつ非変動なら数値そのまま返す。
 */
export function formatStatValue(data: DisplayStatData): number | string {
    const bonusStr = data.bonus > 0 ? `(+${formatStatNumber(data.bonus)})` : `(${formatStatNumber(data.bonus)})`;
    const currentStr = formatStatNumber(data.currentValue);
    if (data.hasFluctuation && data.maxValue !== null) {
        const maxStr = formatStatNumber(data.maxValue);
        const maxPart = data.bonus !== 0 ? `${maxStr}${bonusStr}` : maxStr;
        return `${currentStr}/${maxPart}`;
    } else if (data.bonus !== 0) {
        return `${currentStr}${bonusStr}`;
    } else {
        return data.currentValue;
    }
}

/**
 * プレイヤーの表示用 stat マップ（略称 → 整形済み値）を構築する。
 *
 * showAll=false（InfoView 用）の場合は `displayOrdered` の stat のみ、
 * かつ `default` 値と一致する stat はスキップする（変動していないものを省略）。
 * showAll=true（ステータス画面・リザルト画面用）の場合は全 stat を
 * `order` 昇順で並べる。
 *
 * 状態異常が 1 件以上あれば末尾に '状態' エントリを追加する。
 */
export function buildDisplayParams(player: Player, showAll = false): Map<string, number | string> {
    const displayParams = new Map<string, number | string>();
    const displayStats = player.getDisplayStats();
    const statsLoader = StatsLoader.getInstance();

    if (showAll) {
        const sorted = [...statsLoader.getStats()].sort((a, b) => {
            if (a.order !== undefined && b.order !== undefined) return a.order - b.order;
            if (a.order !== undefined) return -1;
            if (b.order !== undefined) return 1;
            return 0;
        });
        for (const statDef of sorted) {
            const data = displayStats.get(statDef.name);
            if (!data) continue;
            displayParams.set(data.abbreviation, formatStatValue(data));
        }
    } else {
        for (const statDef of statsLoader.getDisplayOrderedStats()) {
            const data = displayStats.get(statDef.name);
            if (!data) continue;
            if (statDef.default !== undefined && data.currentValue === statDef.default) continue;
            displayParams.set(data.abbreviation, formatStatValue(data));
        }
    }

    const statusEffects = player.getActiveStatusEffects();
    if (statusEffects.length > 0) {
        displayParams.set('状態', statusEffects.map(e => e.label).join('、'));
    }

    return displayParams;
}

function appendStatLines(lines: string[], player: Player): void {
    const displayParams = buildDisplayParams(player, true);
    for (const [key, value] of displayParams) {
        lines.push(`${key}：${value}`);
    }
    if (!displayParams.has('状態')) {
        lines.push('状態：なし');
    }
}

function appendEquipmentLines(lines: string[], player: Player): void {
    lines.push(`武器：${player.getEquippedWeapon()?.getLabelWithModifiers() ?? 'なし'}`);
    lines.push(`メイン防具：${player.getEquippedMainArmor()?.getLabelWithModifiers() ?? 'なし'}`);
    lines.push(`サブ防具１：${player.getEquippedSubArmor1()?.getLabelWithModifiers() ?? 'なし'}`);
    lines.push(`サブ防具２：${player.getEquippedSubArmor2()?.getLabelWithModifiers() ?? 'なし'}`);
}

function appendInventoryLines(lines: string[], player: Player): void {
    const inventory = player.getInventory();
    lines.push(`アイテム(${inventory.getUsedCapacity()}/${inventory.getCapacity()})：`);
    const items = inventory.getItems();
    if (items.length > 0) {
        for (const item of items) {
            lines.push(item.getLabelWithModifiers());
        }
    } else {
        lines.push('なし');
    }
}

/** ステータス画面用のテキスト全体を組み立てる。 */
export function buildStatusText(args: { floor: number; dungeon: DungeonMap; player: Player }): string {
    const { floor, dungeon, player } = args;
    const lines: string[] = [];

    lines.push(`現在の階層：${BaseLoader.getInstance().formatFloorLabel(floor)}`);
    lines.push(`総経過ターン数：${dungeon.getTurnCount()}`);
    lines.push(`現在の階層のターン数：${dungeon.getFloorTurnCount()}`);
    lines.push(`レベル：${player.level}`);
    lines.push(`次のレベルまでの経験値：${player.expToNextLevel() - player.exp}`);
    lines.push('');

    appendStatLines(lines, player);
    lines.push('');

    appendEquipmentLines(lines, player);
    lines.push('');

    appendInventoryLines(lines, player);

    return lines.join('\n');
}

export type ResultTextSettings = {
    viewRange: number;
    enableFog: boolean;
    revealAll: boolean;
    debugCommands: boolean;
};

/** GameOver / GameClear 画面用のリザルトテキストを組み立てる。 */
export function buildResultText(args: {
    floor: number;
    dungeon: DungeonMap;
    player: Player;
    settings: ResultTextSettings;
}): string {
    const { floor, dungeon, player, settings } = args;
    const lines: string[] = [];

    lines.push(`最終到達階層：${BaseLoader.getInstance().formatFloorLabel(floor)}`);
    lines.push(`総経過ターン数：${dungeon.getTurnCount()}`);
    lines.push(`レベル：${player.level}`);
    lines.push(`次のレベルまでの経験値：${player.expToNextLevel() - player.exp}`);
    lines.push(`倒した敵の数：${player.getEnemiesDefeated()}`);
    lines.push(`使ったアイテムの数：${player.getItemsUsed()}`);
    lines.push('');

    appendStatLines(lines, player);
    lines.push('');

    appendEquipmentLines(lines, player);
    lines.push('');

    appendInventoryLines(lines, player);
    lines.push('');

    lines.push('設定');
    lines.push(`プレイヤーの視界：${settings.viewRange}`);
    lines.push(`フォグの有無：${settings.enableFog ? 'あり' : 'なし'}`);
    lines.push(`常に敵を表示：${settings.revealAll ? 'ON' : 'OFF'}`);
    lines.push(`デバッグコマンド：${settings.debugCommands ? 'ON' : 'OFF'}`);

    return lines.join('\n');
}
