import type { EnemyDefinition } from './EnemyLoader';
import { MapObject, MapMark, newMapEvent } from './MapObject';

/**
 * ゲーム内の敵インスタンスを表すクラス
 * MapObjectを継承し、マップ上の配置可能なオブジェクトとして機能する
 */
export class Enemy extends MapObject {
    private definition: EnemyDefinition;
    private instanceId: string;
    private currentHp: number;
    private isDead: boolean = false;

    constructor(definition: EnemyDefinition, x: integer, y: integer, instanceId?: string) {
        super();
        this.definition = definition;
        this.instanceId = instanceId || this.generateInstanceId();
        this.currentHp = definition.hp;

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

    getMaxHp(): number {
        return this.definition.hp;
    }

    getPower(): number {
        return this.definition.power;
    }

    getDefense(): number {
        return this.definition.defense;
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

    // インスタンス固有の情報
    getInstanceId(): string {
        return this.instanceId;
    }

    getCurrentHp(): number {
        return this.currentHp;
    }

    setCurrentHp(hp: number): void {
        this.currentHp = Math.max(0, Math.min(hp, this.definition.hp));
        if (this.currentHp === 0) {
            this.isDead = true;
        }
    }

    addHp(amount: number): void {
        this.setCurrentHp(this.currentHp + amount);
    }

    damage(amount: number): number {
        const actualDamage = Math.max(1, amount);
        this.currentHp = Math.max(0, this.currentHp - actualDamage);
        if (this.currentHp === 0) {
            this.isDead = true;
        }
        return actualDamage;
    }

    heal(amount: number): void {
        this.setCurrentHp(this.currentHp + amount);
    }

    isAlive(): boolean {
        return !this.isDead && this.currentHp > 0;
    }

    kill(): void {
        this.currentHp = 0;
        this.isDead = true;
    }

    // 戦闘関連
    /**
     * この敵からプレイヤーへの攻撃ダメージを計算
     * @param playerDefense プレイヤーの防御力
     * @returns 計算されたダメージ
     */
    calculateDamageToPlayer(playerDefense: number): number {
        const baseDamage = this.getPower();
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
        const damage = Math.max(1, baseDamage - Math.floor(this.getDefense() / 2));
        return this.damage(damage);
    }

    // ユーティリティ
    clone(newInstanceId?: string): Enemy {
        const clone = new Enemy(this.definition, this.x, this.y, newInstanceId);
        clone.currentHp = this.currentHp;
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
        return `${this.getLabel()} (${this.getName()}) HP:${this.currentHp}/${this.getMaxHp()}`;
    }

    /**
     * 敵の状態を表す文字列を取得（詳細版）
     */
    toDetailString(): string {
        return `${this.getLabel()} (${this.getName()})\n` +
            `HP: ${this.currentHp}/${this.getMaxHp()}\n` +
            `攻撃力: ${this.getPower()}\n` +
            `防御力: ${this.getDefense()}\n` +
            `経験値: ${this.getExp()}`;
    }
}
