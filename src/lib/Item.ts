import type { ItemDefinition, ItemType, ItemEffectSpec } from './ItemsLoader';
import { ItemModifiersLoader } from './ItemModifiersLoader';
import { formatItemLabelWithModifiers } from './ItemLabelFormatter';

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

    /**
     * modifier の count を絶対値で設定する。
     * - count <= 0 なら削除
     * - countable=false は常に count=1 で固定
     * - countable=true は max でクランプ
     * @returns 適用に成功した場合 true（target 不一致や未定義なら false）
     */
    setModifierCount(name: string, count: number): boolean {
        if (count <= 0) {
            return this.modifiers.delete(name);
        }
        const def = ItemModifiersLoader.getInstance().getDefinition(name);
        if (!def) return false;
        if (!def.target.includes(this.definition.type)) return false;
        if (def.countable) {
            const max = def.max ?? Number.MAX_SAFE_INTEGER;
            this.modifiers.set(name, Math.min(count, max));
        } else {
            this.modifiers.set(name, 1);
        }
        return true;
    }

    /**
     * modifier を delta 加算する（巻物などで使用）。
     * - 未付与なら delta（countable=false は 1）で新規付与
     * - countable=true は max でクランプ
     * - target 不一致や未定義は added=false
     * @returns added: 何らかの変化があったか、newCount: 適用後の count（変化なしなら現在値）
     */
    addModifier(name: string, delta: number = 1): { added: boolean; newCount: number } {
        const def = ItemModifiersLoader.getInstance().getDefinition(name);
        if (!def) return { added: false, newCount: this.modifiers.get(name) ?? 0 };
        if (!def.target.includes(this.definition.type)) return { added: false, newCount: this.modifiers.get(name) ?? 0 };

        const current = this.modifiers.get(name) ?? 0;
        let next: number;
        if (def.countable) {
            const max = def.max ?? Number.MAX_SAFE_INTEGER;
            next = Math.min(current + delta, max);
        } else {
            next = 1;
        }
        if (next === current) return { added: false, newCount: current };
        this.modifiers.set(name, next);
        return { added: true, newCount: next };
    }

    removeModifier(name: string): boolean {
        return this.modifiers.delete(name);
    }

    /**
     * 指定 kind タグを持つ modifier を全て削除し、削除した name 配列を返す
     */
    removeModifiersByKind(kind: string): string[] {
        const loader = ItemModifiersLoader.getInstance();
        const removed: string[] = [];
        for (const name of [...this.modifiers.keys()]) {
            const def = loader.getDefinition(name);
            if (def?.kind === kind) {
                this.modifiers.delete(name);
                removed.push(name);
            }
        }
        return removed;
    }

    /**
     * 装備解除可能か（cannot_unequip 効果を持つ modifier が一つでもあれば false）
     */
    canUnequip(): boolean {
        const loader = ItemModifiersLoader.getInstance();
        for (const name of this.modifiers.keys()) {
            const compiled = loader.getCompiled(name);
            if (!compiled) continue;
            for (const e of compiled.effects) {
                if (e.name === 'cannot_unequip') return false;
            }
        }
        return true;
    }

    /**
     * 装備中の modifier add_stats を formula 評価して { stat -> delta } の Map で返す。
     * @param baseFormulaVars 元 stat 値や player 各 stat の辞書。各 modifier 評価時に `count` をマージする。
     */
    getModifierStatBonuses(baseFormulaVars: Record<string, number>): Map<string, number> {
        const result = new Map<string, number>();
        if (this.modifiers.size === 0) return result;
        const loader = ItemModifiersLoader.getInstance();
        for (const [name, count] of this.modifiers) {
            const compiled = loader.getCompiled(name);
            if (!compiled) continue;
            const vars = { ...baseFormulaVars, count };
            for (const e of compiled.effects) {
                if (e.name !== 'add_stats') continue;
                if (!e.target || !e.formula) continue;
                try {
                    const r = e.formula.evaluate(vars);
                    if (typeof r === 'number' && Number.isFinite(r)) {
                        result.set(e.target, (result.get(e.target) ?? 0) + r);
                    }
                } catch (err) {
                    console.warn(`Failed to evaluate modifier "${name}" add_stats formula:`, err);
                }
            }
        }
        return result;
    }

    /**
     * suffix 形式で modifier を含めたラベル（例: "鉄の剣 [攻+2/呪]"）
     */
    getLabelWithModifiers(): string {
        return formatItemLabelWithModifiers(this.getLabel(), this.modifiers);
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