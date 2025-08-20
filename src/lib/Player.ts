
export class Player {
    private stats: Map<string, number>;

    constructor() {
        this.stats = new Map([
            ['HP', 100],
            ['MP', 50],
            ['POW', 10],
            ['EXP', 0],
        ]);
    }

    getStats(): Map<string, number> {
        return new Map(this.stats);
    }

    getStat(key: string): number {
        return this.stats.get(key) || 0;
    }

    setStat(key: string, value: number): void {
        this.stats.set(key, value);
    }

    addStat(key: string, value: number): void {
        const current = this.stats.get(key) || 0;
        this.stats.set(key, current + value);
    }
}
