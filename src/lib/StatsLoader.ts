import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';

export interface StatDefinition {
    /**
     * ステータス正式名称
     */
    name: string;
    /**
     * ステータス略称
     */
    abbreviation: string;
    /**
     * ヒットポイントのように頻繁に変動する値かどうか
     */
    fluctuation?: boolean;
    /**
     * 説明文
     */
    description: string;
    /**
     * 初期値
     */
    initial?: number;
}

export class StatsLoader {
    private static instance: StatsLoader;
    private store = new YamlDefinitionStore<StatDefinition>();

    private constructor() {}

    static getInstance(): StatsLoader {
        if (!this.instance) {
            this.instance = new StatsLoader();
        }
        return this.instance;
    }

    async loadStats(): Promise<void> {
        const customText = CustomDataStore.get('stats');
        await this.store.load('/data/stats.yml', 'ゲーム', () => {}, { required: true, customText });
    }

    getStats(): StatDefinition[] {
        return this.store.getAll();
    }

    getStat(name: string): StatDefinition | undefined {
        return this.store.getByName(name);
    }

    getStatNames(): string[] {
        return this.store.getNames();
    }

    getAbbreviation(statName: string): string {
        const stat = this.getStat(statName);
        return stat ? stat.abbreviation : statName.toUpperCase();
    }

    getDescription(statName: string): string {
        const stat = this.getStat(statName);
        return stat ? stat.description : statName;
    }

    isFluctuationAllowed(statName: string): boolean {
        const stat = this.getStat(statName);
        return stat ? (stat.fluctuation || false) : false;
    }

    getInitialValue(statName: string): number {
        const stat = this.getStat(statName);
        return stat ? (stat.initial || 0) : 0;
    }
}
