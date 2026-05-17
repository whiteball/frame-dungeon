import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';

/**
 * アイテム修飾状態（modifier）定義
 * Phase 1 では最小フィールドのみ。Phase 2 以降で effect / target / countable などを追加する。
 */
export interface ItemModifierDefinition {
    name: string;
    label: string;
    shortLabel?: string;
    description?: string;
}

export class ItemModifiersLoader {
    private static instance: ItemModifiersLoader;
    private store = new YamlDefinitionStore<ItemModifierDefinition>();

    private constructor() {}

    static getInstance(): ItemModifiersLoader {
        if (!this.instance) {
            this.instance = new ItemModifiersLoader();
        }
        return this.instance;
    }

    async load(): Promise<void> {
        const customText = CustomDataStore.get('item_modifiers');
        await this.store.load(
            `${import.meta.env.BASE_URL}data/item_modifiers.yml`,
            'アイテム修飾状態',
            def => this.validate(def),
            { customText }
        );
    }

    private validate(def: any): void {
        if (!def.name || typeof def.name !== 'string') {
            throw new Error(`Invalid item_modifier: missing or invalid 'name' field`);
        }
        if (!def.label || typeof def.label !== 'string') {
            throw new Error(`Invalid item_modifier '${def.name}': missing or invalid 'label' field`);
        }
    }

    getAll(): ItemModifierDefinition[] {
        return this.store.getAll();
    }

    getDefinition(name: string): ItemModifierDefinition | undefined {
        return this.store.getByName(name);
    }

    has(name: string): boolean {
        return this.store.has(name);
    }
}
