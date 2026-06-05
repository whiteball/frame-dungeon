import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';

export type ItemType = 'weapon' | 'main_armor' | 'sub_armor' | 'consumable';

/**
 * remove_modifier_kind の対象スロット指定
 * - 'all_equipped': 装備中すべて
 * - 'weapon' / 'main_armor' / 'sub_armor': 該当タイプの装備中スロット（sub_armor は 1/2 両方）
 */
export type RemoveModifierTarget = 'all_equipped' | 'weapon' | 'main_armor' | 'sub_armor';

export interface RemoveModifierKindSpec {
    kind: string;
    target: RemoveModifierTarget;
}

/**
 * 即座効果。能力値変動（statName: number）に加え、特殊キーを持つ
 * - applyEffect: <effectName> — 状態異常を付与
 * - clearEffect: <effectName> — 状態異常を解除
 * - learnSkill: <skillName> — スキルを習得（既習得ならログのみ・アイテムは消費）
 * - executeSkill: <skillName> — アクティブスキルを即時発動（コスト無し・未習得不問）。
 *   target=front のスキルは方向選択 UI に切替わり、確定時のみアイテム消費・キャンセル時は非消費
 * - add_modifier: <modifierName> — 装備中の対象 type 全アイテムに modifier を付与（countable は +1 でスタック、未付与なら count=1）
 * - remove_modifier_kind: { kind, target } — 指定スロットの装備から該当 kind の modifier を全て除去
 */
export interface ImmediateEffect {
    applyEffect?: string;
    clearEffect?: string;
    learnSkill?: string;
    executeSkill?: string;
    add_modifier?: string;
    remove_modifier_kind?: RemoveModifierKindSpec;
    [statName: string]: number | string | RemoveModifierKindSpec | undefined;
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

/**
 * 装備中にプレイヤーへ付与するパッシブスキルのエントリ
 * - name: skills.yml のスキル名（trigger は on_attack / on_turn / on_damage / passive のいずれか）
 * - rate: 発動率 0..1（passive 系の常時 stat 加算は事実上 1 のみが意味を持つ）
 */
export interface ItemPassiveSkillEntry {
    name: string;
    rate: number;
}

/**
 * 投擲時に敵へ発揮する効果エントリ（スキル action 形式に準じる）。
 * 1 エントリにつき 1 種別を指定する。配列で複数列挙可能。
 * - damage: 数値リテラルまたは formula 文字列（DamageAction と同じ変数体系で評価）
 * - apply_effect: effect 名（文字列）または { effect, rate } で状態異常を付与
 * - clear_effect: effect 名。命中した敵の当該状態異常を解除する
 *
 * throwEffect が定義されている場合、武器の仮装備ダメージ・消費アイテムの効果転用より
 * 優先して発揮される。
 */
export interface ThrowEffectEntry {
    damage?: number | string;
    apply_effect?: string | { effect: string; rate?: number | string };
    clear_effect?: string;
}

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
    /**
     * 装備中に付与されるパッシブスキル一覧（省略可）
     */
    passive_skills?: ItemPassiveSkillEntry[];
    /**
     * 投擲して敵に命中したときに発揮する効果（省略可）。
     * 指定があれば武器の仮装備ダメージ・消費アイテムの効果転用より優先される。
     */
    throwEffect?: ThrowEffectEntry[];
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
        await this.store.load(`${import.meta.env.BASE_URL}data/items.yml`, 'アイテム', item => this.validateItemDefinition(item), { customText });
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
            if (spec.immediate && typeof spec.immediate === 'object') {
                if (spec.immediate.add_modifier !== undefined && typeof spec.immediate.add_modifier !== 'string') {
                    throw new Error(`Invalid item '${item.name}': effect[${i}].immediate.add_modifier must be a string (modifier name)`);
                }
                if (spec.immediate.remove_modifier_kind !== undefined) {
                    const r = spec.immediate.remove_modifier_kind;
                    if (!r || typeof r !== 'object' || Array.isArray(r)) {
                        throw new Error(`Invalid item '${item.name}': effect[${i}].immediate.remove_modifier_kind must be an object`);
                    }
                    if (typeof r.kind !== 'string' || !r.kind) {
                        throw new Error(`Invalid item '${item.name}': effect[${i}].immediate.remove_modifier_kind.kind must be a non-empty string`);
                    }
                    if (!['all_equipped', 'weapon', 'main_armor', 'sub_armor'].includes(r.target)) {
                        throw new Error(`Invalid item '${item.name}': effect[${i}].immediate.remove_modifier_kind.target must be one of all_equipped/weapon/main_armor/sub_armor`);
                    }
                }
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
        if (item.passive_skills !== undefined) {
            if (!Array.isArray(item.passive_skills)) {
                throw new Error(`Invalid item '${item.name}': 'passive_skills' must be an array`);
            }
            for (let i = 0; i < item.passive_skills.length; i++) {
                const ps = item.passive_skills[i];
                if (!ps || typeof ps !== 'object' || Array.isArray(ps)) {
                    throw new Error(`Invalid item '${item.name}': passive_skills[${i}] must be an object`);
                }
                if (typeof ps.name !== 'string' || !ps.name) {
                    throw new Error(`Invalid item '${item.name}': passive_skills[${i}].name must be a non-empty string`);
                }
                if (typeof ps.rate !== 'number' || ps.rate < 0 || ps.rate > 1) {
                    throw new Error(`Invalid item '${item.name}': passive_skills[${i}].rate must be a number in [0, 1]`);
                }
            }
        }
        if (item.throwEffect !== undefined) {
            if (!Array.isArray(item.throwEffect)) {
                throw new Error(`Invalid item '${item.name}': 'throwEffect' must be an array`);
            }
            for (let i = 0; i < item.throwEffect.length; i++) {
                const e = item.throwEffect[i];
                if (!e || typeof e !== 'object' || Array.isArray(e)) {
                    throw new Error(`Invalid item '${item.name}': throwEffect[${i}] must be an object`);
                }
                if (e.damage !== undefined && typeof e.damage !== 'number' && typeof e.damage !== 'string') {
                    throw new Error(`Invalid item '${item.name}': throwEffect[${i}].damage must be a number or formula string`);
                }
                if (e.apply_effect !== undefined) {
                    const ae = e.apply_effect;
                    if (typeof ae === 'object') {
                        if (!ae || Array.isArray(ae) || typeof ae.effect !== 'string' || !ae.effect) {
                            throw new Error(`Invalid item '${item.name}': throwEffect[${i}].apply_effect must be a string or { effect, rate } object`);
                        }
                        if (ae.rate !== undefined && typeof ae.rate !== 'number' && typeof ae.rate !== 'string') {
                            throw new Error(`Invalid item '${item.name}': throwEffect[${i}].apply_effect.rate must be a number or string`);
                        }
                    } else if (typeof ae !== 'string') {
                        throw new Error(`Invalid item '${item.name}': throwEffect[${i}].apply_effect must be a string or { effect, rate } object`);
                    }
                }
                if (e.clear_effect !== undefined && typeof e.clear_effect !== 'string') {
                    throw new Error(`Invalid item '${item.name}': throwEffect[${i}].clear_effect must be a string`);
                }
            }
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
