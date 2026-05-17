import type { ItemDefinition, ItemType, ItemEffectSpec } from './ItemsLoader';

/**
 * ゲーム内のアイテムインスタンスを表すクラス
 * アイテム定義と個別のインスタンス情報を管理
 */
export class Item {
    private definition: ItemDefinition;
    private instanceId: string;
    private quantity: number;
    private modifiers: Map<string, number>;

    constructor(definition: ItemDefinition, instanceId?: string, quantity: number = 1, modifiers?: Map<string, number> | Record<string, number>) {
        this.definition = definition;
        this.instanceId = instanceId || this.generateInstanceId();
        this.quantity = quantity;
        if (modifiers instanceof Map) {
            this.modifiers = new Map(modifiers);
        } else if (modifiers && typeof modifiers === 'object') {
            this.modifiers = new Map(Object.entries(modifiers));
        } else {
            this.modifiers = new Map();
        }
    }

    private generateInstanceId(): string {
        return `item_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    // アイテム定義からの情報取得
    getName(): string {
        return this.definition.name;
    }

    getLabel(): string {
        return this.definition.label;
    }

    getType(): ItemType {
        return this.definition.type;
    }

    getDescription(): string {
        return this.definition.description;
    }

    getDefinition(): ItemDefinition {
        return this.definition;
    }

    // インスタンス固有の情報
    getInstanceId(): string {
        return this.instanceId;
    }

    getQuantity(): number {
        return this.quantity;
    }

    setQuantity(quantity: number): void {
        this.quantity = Math.max(0, quantity);
    }

    addQuantity(amount: number): void {
        this.quantity = Math.max(0, this.quantity + amount);
    }

    // アイテム効果関連
    /**
     * 効果スペックを正規化された配列として取得
     * 単一オブジェクト形式は [単一] に、配列形式はそのまま返す
     */
    getEffectSpecs(): ItemEffectSpec[] {
        const e = this.definition.effect;
        return Array.isArray(e) ? e : [e];
    }

    /**
     * 装備効果（武器・防具）を取得。配列形式の効果（消耗品想定）は対象外
     */
    getEquipmentEffects(): { [statName: string]: number } {
        const effect = this.definition.effect;
        if (Array.isArray(effect)) return {};
        const effects: { [statName: string]: number } = {};
        for (const [key, value] of Object.entries(effect)) {
            if (key !== 'immediate' && key !== 'continuous' && key !== 'resist' && typeof value === 'number') {
                effects[key] = value;
            }
        }
        return effects;
    }

    /**
     * 装備中に有効な resist 配列を取得。配列形式の効果（消耗品想定）は対象外
     */
    getEquipmentResists(): string[] {
        const effect = this.definition.effect;
        if (Array.isArray(effect)) return [];
        return Array.isArray(effect.resist) ? [...effect.resist] : [];
    }

    // アイテム種別チェック
    isWeapon(): boolean {
        return this.definition.type === 'weapon';
    }

    isMainArmor(): boolean {
        return this.definition.type === 'main_armor';
    }

    isSubArmor(): boolean {
        return this.definition.type === 'sub_armor';
    }

    isConsumable(): boolean {
        return this.definition.type === 'consumable';
    }

    isEquippable(): boolean {
        return this.isWeapon() || this.isMainArmor() || this.isSubArmor();
    }

    // 修飾状態（modifier）
    /**
     * 全 modifier のスナップショットを Map で返す（読み取り専用扱い推奨）
     */
    getModifiers(): Map<string, number> {
        return new Map(this.modifiers);
    }

    hasModifier(name: string): boolean {
        return this.modifiers.has(name);
    }

    getModifierCount(name: string): number {
        return this.modifiers.get(name) ?? 0;
    }

    // ユーティリティ
    clone(newInstanceId?: string): Item {
        return new Item(this.definition, newInstanceId, this.quantity, this.modifiers);
    }

    equals(other: Item): boolean {
        return this.instanceId === other.instanceId;
    }

    hasSameDefinition(other: Item): boolean {
        return this.definition.name === other.definition.name;
    }

    toString(): string {
        return `${this.getLabel()} (${this.getName()})${this.quantity > 1 ? ` x${this.quantity}` : ''}`;
    }

    serialize(): { instanceId: string; name: string; quantity: number; modifiers?: Record<string, number> } {
        const data: { instanceId: string; name: string; quantity: number; modifiers?: Record<string, number> } = {
            instanceId: this.instanceId,
            name: this.definition.name,
            quantity: this.quantity,
        };
        if (this.modifiers.size > 0) {
            data.modifiers = Object.fromEntries(this.modifiers);
        }
        return data;
    }

    /**
     * セーブデータから Item を復元する。
     * modifiers フィールドが欠落していても動作する（旧セーブ互換）。
     */
    static deserialize(
        data: { instanceId: string; name: string; quantity: number; modifiers?: Record<string, number> },
        definition: ItemDefinition
    ): Item {
        return new Item(definition, data.instanceId, data.quantity, data.modifiers);
    }
}