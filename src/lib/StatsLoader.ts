import yaml from 'js-yaml';

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
    private stats: StatDefinition[] = [];
    private statsByName: Map<string, StatDefinition> = new Map();

    private constructor() {}

    static getInstance(): StatsLoader {
        if (!this.instance) {
            this.instance = new StatsLoader();
        }
        return this.instance;
    }

    async loadStats(): Promise<void> {
        try {
            const response = await fetch('/data/stats.yml');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            const yamlText = await response.text();
            if (!yamlText.trim()) {
                throw new Error('stats.yml is empty');
            }
            
            const parsed = yaml.load(yamlText) as StatDefinition[];
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('stats.yml does not contain valid stat definitions');
            }
            
            this.stats = parsed;
            this.statsByName.clear();
            
            for (const stat of this.stats) {
                this.statsByName.set(stat.name, stat);
            }
        } catch (error) {
            console.error('Failed to load stats.yml:', error);
            alert(`ゲームデータの読み込みに失敗しました。\n\n` +
                  `public/data/stats.yml ファイルが正しく配置されており、\n` +
                  `内容が正しい形式であることを確認してください。\n\n` +
                  `エラー詳細: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
    }

    getStats(): StatDefinition[] {
        return [...this.stats];
    }

    getStat(name: string): StatDefinition | undefined {
        return this.statsByName.get(name);
    }

    getStatNames(): string[] {
        return this.stats.map(stat => stat.name);
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