
import { StatsLoader } from './StatsLoader';
import { Inventory } from './Inventory';
import { Item } from './Item';
import { ItemsLoader, type ImmediateEffect } from './ItemsLoader';
import { Enemy } from './Enemy';
import { EnemyLoader } from './EnemyLoader';

export class Player {
    private stats: Map<string, number>;
    private maxStats: Map<string, number>;
    private inventory: Inventory;
    private static statsLoader: StatsLoader;
    private static itemsLoader: ItemsLoader;
    private static enemyLoader: EnemyLoader;

    level: number = 1;
    exp: number = 0;

    // 装備スロット
    private equippedWeapon: Item | null = null;
    private equippedMainArmor: Item | null = null;
    private equippedSubArmor1: Item | null = null;
    private equippedSubArmor2: Item | null = null;

    constructor() {
        this.stats = new Map();
        this.maxStats = new Map();
        this.inventory = new Inventory(20);
        this.initializeStats();
    }

    static async initializeStatsSystem(): Promise<void> {
        this.statsLoader = StatsLoader.getInstance();
        await this.statsLoader.loadStats();
    }

    static async initializeItemsSystem(): Promise<void> {
        this.itemsLoader = ItemsLoader.getInstance();
        await this.itemsLoader.loadItems();
    }

    static async initializeEnemySystem(): Promise<void> {
        this.enemyLoader = EnemyLoader.getInstance();
        await this.enemyLoader.loadEnemies();
    }

    static async initializeAllSystems(): Promise<void> {
        await this.initializeStatsSystem();
        await this.initializeItemsSystem();
        await this.initializeEnemySystem();
    }

    private initializeStats(): void {
        // stats.ymlが読み込まれている前提で初期化
        if (Player.statsLoader) {
            const statNames = Player.statsLoader.getStatNames();
            for (const statName of statNames) {
                // 初期値を設定（後で設定可能にするかもしれない）
                const initialValue = this.getInitialValue(statName);
                this.stats.set(statName, initialValue);
                this.maxStats.set(statName, initialValue);
            }
        } else {
            // statsLoaderが初期化されていない場合は警告
            console.warn('StatsLoader not initialized. Call Player.initializeStatsSystem() first.');
            throw new Error('StatsLoader not initialized. Game cannot start without stats configuration.');
        }
    }

    private getInitialValue(statName: string): number {
        // stats.ymlから初期値を取得
        if (Player.statsLoader) {
            return Player.statsLoader.getInitialValue(statName);
        }
        
        // statsLoaderが利用できない場合はエラー
        throw new Error(`Cannot get initial value for ${statName}: StatsLoader not available`);
    }

    getStats(): Map<string, number> {
        return new Map(this.stats);
    }

    getStat(key: string): number {
        return this.stats.get(key) || 0;
    }

    getMaxStat(key: string): number {
        return this.maxStats.get(key) || 0;
    }

    setStat(key: string, value: number): void {
        this.stats.set(key, value);
    }

    setMaxStat(key: string, value: number): void {
        this.maxStats.set(key, value);
        // 現在値が最大値を超えている場合は調整
        const currentValue = this.getStat(key);
        if (currentValue > value) {
            this.setStat(key, value);
        }
    }

    addStat(key: string, value: number): void {
        const current = this.stats.get(key) || 0;
        const newValue = current + value;

        // fluctuation許可の能力値は最大値でクランプ
        if (Player.statsLoader?.isFluctuationAllowed(key)) {
            const maxValue = this.getMaxStat(key);
            this.stats.set(key, Math.min(newValue, maxValue));
        } else {
            this.stats.set(key, newValue);
        }
    }

    /**
     * 即座効果を能力値へ反映する
     * @param effect 即座効果
     * @returns 能力値名 → 実際に変動した量（クランプ後の差分）
     */
    applyImmediateEffect(effect: ImmediateEffect): Map<string, number> {
        const applied = new Map<string, number>();
        for (const [statName, value] of Object.entries(effect)) {
            const before = this.getStat(statName);
            this.addStat(statName, value);
            applied.set(statName, this.getStat(statName) - before);
        }
        return applied;
    }

    getInventory(): Inventory {
        return this.inventory;
    }

    getInventoryCapacity(): number {
        return this.inventory.getCapacity();
    }

    setInventoryCapacity(capacity: number): void {
        this.inventory.setCapacity(capacity);
    }

    addInventoryCapacity(amount: number): void {
        const currentCapacity = this.inventory.getCapacity();
        this.inventory.setCapacity(currentCapacity + amount);
    }

    // 装備関連メソッド
    getEquippedWeapon(): Item | null {
        return this.equippedWeapon;
    }

    getEquippedMainArmor(): Item | null {
        return this.equippedMainArmor;
    }

    getEquippedSubArmor1(): Item | null {
        return this.equippedSubArmor1;
    }

    getEquippedSubArmor2(): Item | null {
        return this.equippedSubArmor2;
    }

    getAllEquippedItems(): (Item | null)[] {
        return [this.equippedWeapon, this.equippedMainArmor, this.equippedSubArmor1, this.equippedSubArmor2];
    }

    equipWeapon(item: Item | null): Item | null {
        const previousItem = this.equippedWeapon;
        this.equippedWeapon = item;
        return previousItem;
    }

    equipMainArmor(item: Item | null): Item | null {
        const previousItem = this.equippedMainArmor;
        this.equippedMainArmor = item;
        return previousItem;
    }

    equipSubArmor1(item: Item | null): Item | null {
        const previousItem = this.equippedSubArmor1;
        this.equippedSubArmor1 = item;
        return previousItem;
    }

    equipSubArmor2(item: Item | null): Item | null {
        const previousItem = this.equippedSubArmor2;
        this.equippedSubArmor2 = item;
        return previousItem;
    }

    /**
     * アイテムを装備（自動的に適切なスロットに装備）
     * @param item 装備するアイテム
     * @returns 装備に成功した場合は交換されたアイテム、失敗した場合はnull
     */
    equipItem(item: Item): Item | null {
        if (item.isWeapon()) {
            return this.equipWeapon(item);
        } else if (item.isMainArmor()) {
            return this.equipMainArmor(item);
        } else if (item.isSubArmor()) {
            // 空いているサブ防具スロットに装備
            if (!this.equippedSubArmor1) {
                return this.equipSubArmor1(item);
            } else if (!this.equippedSubArmor2) {
                return this.equipSubArmor2(item);
            } else {
                // 両方埋まっている場合は1番目を交換
                return this.equipSubArmor1(item);
            }
        }
        return null;
    }

    /**
     * 装備を外す
     * @param slotType スロットタイプ
     * @returns 外されたアイテム
     */
    unequipItem(slotType: 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2'): Item | null {
        switch (slotType) {
            case 'weapon':
                return this.equipWeapon(null);
            case 'main_armor':
                return this.equipMainArmor(null);
            case 'sub_armor1':
                return this.equipSubArmor1(null);
            case 'sub_armor2':
                return this.equipSubArmor2(null);
            default:
                return null;
        }
    }

    /**
     * 装備による能力値ボーナスを計算
     * @returns 装備ボーナスのマップ
     */
    getEquipmentBonuses(): Map<string, number> {
        const bonuses = new Map<string, number>();
        
        const equippedItems = this.getAllEquippedItems().filter(item => item !== null) as Item[];
        
        for (const item of equippedItems) {
            const effects = item.getEquipmentEffects();
            for (const [statName, value] of Object.entries(effects)) {
                const currentBonus = bonuses.get(statName) || 0;
                bonuses.set(statName, currentBonus + value);
            }
        }
        
        return bonuses;
    }

    expToNextLevel(): number {
        return this.level * 50;
    }

    addExp(amount: number): number {
        this.exp += amount;
        let levelsGained = 0;
        while (this.exp >= this.expToNextLevel()) {
            this.exp -= this.expToNextLevel();
            this.levelUp();
            levelsGained++;
        }
        return levelsGained;
    }

    levelUp(): void {
        this.level++;
        const newMaxLife = this.getMaxStat('life') + 10;
        this.maxStats.set('life', newMaxLife);
        this.stats.set('life', newMaxLife);
        this.addStat('power', 2);
        this.addStat('defense', 1);
    }

    // 表示用の能力値を取得（略称付き、装備ボーナス込み）
    getDisplayStats(): Map<string, { value: number; abbreviation: string; description: string }> {
        const displayStats = new Map();
        const equipmentBonuses = this.getEquipmentBonuses();
        
        for (const [key, baseValue] of this.stats) {
            const bonus = equipmentBonuses.get(key) || 0;
            const totalValue = baseValue + bonus;
            const abbreviation = Player.statsLoader?.getAbbreviation(key) || key.toUpperCase();
            const description = Player.statsLoader?.getDescription(key) || key;
            displayStats.set(key, { value: totalValue, abbreviation, description });
        }
        
        return displayStats;
    }

    // アイテム作成ヘルパー
    static createItem(itemName: string): Item | null {
        if (!this.itemsLoader) {
            console.error('ItemsLoader not initialized');
            return null;
        }

        const definition = this.itemsLoader.getItem(itemName);
        if (!definition) {
            console.error(`Item definition not found: ${itemName}`);
            return null;
        }

        return new Item(definition);
    }

    // 敵作成ヘルパー
    static createEnemy(enemyName: string, x: integer, y: integer): Enemy | null {
        if (!this.enemyLoader) {
            console.error('EnemyLoader not initialized');
            return null;
        }

        const definition = this.enemyLoader.getEnemy(enemyName);
        if (!definition) {
            console.error(`Enemy definition not found: ${enemyName}`);
            return null;
        }

        return new Enemy(definition, x, y);
    }

    // フロアに応じたランダムな敵を作成
    static createRandomEnemy(floor: number, x: integer, y: integer): Enemy | null {
        if (!this.enemyLoader) {
            console.error('EnemyLoader not initialized');
            return null;
        }

        const definition = this.enemyLoader.getRandomEnemy(floor);
        if (!definition) {
            console.error(`No enemy available for floor ${floor}`);
            return null;
        }

        return new Enemy(definition, x, y);
    }
}
