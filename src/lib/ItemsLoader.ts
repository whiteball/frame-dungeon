import yaml from 'js-yaml';

export type ItemType = 'weapon' | 'main_armor' | 'sub_armor' | 'consumable';

/**
 * 即座効果。能力値変動（statName: number）に加え、状態異常付与/解除の特殊キーを持つ
 * - applyEffect: <effectName> — 状態異常を付与
 * - clearEffect: <effectName> — 状態異常を解除
 */
export interface ImmediateEffect {
    applyEffect?: string;
    clearEffect?: string;
    [statName: string]: number | string | undefined;
}

export interface ContinuousEffect {
    turns: number;
    [statName: string]: number;
}

/**
 * 単一の効果スペック（即座・持続を含む）
 * 装備系の能力値ボーナス（power, defense 等）はトップレベルの数値として記述
 */
export interface ItemEffectSpec {
    immediate?: ImmediateEffect;
    continuous?: ContinuousEffect;
    [statName: string]: number | ImmediateEffect | ContinuousEffect | undefined;
}

/**
 * アイテム効果。装備系は単一スペック、消耗品は単一/配列両方サポート
 */
export type ItemEffect = ItemEffectSpec | ItemEffectSpec[];

export interface ItemDefinition {
    /**
     * アイテム内部ID（英語）
     */
    name: string;
    /**
     * アイテム表示名（日本語）
     */
    label: string;
    /**
     * アイテム種別
     */
    type: ItemType;
    /**
     * アイテム効果
     */
    effect: ItemEffect;
    /**
     * アイテム説明文
     */
    description: string;
}

export class ItemsLoader {
    private static instance: ItemsLoader;
    private items: ItemDefinition[] = [];
    private itemsByName: Map<string, ItemDefinition> = new Map();

    private constructor() {}

    static getInstance(): ItemsLoader {
        if (!this.instance) {
            this.instance = new ItemsLoader();
        }
        return this.instance;
    }

    async loadItems(): Promise<void> {
        try {
            const response = await fetch('/data/items.yml');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const yamlText = await response.text();
            if (!yamlText.trim()) {
                throw new Error('items.yml is empty');
            }
            
            const parsed = yaml.load(yamlText) as ItemDefinition[];
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('items.yml does not contain valid item definitions');
            }
            
            // アイテム定義の検証
            for (const item of parsed) {
                this.validateItemDefinition(item);
            }
            
            this.items = parsed;
            this.itemsByName.clear();
            
            for (const item of this.items) {
                this.itemsByName.set(item.name, item);
            }
        } catch (error) {
            console.error('Failed to load items.yml:', error);
            alert(`アイテムデータの読み込みに失敗しました。\n\n` +
                  `public/data/items.yml ファイルが正しく配置されており、\n` +
                  `内容が正しい形式であることを確認してください。\n\n` +
                  `エラー詳細: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    private validateItemDefinition(item: any): void {
        if (!item.name || typeof item.name !== 'string') {
            throw new Error(`Invalid item: missing or invalid 'name' field`);
        }
        if (!item.label || typeof item.label !== 'string') {
            throw new Error(`Invalid item '${item.name}': missing or invalid 'label' field`);
        }
        if (!item.type || !['weapon', 'main_armor', 'sub_armor', 'consumable'].includes(item.type)) {
            throw new Error(`Invalid item '${item.name}': invalid 'type' field. Must be weapon, main_armor, sub_armor, or consumable`);
        }
        if (!item.effect || typeof item.effect !== 'object') {
            throw new Error(`Invalid item '${item.name}': missing or invalid 'effect' field`);
        }
        // effect は単一オブジェクトまたは配列のいずれかを許容
        const specs: any[] = Array.isArray(item.effect) ? item.effect : [item.effect];
        for (let i = 0; i < specs.length; i++) {
            const spec = specs[i];
            if (!spec || typeof spec !== 'object' || Array.isArray(spec)) {
                throw new Error(`Invalid item '${item.name}': effect[${i}] must be an object`);
            }
            if (spec.immediate !== undefined && (typeof spec.immediate !== 'object' || spec.immediate === null || Array.isArray(spec.immediate))) {
                throw new Error(`Invalid item '${item.name}': effect[${i}].immediate must be an object`);
            }
            if (spec.continuous !== undefined && (typeof spec.continuous !== 'object' || spec.continuous === null || Array.isArray(spec.continuous))) {
                throw new Error(`Invalid item '${item.name}': effect[${i}].continuous must be an object`);
            }
        }
        if (!item.description || typeof item.description !== 'string') {
            throw new Error(`Invalid item '${item.name}': missing or invalid 'description' field`);
        }
    }

    getItems(): ItemDefinition[] {
        return [...this.items];
    }

    getItem(name: string): ItemDefinition | undefined {
        return this.itemsByName.get(name);
    }

    getItemNames(): string[] {
        return this.items.map(item => item.name);
    }

    getItemsByType(type: ItemType): ItemDefinition[] {
        return this.items.filter(item => item.type === type);
    }

    getWeapons(): ItemDefinition[] {
        return this.getItemsByType('weapon');
    }

    getMainArmors(): ItemDefinition[] {
        return this.getItemsByType('main_armor');
    }

    getSubArmors(): ItemDefinition[] {
        return this.getItemsByType('sub_armor');
    }

    getConsumables(): ItemDefinition[] {
        return this.getItemsByType('consumable');
    }

}