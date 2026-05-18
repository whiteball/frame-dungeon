import { ItemModifiersLoader } from './ItemModifiersLoader';

/**
 * アイテム名に modifier の短縮ラベルを suffix 形式で付与する。
 * 例: "鉄の剣" + { power_reinforced: 2, cursed: 1 } → "鉄の剣 [攻+2/呪]"
 *
 * 循環依存を避けるため Item ではなく素材（baseLabel + modifiers Map）を受け取る形にしている。
 */
export function formatItemLabelWithModifiers(
    baseLabel: string,
    modifiers: ReadonlyMap<string, number>
): string {
    if (modifiers.size === 0) return baseLabel;
    const loader = ItemModifiersLoader.getInstance();
    const tokens: string[] = [];
    for (const [name, count] of modifiers) {
        const def = loader.getDefinition(name);
        if (!def) continue;
        const short = def.shortLabel ?? def.label;
        tokens.push(def.countable ? `${short}${count}` : short);
    }
    if (tokens.length === 0) return baseLabel;
    return `${baseLabel} [${tokens.join('/')}]`;
}
