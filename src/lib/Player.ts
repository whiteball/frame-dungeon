
import { StatsLoader } from './StatsLoader';

export class Player {
    private stats: Map<string, number>;
    private maxStats: Map<string, number>;
    private inventoryCapacity: number = 20;
    private static statsLoader: StatsLoader;

    constructor() {
        this.stats = new Map();
        this.maxStats = new Map();
        this.initializeStats();
    }

    static async initializeStatsSystem(): Promise<void> {
        this.statsLoader = StatsLoader.getInstance();
        await this.statsLoader.loadStats();
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

    getInventoryCapacity(): number {
        return this.inventoryCapacity;
    }

    setInventoryCapacity(capacity: number): void {
        this.inventoryCapacity = Math.max(1, capacity);
    }

    addInventoryCapacity(amount: number): void {
        this.inventoryCapacity = Math.max(1, this.inventoryCapacity + amount);
    }

    // 表示用の能力値を取得（略称付き）
    getDisplayStats(): Map<string, { value: number; abbreviation: string; description: string }> {
        const displayStats = new Map();
        
        for (const [key, value] of this.stats) {
            const abbreviation = Player.statsLoader?.getAbbreviation(key) || key.toUpperCase();
            const description = Player.statsLoader?.getDescription(key) || key;
            displayStats.set(key, { value, abbreviation, description });
        }
        
        return displayStats;
    }
}
