import { Item } from './Item';
import { ItemsLoader } from './ItemsLoader';
import { ItemModifiersLoader } from './ItemModifiersLoader';
import { BaseLoader } from './BaseLoader';

/**
 * アイテム生成ヘルパー。
 *
 * 単純な定義参照だけでなく、フロア配置時の modifier 抽選も担当する。
 * 各 Loader の Singleton (`getInstance()`) を直接参照する。
 */
export class ItemFactory {
    /**
     * @param options.rollModifiers true なら floor 設定に従って modifier を抽選付与
     * @param options.floor 抽選に使うフロア番号（rollModifiers=true 必須）
     * @param options.modifierChanceOverride 抽選確率を上書き（敵ドロップ等で個別調整用）
     */
    static createItem(itemName: string, options?: { rollModifiers?: boolean; floor?: number; modifierChanceOverride?: number }): Item | null {
        const itemsLoader = ItemsLoader.getInstance();
        const definition = itemsLoader.getItem(itemName);
        if (!definition) {
            console.error(`Item definition not found: ${itemName}`);
            return null;
        }

        const item = new Item(definition);
        if (options?.rollModifiers && typeof options.floor === 'number') {
            ItemFactory.rollFloorModifierFor(item, options.floor, options.modifierChanceOverride);
        }
        return item;
    }

    /**
     * 指定 floor の itemModifierChance/Pool に従って 1 回 modifier 抽選を行い、
     * 当選した場合に Item へ initial 抽選範囲の count で付与する。
     * @param chanceOverride 確率を上書き（例: 敵ドロップ別設定）
     */
    private static rollFloorModifierFor(item: Item, floor: number, chanceOverride?: number): void {
        const floorConfig = BaseLoader.getInstance().getFloorConfig(floor);
        const chance = chanceOverride ?? floorConfig.itemModifierChance;
        if (chance <= 0) return;
        if (Math.random() >= chance) return;

        const modifiersLoader = ItemModifiersLoader.getInstance();
        const name = modifiersLoader.pickRandomFor(item.getType(), floorConfig.itemModifierPool);
        if (!name) return;
        const count = modifiersLoader.rollInitialCount(name);
        item.setModifierCount(name, count);
    }
}
