import type { ItemDefinition, ItemType, ImmediateEffect, ContinuousEffect } from './ItemsLoader';

/**
 * ゲーム内のアイテムインスタンスを表すクラス
 * アイテム定義と個別のインスタンス情報を管理
 */
export class Item {
    private definition: ItemDefinition;
    private instanceId: string;
    private quantity: number;

    constructor(definition: ItemDefinition, instanceId?: string, quantity: number = 1) {
        this.definition = definition;
        this.instanceId = instanceId || this.generateInstanceId();
        this.quantity = quantity;
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
    getImmediateEffect(): ImmediateEffect | undefined {
        return this.definition.effect.immediate;
    }

    getContinuousEffect(): ContinuousEffect | undefined {
        return this.definition.effect.continuous;
    }

    hasImmediateEffect(): boolean {
        return this.definition.effect.immediate !== undefined;
    }

    getEquipmentEffects(): { [statName: string]: number } {
        const effects: { [statName: string]: number } = {};
        for (const [key, value] of Object.entries(this.definition.effect)) {
            if (key !== 'immediate' && key !== 'continuous' && typeof value === 'number') {
                effects[key] = value;
            }
        }
        return effects;
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

    // ユーティリティ
    clone(newInstanceId?: string): Item {
        return new Item(this.definition, newInstanceId, this.quantity);
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
}