import { Item } from './Item';
import type { ItemType } from './ItemsLoader';

/**
 * プレイヤーのインベントリを管理するクラス
 */
export class Inventory {
    private items: Item[] = [];
    private capacity: number;

    constructor(capacity: number = 20) {
        this.capacity = capacity;
    }

    /**
     * アイテムを追加
     * @param item 追加するアイテム
     * @returns 追加に成功した場合はtrue
     */
    addItem(item: Item): boolean {
        if (this.items.length >= this.capacity) {
            return false;
        }

        this.items.push(item);
        return true;
    }

    /**
     * アイテムを削除
     * @param item 削除するアイテム
     * @returns 削除に成功した場合はtrue
     */
    removeItem(item: Item): boolean {
        const index = this.items.findIndex(i => i.equals(item));
        if (index !== -1) {
            this.items.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * インスタンスIDでアイテムを削除
     * @param instanceId 削除するアイテムのインスタンスID
     * @returns 削除に成功した場合はtrue
     */
    removeItemById(instanceId: string): boolean {
        const index = this.items.findIndex(i => i.getInstanceId() === instanceId);
        if (index !== -1) {
            this.items.splice(index, 1);
            return true;
        }
        return false;
    }

    /**
     * インデックスでアイテムを削除
     * @param index 削除するアイテムのインデックス
     * @returns 削除されたアイテム、失敗した場合はundefined
     */
    removeItemByIndex(index: number): Item | undefined {
        if (index >= 0 && index < this.items.length) {
            return this.items.splice(index, 1)[0];
        }
        return undefined;
    }

    /**
     * インスタンスIDでアイテムを取得
     * @param instanceId 取得するアイテムのインスタンスID
     * @returns 見つかったアイテム、見つからない場合はundefined
     */
    getItemById(instanceId: string): Item | undefined {
        return this.items.find(i => i.getInstanceId() === instanceId);
    }

    /**
     * インデックスでアイテムを取得
     * @param index 取得するアイテムのインデックス
     * @returns 見つかったアイテム、範囲外の場合はundefined
     */
    getItemByIndex(index: number): Item | undefined {
        if (index >= 0 && index < this.items.length) {
            return this.items[index];
        }
        return undefined;
    }

    /**
     * 全アイテムを取得
     * @returns アイテムの配列のコピー
     */
    getItems(): Item[] {
        return [...this.items];
    }

    /**
     * 種別でアイテムを取得
     * @param type 取得するアイテムの種別
     * @returns 指定種別のアイテム配列
     */
    getItemsByType(type: ItemType): Item[] {
        return this.items.filter(item => item.getType() === type);
    }

    /**
     * 装備可能なアイテムを取得
     * @returns 装備可能なアイテム配列
     */
    getEquippableItems(): Item[] {
        return this.items.filter(item => item.isEquippable());
    }

    /**
     * 消耗品を取得
     * @returns 消耗品配列
     */
    getConsumableItems(): Item[] {
        return this.items.filter(item => item.isConsumable());
    }

    /**
     * インベントリの使用量を取得
     * @returns 現在のアイテム数
     */
    getUsedCapacity(): number {
        return this.items.length;
    }

    /**
     * インベントリの最大容量を取得
     * @returns 最大容量
     */
    getCapacity(): number {
        return this.capacity;
    }

    /**
     * インベントリの最大容量を設定
     * @param capacity 新しい最大容量
     */
    setCapacity(capacity: number): void {
        this.capacity = Math.max(1, capacity);
        // 容量を超えたアイテムは削除しない（仕様により）
    }

    /**
     * 空きスロット数を取得
     * @returns 空きスロット数
     */
    getFreeSpace(): number {
        return this.capacity - this.items.length;
    }

    /**
     * インベントリが満杯かチェック
     * @returns 満杯の場合はtrue
     */
    isFull(): boolean {
        return this.items.length >= this.capacity;
    }

    /**
     * インベントリが空かチェック
     * @returns 空の場合はtrue
     */
    isEmpty(): boolean {
        return this.items.length === 0;
    }

    /**
     * 指定したアイテム定義名のアイテムを持っているかチェック
     * @param itemName アイテム定義名
     * @returns 持っている場合はtrue
     */
    hasItem(itemName: string): boolean {
        return this.items.some(item => item.getName() === itemName);
    }

    /**
     * 指定したアイテム定義名のアイテム数を取得
     * @param itemName アイテム定義名
     * @returns アイテム数
     */
    getItemCount(itemName: string): number {
        return this.items.filter(item => item.getName() === itemName).length;
    }

    /**
     * インベントリをクリア
     */
    clear(): void {
        this.items = [];
    }

    serialize(): Array<{ instanceId: string; name: string; quantity: number }> {
        return this.items.map(item => item.serialize());
    }

    /**
     * インベントリの状態をコンソールに出力（デバッグ用）
     */
    debug(): void {
        console.log(`Inventory (${this.getUsedCapacity()}/${this.capacity}):`);
        this.items.forEach((item, index) => {
            console.log(`  [${index}] ${item.toString()}`);
        });
    }
}