import type { EnemyDefinition } from './EnemyLoader';
import { MapObject, MapMark } from './MapObject';
import { StatsLoader } from './StatsLoader';
import { EffectsLoader } from './EffectsLoader';
import { BaseLoader } from './BaseLoader';
import { EventBus } from '../game/EventBus';
import type { DungeonMap } from './MapGenerator';
import { getDirectionOffset, MapDirection } from './map/MapDirection';
import { getRandomInt } from './util/random';

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
    private target: { x: integer; y: integer } | null = null;

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

    }

    /**
     * 敵の自律行動を実行する。walk フィールドに応じて移動パターンを切り替える。
     * 'none': 移動せず、攻撃可能なら攻撃のみ
     * 'random': ランダムウォーク（レガシー動作）
     * 'default'（未指定含む）: 扉を目標に巡回し、視線（壁・扉で遮られない）が通るプレイヤーを追跡する
     */
    public act(dungeon: DungeonMap): void {
        if (!this.isAlive()) return;

        const walkMode = this.definition.walk ?? 'default';
        const { x: px, y: py } = dungeon.getPlayerPos();

        if (dungeon.canAttack(this.x, this.y, px, py)) {
            this.target = { x: px, y: py };
            this.attackPlayer(dungeon);
            return;
        }

        if (walkMode === 'none') return;

        if (walkMode === 'random') {
            const dir = getRandomInt(-1, 4);
            if (dir === -1) return;
            dungeon.tryMoveEnemy(this, dir as MapDirection);
            return;
        }

        // default: パターン移動
        if (this.target !== null && this.x === this.target.x && this.y === this.target.y) {
            // すでに目標地点にいるなら、新たな目標を探す
            this.target = null;
        }

        if (dungeon.hasLineOfSight(this.x, this.y, px, py)) {
            this.target = { x: px, y: py };
        } else if (this.target !== null && dungeon.hasLineOfSight(this.x, this.y, this.target.x, this.target.y)) {
            // 目標地点が部屋内で、プレイヤーが部屋内にいない場合
            const outsides = [];
            const val = dungeon.getAt(this.target.x, this.target.y);
            for (let d = 0; d < 4; d++) {
                if (val & (16 << d)) {
                    // その方向がドアならば候補に追加
                    const [dx, dy] = getDirectionOffset(d as MapDirection);
                    outsides.push([this.target.x + dx, this.target.y + dy]);
                }
            }
            if (outsides.length > 0) {
                // 目標地点の隣の部屋の外を、新たな目標地点にする
                const newTarget = outsides[getRandomInt(0, outsides.length)];
                this.target = { x: newTarget[0], y: newTarget[1] };
            }
        }

        if (this.target === null) {
            const doorTargets = dungeon.getDoorTargetsInZone(this.x, this.y);
            if (doorTargets.length > 0) {
                const [tx, ty] = doorTargets[getRandomInt(0, doorTargets.length)];
                this.target = { x: tx, y: ty };
            }
        }

        if (this.target === null) {
            const dir = getRandomInt(-1, 4);
            if (dir !== -1) dungeon.tryMoveEnemy(this, dir as MapDirection);
            return;
        }

        let path: MapDirection[] | undefined = [];
        const blocked: [number, number][] = [];
        do {
            // 経路がブロックされていたなら、別の経路を探す
            if (path && path.length > 0) {
                const [dx, dy] = getDirectionOffset(path[0]);
                blocked.push([this.x + dx, this.y + dy]);
            }
            
            path = dungeon.findPath(this.x, this.y, this.target.x, this.target.y, { blockedPositions: blocked });
            if (path === undefined || path.length === 0) {
                this.target = null;
                const dir = getRandomInt(-1, 4);
                if (dir !== -1) dungeon.tryMoveEnemy(this, dir as MapDirection);
                return;
            }
        } while (!dungeon.tryMoveEnemy(this, path[0]));

        // 目標地点に到達したなら、それを解除する
        if (this.x === this.target.x && this.y === this.target.y) {
            this.target = null;
        }
    }

    /**
     * プレイヤーへの攻撃を実行する。ダメージ計算・状態異常付与・game-over 判定を行う
     */
    private attackPlayer(dungeon: DungeonMap): void {
        const player = dungeon.getPlayerInstance();
        if (!player) return;

        const statsLoader = StatsLoader.getInstance();
        const baseLoader = BaseLoader.getInstance();
        const playerVars = player.getEffectiveFormulaVars();
        const damage = this.calculateDamageToPlayer(playerVars);
        const targetStat = baseLoader.getDefaultDamageStat();
        player.addStat(targetStat, -damage);
        EventBus.emit('attack-flash', 0xFF2222);
        EventBus.emit('message-log', `${this.getLabel()}の攻撃！ ${damage}のダメージ！ (残り${statsLoader.getAbbreviation(targetStat)}: ${player.getStat(targetStat)}/${player.getMaxStat(targetStat)})`, dungeon.getTurnCount());
        const cleared = player.notifyDamageTaken();
        for (const c of cleared) {
            EventBus.emit('message-log', `${c.label}が解けた`, dungeon.getTurnCount());
        }

        const abilities = this.definition.ability;
        if (abilities && !baseLoader.isDead(player.getFormulaVars())) {
            for (const ab of abilities) {
                if (ab.effectAttack) {
                    const { name, rate } = ab.effectAttack;
                    if (Math.random() < rate && player.applyStatusEffect(name)) {
                        const effDef = EffectsLoader.getInstance().getEffect(name);
                        const effLabel = effDef?.label ?? name;
                        EventBus.emit('message-log', `${this.getLabel()}の攻撃で${effLabel}状態になった！`, dungeon.getTurnCount());
                    }
                }
            }
        }

        if (baseLoader.isDead(player.getFormulaVars())) {
            EventBus.emit('game-over');
        }
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

    getEnemyFormulaVars(): Record<string, number> {
        const vars: Record<string, number> = {};
        for (const [key, value] of this.stats) {
            vars[key] = value;
        }
        return vars;
    }

    setStat(key: string, value: number): void {
        const maxValue = this.maxStats.get(key);
        if (maxValue !== undefined) {
            this.stats.set(key, Math.max(0, Math.min(value, maxValue)));
        } else {
            this.stats.set(key, value);
        }
        if (!this.isDead && BaseLoader.getInstance().isEnemyDead(this.getEnemyFormulaVars())) {
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
        this.addStat(BaseLoader.getInstance().getDefaultEnemyDamageStat(), -actualDamage);
        return actualDamage;
    }

    heal(amount: number): void {
        this.addStat(BaseLoader.getInstance().getDefaultEnemyDamageStat(), amount);
    }

    isAlive(): boolean {
        return !this.isDead;
    }

    kill(): void {
        this.setStat(BaseLoader.getInstance().getDefaultEnemyDamageStat(), 0);
        this.isDead = true;
    }

    // 戦闘関連
    /**
     * この敵からプレイヤーへの攻撃ダメージを計算
     * @param playerDefense プレイヤーの防御力
     * @returns 計算されたダメージ
     */
    calculateDamageToPlayer(playerVars: Record<string, number>): number {
        return BaseLoader.getInstance().calculateDamageToPlayer(this.getEnemyFormulaVars(), playerVars);
    }

    /**
     * プレイヤーからこの敵へのダメージを計算して適用
     * @param playerVars プレイヤーの実効ステータス一式
     * @returns 実際に与えたダメージ
     */
    takeDamageFromPlayer(playerVars: Record<string, number>): number {
        const damage = BaseLoader.getInstance().calculateDamageFromPlayer(playerVars, this.getEnemyFormulaVars());
        return this.damage(damage);
    }

    // ユーティリティ
    clone(newInstanceId?: string): Enemy {
        const clone = new Enemy(this.definition, this.x, this.y, newInstanceId);
        for (const [key, value] of this.stats) {
            clone.stats.set(key, value);
        }
        clone.isDead = this.isDead;
        clone.target = this.target ? { ...this.target } : null;
        return clone;
    }

    equals(other: Enemy): boolean {
        return this.instanceId === other.instanceId;
    }

    hasSameDefinition(other: Enemy): boolean {
        return this.definition.name === other.definition.name;
    }

    toString(): string {
        const target = BaseLoader.getInstance().getDefaultEnemyDamageStat()
        const desc = StatsLoader.getInstance().getDescription(target);
        return `${this.getLabel()} (${this.getName()}) ${desc}:${this.getStat(target)}/${this.getMaxStat(target)}`;
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

    serialize(): {
        instanceId: string; name: string; x: number; y: number;
        stats: Record<string, number>; maxStats: Record<string, number>;
        isDead: boolean; target: { x: number; y: number } | null;
    } {
        return {
            instanceId: this.instanceId,
            name: this.definition.name,
            x: this.x,
            y: this.y,
            stats: Object.fromEntries(this.stats),
            maxStats: Object.fromEntries(this.maxStats),
            isDead: this.isDead,
            target: this.target ? { ...this.target } : null,
        };
    }

    restoreAfterLoad(
        stats: Record<string, number>,
        maxStats: Record<string, number>,
        isDead: boolean,
        target: { x: number; y: number } | null,
    ): void {
        this.stats = new Map(Object.entries(stats));
        this.maxStats = new Map(Object.entries(maxStats));
        this.isDead = isDead;
        this.target = target;
    }
}
