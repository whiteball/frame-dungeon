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
     * InfoView への表示順（0以上の整数）。未指定のステータスは InfoView に表示しない
     */
    order?: number;
    /**
     * この値と現在値（base）が一致するとき InfoView に表示しない
     */
    default?: number;
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
        await this.store.load(`${import.meta.env.BASE_URL}data/stats.yml`, 'ゲーム', () => {}, { required: true, customText });
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

    getDisplayOrderedStats(): StatDefinition[] {
        return this.store.getAll()
            .filter(s => s.order !== undefined)
            .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    }
}
