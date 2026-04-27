
import { StatsLoader } from './StatsLoader';
import { Inventory } from './Inventory';
import { Item } from './Item';
import { ItemsLoader, type ImmediateEffect, type ContinuousEffect } from './ItemsLoader';
import { Enemy } from './Enemy';
import { EnemyLoader } from './EnemyLoader';

interface ActiveContinuousEffect {
    effects: Map<string, number>;
    remainingTurns: number;
    sourceLabel: string;
}

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

    // 持続効果スロット（同じアイテムを複数使用しても各エントリ独立に管理）
    private activeContinuousEffects: ActiveContinuousEffect[] = [];

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

    /**
     * 持続効果を有効化する
     * 既存の同種効果と合算せず、エントリとして独立に保持する
     * @param effect 持続効果（turns と能力値変動）
     * @param sourceLabel 効果の発生源（アイテム名など。ログとUI表示に使用）
     * @returns 能力値名 → 加算量
     */
    applyContinuousEffect(effect: ContinuousEffect, sourceLabel: string): Map<string, number> {
        const effects = new Map<string, number>();
        for (const [statName, value] of Object.entries(effect)) {
            if (statName === 'turns') continue;
            if (typeof value !== 'number') continue;
            effects.set(statName, value);
        }
        if (effects.size === 0 || effect.turns <= 0) return effects;

        this.activeContinuousEffects.push({
            effects,
            remainingTurns: effect.turns,
            sourceLabel,
        });
        return effects;
    }

    /**
     * 持続効果を1ターン経過させる。残ターン数が0以下になったエントリは自動削除。
     * @returns 期限切れになったエントリの { sourceLabel, effects } 配列
     */
    tickContinuousEffects(): Array<{ sourceLabel: string; effects: Map<string, number> }> {
        const expired: Array<{ sourceLabel: string; effects: Map<string, number> }> = [];
        const remaining: ActiveContinuousEffect[] = [];
        for (const entry of this.activeContinuousEffects) {
            entry.remainingTurns--;
            if (entry.remainingTurns <= 0) {
                expired.push({ sourceLabel: entry.sourceLabel, effects: entry.effects });
            } else {
                remaining.push(entry);
            }
        }
        this.activeContinuousEffects = remaining;
        return expired;
    }

    /**
     * 全アクティブ持続効果のボーナス合計（能力値名 → 合計変動量）
     */
    getContinuousBonuses(): Map<string, number> {
        const bonuses = new Map<string, number>();
        for (const entry of this.activeContinuousEffects) {
            for (const [stat, value] of entry.effects) {
                bonuses.set(stat, (bonuses.get(stat) ?? 0) + value);
            }
        }
        return bonuses;
    }

    /**
     * 基本能力値 + 装備ボーナス + 持続効果ボーナスの合算
     */
    getEffectiveStat(key: string): number {
        return this.getStat(key)
            + (this.getEquipmentBonuses().get(key) ?? 0)
            + (this.getContinuousBonuses().get(key) ?? 0);
    }

    /**
     * アクティブな持続効果のスナップショットを取得（UI表示用）
     */
    getActiveContinuousEffects(): ActiveContinuousEffect[] {
        return this.activeContinuousEffects.map(e => ({
            effects: new Map(e.effects),
            remainingTurns: e.remainingTurns,
            sourceLabel: e.sourceLabel,
        }));
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

    /**
     * 指定アイテムが装備されているスロットを返す（instanceId 一致で判定）
     * @returns 装備されている場合はスロット名、未装備なら null
     */
    getEquippedSlotOf(item: Item): 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2' | null {
        const id = item.getInstanceId();
        if (this.equippedWeapon?.getInstanceId() === id) return 'weapon';
        if (this.equippedMainArmor?.getInstanceId() === id) return 'main_armor';
        if (this.equippedSubArmor1?.getInstanceId() === id) return 'sub_armor1';
        if (this.equippedSubArmor2?.getInstanceId() === id) return 'sub_armor2';
        return null;
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

    // 表示用の能力値を取得（略称付き、装備ボーナス・持続効果ボーナス込み）
    getDisplayStats(): Map<string, {
        value: number;
        abbreviation: string;
        description: string;
        currentValue: number;
        bonus: number;
        maxValue: number | null;
        hasFluctuation: boolean;
    }> {
        const displayStats = new Map();
        const equipmentBonuses = this.getEquipmentBonuses();
        const continuousBonuses = this.getContinuousBonuses();

        for (const [key, baseValue] of this.stats) {
            const equipBonus = equipmentBonuses.get(key) || 0;
            const continuousBonus = continuousBonuses.get(key) || 0;
            const bonus = equipBonus + continuousBonus;
            const totalValue = baseValue + bonus;
            const abbreviation = Player.statsLoader?.getAbbreviation(key) || key.toUpperCase();
            const description = Player.statsLoader?.getDescription(key) || key;
            const hasFluctuation = Player.statsLoader?.isFluctuationAllowed(key) ?? false;
            const maxValue = hasFluctuation ? (this.maxStats.get(key) ?? null) : null;
            displayStats.set(key, { value: totalValue, abbreviation, description, currentValue: baseValue, bonus, maxValue, hasFluctuation });
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
