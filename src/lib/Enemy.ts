import type { EnemyDefinition } from './EnemyLoader';
import { MapObject, MapMark, newMapEvent } from './MapObject';
import { StatsLoader } from './StatsLoader';

/**
 * ゲーム内の敵インスタンスを表すクラス
 * MapObjectを継承し、マップ上の配置可能なオブジェクトとして機能する
 */
export class Enemy extends MapObject {
    private definition: EnemyDefinition;
    private instanceId: string;
    private stats: Map<string, number>;
    private maxStats: Map<string, number>;
    private isDead: boolean = false;

    constructor(definition: EnemyDefinition, x: integer, y: integer, instanceId?: string) {
        super();
        this.definition = definition;
        this.instanceId = instanceId || this.generateInstanceId();

        // stats.ymlで定義されたステータスをMapに格納
        this.stats = new Map();
        this.maxStats = new Map();
        const statsLoader = StatsLoader.getInstance();
        for (const statName of statsLoader.getStatNames()) {
            const value = definition[statName];
            const numValue = typeof value === 'number' ? value : 0;
            this.stats.set(statName, numValue);
            this.maxStats.set(statName, numValue);
        }

        // MapObjectのプロパティを設定
        this.x = x;
        this.y = y;
        this.mark = MapMark.DIAMOND;
        this.color = definition.color || 0xFF0000;
        this.alpha = 1;
        this.sphere = true;
        this.visible = true;

        // デフォルトのイベント設定
        this.events = newMapEvent('around-0', () => {
            // プレイヤーが敵のマスに入った時の処理
            // 戦闘システムが実装されるまでは何もしない
            console.log(`Encountered enemy: ${this.getLabel()}`);
            return true; // trueを返すと敵は削除されない
        });
    }

    private generateInstanceId(): string {
        return `enemy_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    }

    // 敵定義からの情報取得
    getName(): string {
        return this.definition.name;
    }

    getLabel(): string {
        return this.definition.label;
    }

    getDescription(): string {
        return this.definition.description;
    }

    getExp(): number {
        return this.definition.exp;
    }

    getColor(): number {
        return this.definition.color || 0xFF0000;
    }

    getDefinition(): EnemyDefinition {
        return this.definition;
    }

    // ステータス操作
    getStat(key: string): number {
        return this.stats.get(key) || 0;
    }

    getMaxStat(key: string): number {
        return this.maxStats.get(key) || 0;
    }

    setStat(key: string, value: number): void {
        const maxValue = this.maxStats.get(key);
        if (maxValue !== undefined) {
            this.stats.set(key, Math.max(0, Math.min(value, maxValue)));
        } else {
            this.stats.set(key, value);
        }
        // lifeが0になったら死亡
        if (key === 'life' && this.getStat('life') === 0) {
            this.isDead = true;
        }
    }

    addStat(key: string, value: number): void {
        this.setStat(key, this.getStat(key) + value);
    }

    getStats(): Map<string, number> {
        return new Map(this.stats);
    }

    getMaxStats(): Map<string, number> {
        return new Map(this.maxStats);
    }

    // インスタンス固有の情報
    getInstanceId(): string {
        return this.instanceId;
    }

    damage(amount: number): number {
        const actualDamage = Math.max(1, amount);
        this.addStat('life', -actualDamage);
        return actualDamage;
    }

    heal(amount: number): void {
        this.addStat('life', amount);
    }

    isAlive(): boolean {
        return !this.isDead && this.getStat('life') > 0;
    }

    kill(): void {
        this.setStat('life', 0);
        this.isDead = true;
    }

    // 戦闘関連
    /**
     * この敵からプレイヤーへの攻撃ダメージを計算
     * @param playerDefense プレイヤーの防御力
     * @returns 計算されたダメージ
     */
    calculateDamageToPlayer(playerDefense: number): number {
        const baseDamage = this.getStat('power');
        const damage = Math.max(1, baseDamage - Math.floor(playerDefense / 2));
        return damage;
    }

    /**
     * プレイヤーからこの敵へのダメージを計算して適用
     * @param playerPower プレイヤーの攻撃力
     * @returns 実際に与えたダメージ
     */
    takeDamageFromPlayer(playerPower: number): number {
        const baseDamage = playerPower;
        const damage = Math.max(1, baseDamage - Math.floor(this.getStat('defense') / 2));
        return this.damage(damage);
    }

    // ユーティリティ
    clone(newInstanceId?: string): Enemy {
        const clone = new Enemy(this.definition, this.x, this.y, newInstanceId);
        for (const [key, value] of this.stats) {
            clone.stats.set(key, value);
        }
        clone.isDead = this.isDead;
        return clone;
    }

    equals(other: Enemy): boolean {
        return this.instanceId === other.instanceId;
    }

    hasSameDefinition(other: Enemy): boolean {
        return this.definition.name === other.definition.name;
    }

    toString(): string {
        const lifeDesc = StatsLoader.getInstance().getDescription('life');
        return `${this.getLabel()} (${this.getName()}) ${lifeDesc}:${this.getStat('life')}/${this.getMaxStat('life')}`;
    }

    /**
     * 敵の状態を表す文字列を取得（詳細版）
     */
    toDetailString(): string {
        const statsLoader = StatsLoader.getInstance();
        let result = `${this.getLabel()} (${this.getName()})\n`;
        for (const [key, value] of this.stats) {
            const description = statsLoader.getDescription(key);
            result += `${description}: ${value}/${this.getMaxStat(key)}\n`;
        }
        result += `経験値: ${this.getExp()}`;
        return result;
    }
}
