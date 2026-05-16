import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';

export type ItemType = 'weapon' | 'main_armor' | 'sub_armor' | 'consumable';

/**
 * 即座効果。能力値変動（statName: number）に加え、特殊キーを持つ
 * - applyEffect: <effectName> — 状態異常を付与
 * - clearEffect: <effectName> — 状態異常を解除
 * - learnSkill: <skillName> — スキルを習得（既習得ならログのみ・アイテムは消費）
 */
export interface ImmediateEffect {
    applyEffect?: string;
    clearEffect?: string;
    learnSkill?: string;
    [statName: string]: number | string | undefined;
}

export interface ContinuousEffect {
    turns: number;
    resist?: string[];
    [statName: string]: number | string[] | undefined;
}

/**
 * 単一の効果スペック（即座・持続を含む）
 * 装備系の能力値ボーナス（power, defense 等）はトップレベルの数値として記述
 * resist は effect 名の配列で、装備中はその状態異常の付与を阻止する
 */
export interface ItemEffectSpec {
    immediate?: ImmediateEffect;
    continuous?: ContinuousEffect;
    resist?: string[];
    [statName: string]: number | string[] | ImmediateEffect | ContinuousEffect | undefined;
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
    private store = new YamlDefinitionStore<ItemDefinition>();

    private constructor() {}

    static getInstance(): ItemsLoader {
        if (!this.instance) {
            this.instance = new ItemsLoader();
        }
        return this.instance;
    }

    async loadItems(): Promise<void> {
        const customText = CustomDataStore.get('items');
        await this.store.load('/data/items.yml', 'アイテム', item => this.validateItemDefinition(item), { customText });
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
            if (spec.resist !== undefined) {
                if (!Array.isArray(spec.resist) || spec.resist.some((r: unknown) => typeof r !== 'string')) {
                    throw new Error(`Invalid item '${item.name}': effect[${i}].resist must be an array of strings`);
                }
            }
            if (spec.continuous && spec.continuous.resist !== undefined) {
                if (!Array.isArray(spec.continuous.resist) || spec.continuous.resist.some((r: unknown) => typeof r !== 'string')) {
                    throw new Error(`Invalid item '${item.name}': effect[${i}].continuous.resist must be an array of strings`);
                }
            }
        }
        if (!item.description || typeof item.description !== 'string') {
            throw new Error(`Invalid item '${item.name}': missing or invalid 'description' field`);
        }
    }

    getItems(): ItemDefinition[] {
        return this.store.getAll();
    }

    getItem(name: string): ItemDefinition | undefined {
        return this.store.getByName(name);
    }

    getItemNames(): string[] {
        return this.store.getNames();
    }

    getItemsByType(type: ItemType): ItemDefinition[] {
        return this.store.getAll().filter(item => item.type === type);
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
