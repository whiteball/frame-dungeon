import type { EnemyDefinition } from './EnemyLoader';
import { MapObject, MapMark } from './MapObject';
import { StatsLoader } from './StatsLoader';
import { EffectsLoader, type CompiledTargetSpec } from './EffectsLoader';
import { BaseLoader } from './BaseLoader';
import { EventBus } from '../game/EventBus';
import type { DungeonMap } from './MapGenerator';
import { getDirectionOffset, MapDirection } from './map/MapDirection';
import { getRandomInt } from './util/random';
import type { ActiveStatusEffect, ApplyStatusEffectResult, StatusEffectTickResult } from './Player';
import type { StatusEffectSaveData } from './SaveManager';
import { executeEnemyOnAttackSkill } from './skills/EnemySkillExecutor';

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
    // 状態異常/強化効果スロット（Player と同形式、同名効果は 1 エントリ）
    private activeStatusEffects: ActiveStatusEffect[] = [];

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

        if (this.getActionDirective() === 'skip') {
            EventBus.emit('message-log', `${this.getLabel()}は動けない！`, dungeon.getTurnCount());
            return;
        }

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

        const skillDefs = this.definition.skills ?? [];
        if (skillDefs.length > 0 && !baseLoader.isDead(player.getFormulaVars())) {
            for (const skillEntry of skillDefs) {
                if (Math.random() < skillEntry.rate) {
                    executeEnemyOnAttackSkill(dungeon, this, skillEntry.name);
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

    /**
     * 装備や持続効果がない代わりに、definition.resist と付与中 status effect 自身の
     * resist を集約した「現在新規付与を阻止する effect 名」集合を返す
     */
    getEffectiveResists(): Set<string> {
        const resists = new Set<string>();
        for (const r of this.definition.resist ?? []) resists.add(r);
        const effectsLoader = EffectsLoader.getInstance();
        for (const entry of this.activeStatusEffects) {
            for (const r of effectsLoader.getResistsOf(entry.name)) resists.add(r);
        }
        return resists;
    }

    /**
     * この敵が指定 effect への耐性を持つかを返す
     */
    hasResist(effectName: string): boolean {
        return this.getEffectiveResists().has(effectName);
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

    /**
     * base stat に付与中 status effect の permanent spec を順次適用した実効値を返す
     */
    getEffectiveStat(key: string): number {
        let value = this.getStat(key);
        const effectsLoader = EffectsLoader.getInstance();
        for (const entry of this.activeStatusEffects) {
            const compiled = effectsLoader.getCompiledEffect(entry.name);
            if (!compiled) continue;
            for (const spec of compiled.permanent) {
                if (spec.target !== key) continue;
                value = Enemy.evaluateTargetSpec(spec, value, entry.count) ?? value;
            }
        }
        return value;
    }

    /**
     * stats.yml の全ステータスについて実効値を集約した formula 変数辞書
     */
    getEffectiveFormulaVars(): Record<string, number> {
        const vars: Record<string, number> = {};
        for (const key of this.stats.keys()) {
            vars[key] = this.getEffectiveStat(key);
        }
        return vars;
    }

    private static evaluateTargetSpec(spec: CompiledTargetSpec, currentValue: number, count: number): number | null {
        if (spec.formula) {
            try {
                const result = spec.formula.evaluate({ x: currentValue, count });
                return typeof result === 'number' && Number.isFinite(result) ? result : null;
            } catch (e) {
                console.warn(`Failed to evaluate formula for target "${spec.target}":`, e);
                return null;
            }
        }
        if (typeof spec.value === 'number') return spec.value;
        return null;
    }

    private static literalValueOf(spec: CompiledTargetSpec): string | number | null {
        return spec.value ?? null;
    }

    /**
     * 状態異常/強化効果を付与する
     * 同名効果が既にあれば count を 0 にリセット（重複は 1 エントリのみ）
     */
    applyStatusEffect(name: string): ApplyStatusEffectResult {
        const effectsLoader = EffectsLoader.getInstance();
        if (!effectsLoader.hasEffect(name)) {
            console.warn(`Status effect not found: ${name}`);
            return 'unknown';
        }
        if (this.getEffectiveResists().has(name)) {
            return 'resisted';
        }
        const existing = this.activeStatusEffects.find(e => e.name === name);
        if (existing) {
            existing.count = 0;
        } else {
            this.activeStatusEffects.push({ name, count: 0 });
        }
        return 'applied';
    }

    /**
     * 指定 name の状態異常を解除する
     */
    clearStatusEffect(name: string): boolean {
        const idx = this.activeStatusEffects.findIndex(e => e.name === name);
        if (idx < 0) return false;
        this.activeStatusEffects.splice(idx, 1);
        return true;
    }

    /**
     * onAction の効果を走査し、行動を上書きするディレクティブを返す
     * 現状は _action: skip のみサポート
     */
    getActionDirective(): 'skip' | null {
        const effectsLoader = EffectsLoader.getInstance();
        for (const entry of this.activeStatusEffects) {
            const compiled = effectsLoader.getCompiledEffect(entry.name);
            if (!compiled) continue;
            for (const spec of compiled.onAction) {
                if (spec.target === '_action') {
                    const v = Enemy.literalValueOf(spec);
                    if (v === 'skip') return 'skip';
                }
            }
        }
        return null;
    }

    /**
     * ターン終了時の状態効果処理（Player.tickStatusEffects と同形式）
     */
    tickStatusEffects(): StatusEffectTickResult {
        const result: StatusEffectTickResult = { applied: [], cleared: [] };
        const effectsLoader = EffectsLoader.getInstance();
        const statsLoader = StatsLoader.getInstance();

        // 1. onTurnEnd 効果を適用
        for (const entry of this.activeStatusEffects) {
            const compiled = effectsLoader.getCompiledEffect(entry.name);
            if (!compiled) continue;
            for (const spec of compiled.onTurnEnd) {
                if (spec.target.startsWith('_')) continue;
                const before = this.getStat(spec.target);
                const evaluated = Enemy.evaluateTargetSpec(spec, before, entry.count);
                if (evaluated === null) continue;
                let next = Math.floor(evaluated);
                if (statsLoader.isFluctuationAllowed(spec.target)) {
                    next = Math.max(0, Math.min(next, this.getMaxStat(spec.target)));
                } else {
                    next = Math.max(0, next);
                }
                if (next !== before) {
                    this.setStat(spec.target, next);
                    result.applied.push({
                        label: compiled.definition.label,
                        statName: spec.target,
                        delta: next - before,
                    });
                }
            }
        }

        // 2. count++ → clear 判定
        const remaining: ActiveStatusEffect[] = [];
        for (const entry of this.activeStatusEffects) {
            entry.count++;
            const compiled = effectsLoader.getCompiledEffect(entry.name);
            let cleared = false;
            if (compiled?.clearFormula) {
                try {
                    const p = compiled.clearFormula.evaluate({ count: entry.count });
                    const probability = typeof p === 'number' && Number.isFinite(p)
                        ? Math.max(0, Math.min(1, p))
                        : 0;
                    if (Math.random() < probability) {
                        cleared = true;
                    }
                } catch (e) {
                    console.warn(`Failed to evaluate clear formula for "${entry.name}":`, e);
                }
            }
            if (cleared && compiled) {
                result.cleared.push({ label: compiled.definition.label });
            } else {
                remaining.push(entry);
            }
        }
        this.activeStatusEffects = remaining;
        return result;
    }

    /**
     * ダメージ被弾時の通知。clear.onDamage が true のエントリを即座に解除する
     */
    notifyDamageTaken(): Array<{ label: string }> {
        const cleared: Array<{ label: string }> = [];
        const effectsLoader = EffectsLoader.getInstance();
        const remaining: ActiveStatusEffect[] = [];
        for (const entry of this.activeStatusEffects) {
            const compiled = effectsLoader.getCompiledEffect(entry.name);
            if (compiled?.clearOnDamage) {
                cleared.push({ label: compiled.definition.label });
            } else {
                remaining.push(entry);
            }
        }
        this.activeStatusEffects = remaining;
        return cleared;
    }

    /**
     * アクティブな状態異常のスナップショット（UI 表示用）
     */
    getActiveStatusEffects(): Array<{ name: string; label: string; description: string; count: number }> {
        const list: Array<{ name: string; label: string; description: string; count: number }> = [];
        const effectsLoader = EffectsLoader.getInstance();
        for (const entry of this.activeStatusEffects) {
            const def = effectsLoader.getEffect(entry.name);
            if (!def) continue;
            list.push({
                name: entry.name,
                label: def.label,
                description: def.description,
                count: entry.count,
            });
        }
        return list;
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

    damage(amount: number): { dealt: number; cleared: Array<{ label: string }> } {
        const actualDamage = Math.max(1, amount);
        this.addStat(BaseLoader.getInstance().getDefaultEnemyDamageStat(), -actualDamage);
        const cleared = this.notifyDamageTaken();
        return { dealt: actualDamage, cleared };
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
        return BaseLoader.getInstance().calculateDamageToPlayer(this.getEffectiveFormulaVars(), playerVars);
    }

    /**
     * プレイヤーからこの敵へのダメージを計算して適用
     * @param playerVars プレイヤーの実効ステータス一式
     * @returns 実際に与えたダメージと、被弾で解除された effect のラベル一覧
     */
    takeDamageFromPlayer(playerVars: Record<string, number>): { dealt: number; cleared: Array<{ label: string }> } {
        const damage = BaseLoader.getInstance().calculateDamageFromPlayer(playerVars, this.getEffectiveFormulaVars());
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
        clone.activeStatusEffects = this.activeStatusEffects.map(e => ({ name: e.name, count: e.count }));
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
            const effective = this.getEffectiveStat(key);
            const suffix = effective !== value ? `（実効${effective}）` : '';
            result += `${description}: ${value}/${this.getMaxStat(key)}${suffix}\n`;
        }
        if (this.activeStatusEffects.length > 0) {
            const labels = this.getActiveStatusEffects().map(e => e.label).join('、');
            result += `状態: ${labels}\n`;
        }
        result += `経験値: ${this.getExp()}`;
        return result;
    }

    serialize(): {
        instanceId: string; name: string; x: number; y: number;
        stats: Record<string, number>; maxStats: Record<string, number>;
        isDead: boolean; target: { x: number; y: number } | null;
        activeStatusEffects: StatusEffectSaveData[];
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
            activeStatusEffects: this.activeStatusEffects.map(e => ({ name: e.name, count: e.count })),
        };
    }

    restoreAfterLoad(
        stats: Record<string, number>,
        maxStats: Record<string, number>,
        isDead: boolean,
        target: { x: number; y: number } | null,
        activeStatusEffects?: StatusEffectSaveData[],
    ): void {
        this.stats = new Map(Object.entries(stats));
        this.maxStats = new Map(Object.entries(maxStats));
        this.isDead = isDead;
        this.target = target;

        this.activeStatusEffects = [];
        const effectsLoader = EffectsLoader.getInstance();
        for (const e of activeStatusEffects ?? []) {
            if (effectsLoader.hasEffect(e.name)) {
                this.activeStatusEffects.push({ name: e.name, count: e.count });
            } else {
                console.warn(`Unknown status effect in save data, skipped: ${e.name}`);
            }
        }
    }
}
