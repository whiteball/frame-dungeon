import { Parser, type Expression } from 'expr-eval-fork';
import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';
import type { ItemType } from './ItemsLoader';

/**
 * 修飾状態の effect 種別
 * - add_stats: target ステータスに formula 評価結果を加算（装備中のみ）
 * - cannot_unequip: 装備中、当該装備の解除をブロック
 */
export type ItemModifierEffectName = 'add_stats' | 'cannot_unequip';

export interface ItemModifierEffectSpec {
    name: ItemModifierEffectName;
    /** add_stats 用 stat 名 */
    target?: string;
    /** add_stats 用 formula 文字列。変数: count, 元 stat 値, player 各 stat */
    formula?: string;
}

export interface ItemModifierDefinition {
    name: string;
    label: string;
    shortLabel?: string;
    description?: string;
    effect: ItemModifierEffectSpec[];
    target: ItemType[];
    countable?: boolean;
    /** countable=true 必須。重ねがけ最大 count */
    max?: number;
    /** 床配置時の初期 count 抽選範囲（Phase 3 で使用） */
    initial?: { min: number; max: number };
    /** 解呪などタグ別一括除去用 */
    kind?: string;
    /** フロア床配置時の抽選重み（既定 1） */
    weight?: number;
}

export interface CompiledModifierEffect {
    name: ItemModifierEffectName;
    target?: string;
    formula?: Expression;
}

export interface CompiledItemModifier {
    definition: ItemModifierDefinition;
    effects: CompiledModifierEffect[];
}

const VALID_TARGET_TYPES = new Set<string>(['weapon', 'main_armor', 'sub_armor', 'consumable']);
const VALID_EFFECT_NAMES = new Set<string>(['add_stats', 'cannot_unequip']);

export class ItemModifiersLoader {
    private static instance: ItemModifiersLoader;
    private store = new YamlDefinitionStore<ItemModifierDefinition>();
    private compiled = new Map<string, CompiledItemModifier>();
    private parser = new Parser();

    private constructor() {}

    static getInstance(): ItemModifiersLoader {
        if (!this.instance) {
            this.instance = new ItemModifiersLoader();
        }
        return this.instance;
    }

    async load(): Promise<void> {
        this.compiled.clear();
        const customText = CustomDataStore.get('item_modifiers');
        await this.store.load(
            `${import.meta.env.BASE_URL}data/item_modifiers.yml`,
            'アイテム修飾状態',
            def => this.validate(def),
            { customText }
        );
        for (const def of this.store.getAll()) {
            this.compiled.set(def.name, this.compile(def));
        }
    }

    private validate(def: any): void {
        if (!def.name || typeof def.name !== 'string') {
            throw new Error(`Invalid item_modifier: missing or invalid 'name' field`);
        }
        if (!def.label || typeof def.label !== 'string') {
            throw new Error(`Invalid item_modifier '${def.name}': missing or invalid 'label' field`);
        }
        if (def.shortLabel !== undefined && typeof def.shortLabel !== 'string') {
            throw new Error(`Invalid item_modifier '${def.name}': 'shortLabel' must be a string if present`);
        }
        if (def.description !== undefined && typeof def.description !== 'string') {
            throw new Error(`Invalid item_modifier '${def.name}': 'description' must be a string if present`);
        }
        if (!Array.isArray(def.target) || def.target.length === 0) {
            throw new Error(`Invalid item_modifier '${def.name}': 'target' must be a non-empty array of item types`);
        }
        for (const t of def.target) {
            if (typeof t !== 'string' || !VALID_TARGET_TYPES.has(t)) {
                throw new Error(`Invalid item_modifier '${def.name}': target "${t}" is not a valid item type`);
            }
        }
        if (!Array.isArray(def.effect) || def.effect.length === 0) {
            throw new Error(`Invalid item_modifier '${def.name}': 'effect' must be a non-empty array`);
        }
        for (let i = 0; i < def.effect.length; i++) {
            const e = def.effect[i];
            if (!e || typeof e !== 'object' || Array.isArray(e)) {
                throw new Error(`Invalid item_modifier '${def.name}': effect[${i}] must be an object`);
            }
            if (typeof e.name !== 'string' || !VALID_EFFECT_NAMES.has(e.name)) {
                throw new Error(`Invalid item_modifier '${def.name}': effect[${i}].name must be one of ${[...VALID_EFFECT_NAMES].join(', ')}`);
            }
            if (e.name === 'add_stats') {
                if (typeof e.target !== 'string' || !e.target) {
                    throw new Error(`Invalid item_modifier '${def.name}': effect[${i}] (add_stats) requires 'target' (stat name)`);
                }
                if (typeof e.formula !== 'string' || !e.formula) {
                    throw new Error(`Invalid item_modifier '${def.name}': effect[${i}] (add_stats) requires 'formula'`);
                }
                try {
                    this.parser.parse(e.formula);
                } catch (err) {
                    throw new Error(`Invalid item_modifier '${def.name}': effect[${i}].formula のパースに失敗: ${err instanceof Error ? err.message : String(err)}`);
                }
            }
        }
        if (def.countable !== undefined && typeof def.countable !== 'boolean') {
            throw new Error(`Invalid item_modifier '${def.name}': 'countable' must be a boolean`);
        }
        if (def.countable === true) {
            if (typeof def.max !== 'number' || def.max < 1) {
                throw new Error(`Invalid item_modifier '${def.name}': countable=true requires 'max' >= 1`);
            }
            if (def.initial !== undefined) {
                const init = def.initial;
                if (!init || typeof init !== 'object'
                    || typeof init.min !== 'number' || typeof init.max !== 'number'
                    || init.min < 1 || init.max < init.min || init.max > def.max) {
                    throw new Error(`Invalid item_modifier '${def.name}': 'initial' must be { min, max } with 1 <= min <= max <= ${def.max}`);
                }
            }
        }
        if (def.kind !== undefined && typeof def.kind !== 'string') {
            throw new Error(`Invalid item_modifier '${def.name}': 'kind' must be a string if present`);
        }
        if (def.weight !== undefined && (typeof def.weight !== 'number' || def.weight < 0)) {
            throw new Error(`Invalid item_modifier '${def.name}': 'weight' must be a non-negative number`);
        }
    }

    private compile(def: ItemModifierDefinition): CompiledItemModifier {
        const effects: CompiledModifierEffect[] = [];
        for (const e of def.effect) {
            const compiled: CompiledModifierEffect = { name: e.name, target: e.target };
            if (e.formula) {
                try {
                    compiled.formula = this.parser.parse(e.formula);
                } catch (err) {
                    console.warn(`Failed to parse formula "${e.formula}" in item_modifier "${def.name}":`, err);
                }
            }
            effects.push(compiled);
        }
        return { definition: def, effects };
    }

    getAll(): ItemModifierDefinition[] {
        return this.store.getAll();
    }

    getDefinition(name: string): ItemModifierDefinition | undefined {
        return this.store.getByName(name);
    }

    getCompiled(name: string): CompiledItemModifier | undefined {
        return this.compiled.get(name);
    }

    has(name: string): boolean {
        return this.store.has(name);
    }

    /**
     * 指定 kind タグを持つ modifier 名のリストを返す（解呪などタグ別除去用）
     */
    getNamesByKind(kind: string): string[] {
        return this.store.getAll().filter(d => d.kind === kind).map(d => d.name);
    }
}
