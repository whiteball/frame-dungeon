import type { EnemyDefinition } from './EnemyLoader';
import { MapObject, MapMark, MapShape } from './MapObject';
import { StatsLoader } from './StatsLoader';
import { EffectsLoader, type CompiledTargetSpec } from './EffectsLoader';
import { aggregateDirective, type AggregatedDirective, type ForceVerb } from './effects/StatusActionResolver';
import { BaseLoader } from './BaseLoader';
import { EventBus } from '../game/EventBus';
import type { DungeonMap } from './MapGenerator';
import { getDirectionOffset, MapDirection } from './map/MapDirection';
import { getRandomInt } from './util/random';
import type { ActiveStatusEffect, ApplyStatusEffectResult, StatusEffectTickResult } from './Player';
import type { StatusEffectSaveData, ContinuousEffectSaveData } from './SaveManager';
import { ContinuousEffectManager, type ExpiredContinuousEffect } from './ContinuousEffectManager';
import type { ContinuousEffect } from './ItemsLoader';
import { executeEnemyOnAttackSkill } from './skills/EnemySkillExecutor';
import { executePlayerOnDamageSkill } from './skills/PlayerSkillExecutor';

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
    // 持続効果スロット（Player と同形式。投擲消費アイテムの continuous 等を保持）
    private continuousEffects = new ContinuousEffectManager();
    // 最後に扉を越えた出発セル。getDoorTargetsInZone で折り返しを防ぐために使用
    private lastEnteredFrom: { x: integer; y: integer } | null = null;
    // 有効な扉目標がなくランダムウォークした連続ターン数
    private randomWalkCount: integer = 0;
    // target がプレイヤー視認由来か（false=ウェイポイント）。else if の扉リダイレクトはプレイヤー追跡時のみ有効
    private targetIsPlayerPos: boolean = false;
    private blockedCells: [number, number][] = [];

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
        this.shape = MapShape.SPHERE;
        this.concentricCircle = true;
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

        // onAction ディレクティブ解決。行動決定時に actionIndex 前進の印を付ける。
        this.markStatusEffectsActionEligible();
        const directive = this.getActionDirective();
        if (directive.force) {
            this.executeForce(dungeon, directive.force);
            return;
        }
        const noAttack = directive.forbid.has('attack'); // not_attack / not_action
        const noMove = directive.forbid.has('move');     // not_move

        const walkMode = this.definition.walk ?? 'default';
        const { x: px, y: py } = dungeon.getPlayerPos();

        if (!noAttack && dungeon.canAttack(this.x, this.y, px, py)) {
            this.target = { x: px, y: py };
            this.attackPlayer(dungeon);
            return;
        }

        if (noMove) {
            // 移動禁止で攻撃も行えなかった → 何もせずターンを消費
            EventBus.emit('message-log', `${this.getLabel()}は動けない！`, dungeon.getTurnCount());
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
            this.targetIsPlayerPos = false;
        }

        if (dungeon.hasLineOfSight(this.x, this.y, px, py)) {
            this.target = { x: px, y: py };
            this.targetIsPlayerPos = true;
        } else if (this.targetIsPlayerPos && this.target !== null && dungeon.hasLineOfSight(this.x, this.y, this.target.x, this.target.y)) {
            // プレイヤー追跡中のみ: 目標地点に扉があれば、その先を新たな目標にする
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
                // 目標地点の隣の部屋の外を、新たな目標地点にする（targetIsPlayerPos は true のまま）
                const newTarget = outsides[getRandomInt(0, outsides.length)];
                this.target = { x: newTarget[0], y: newTarget[1] };
            }
        }

        if (this.target === null) {
            let doorTargets = dungeon.getDoorTargetsInZone(this.x, this.y);
            // 直前に越えた扉への逆行を防ぐ（ランダム移動で入口から離れた後も有効）
            if (this.lastEnteredFrom !== null) {
                const lfx = this.lastEnteredFrom.x, lfy = this.lastEnteredFrom.y;
                doorTargets = doorTargets.filter(([tx, ty]) => !(tx === lfx && ty === lfy));
            }
            if (doorTargets.length > 0) {
                const [tx, ty] = doorTargets[getRandomInt(0, doorTargets.length)];
                this.target = { x: tx, y: ty };
                this.targetIsPlayerPos = false;
                this.randomWalkCount = 0;
            }
        }

        if (this.target === null) {
            // 有効な扉目標が見つからずランダムウォーク継続中
            this.randomWalkCount++;
            if (this.randomWalkCount >= 10) {
                // 行き止まりで膠着しているので lastEnteredFrom をリセットして再探索を許可
                this.lastEnteredFrom = null;
                this.randomWalkCount = 0;
            }
            const dir = getRandomInt(-1, 4);
            if (dir !== -1) {
                const prevX = this.x, prevY = this.y;
                if (dungeon.tryMoveEnemy(this, dir as MapDirection)) {
                    if (dungeon.getAt(prevX, prevY) & (16 << dir)) {
                        this.lastEnteredFrom = { x: prevX, y: prevY };
                        this.randomWalkCount = 0;
                    }
                }
            }
            return;
        }

        // 記録しているブロックセルの状態をチェックする
        this.blockedCells = this.blockedCells.filter((block) => {
            // 視線が通っていないセルのブロック状態はそのまま
            if (!dungeon.hasLineOfSight(this.x, this.y, block[0], block[1])) {
                return true;
            }
            // そのセルが通過可能になっていたら消す
            return dungeon.isCellBlocked(block[0], block[1]);
        })
        const prevX = this.x, prevY = this.y;
        let path: MapDirection[] | undefined = [];
        do {
            // 経路がブロックされていたなら、別の経路を探す
            if (path && path.length > 0) {
                const [dx, dy] = getDirectionOffset(path[0]);
                this.blockedCells.push([this.x + dx, this.y + dy]);
            }

            path = dungeon.findPath(this.x, this.y, this.target.x, this.target.y, { blockedPositions: this.blockedCells });
            if (path === undefined || path.length === 0) {
                this.target = null;
                this.targetIsPlayerPos = false;
                const dir = getRandomInt(-1, 4);
                if (dir !== -1) {
                    const px2 = this.x, py2 = this.y;
                    if (dungeon.tryMoveEnemy(this, dir as MapDirection)) {
                        if (dungeon.getAt(px2, py2) & (16 << dir)) {
                            this.lastEnteredFrom = { x: px2, y: py2 };
                        }
                    }
                }
                return;
            }
        } while (!dungeon.tryMoveEnemy(this, path[0]));

        // 扉を越えた場合は出発セルを記録し、ランダムウォークカウンタとブロックセルリストをリセット
        if (dungeon.getAt(prevX, prevY) & (16 << path[0])) {
            this.lastEnteredFrom = { x: prevX, y: prevY };
            this.randomWalkCount = 0;
            this.blockedCells = [];
        }

        // プレイヤー追跡中で、移動した地点からプレイヤーが見えているなら、目標地点を更新する
        if (this.targetIsPlayerPos && dungeon.hasLineOfSight(this.x, this.y, px, py)) {
            this.target = { x: px, y: py };
            this.targetIsPlayerPos = true;
        }

        // 目標地点に到達したなら、それを解除する
        if (this.x === this.target.x && this.y === this.target.y) {
            this.target = null;
            this.targetIsPlayerPos = false;
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
        EventBus.emit('message-log', `${this.getLabel()}の攻撃！ ${damage}のダメージ！ (残り${statsLoader.getAbbreviation(targetStat)}: ${player.getStat(targetStat)}/${player.getEffectiveMaxStat(targetStat)})`, dungeon.getTurnCount());
        const cleared = player.notifyDamageTaken();
        for (const c of cleared) {
            EventBus.emit('message-log', `${c.label}が解けた`, dungeon.getTurnCount());
        }

        // プレイヤーの on_damage パッシブを発動（生存中のみ。途中で死亡したら以降スキップ）
        if (!baseLoader.isDead(player.getFormulaVars())) {
            const passives = player.getActivePassivesByTrigger('on_damage');
            for (const p of passives) {
                executePlayerOnDamageSkill(dungeon, player, this, damage, p.skillName, p.rate);
                if (baseLoader.isDead(player.getFormulaVars())) break;
            }
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

    /**
     * 状態異常 onAction の強制行動を敵に対して実行する。
     * item/equip/unequip/use_skill 系は敵では実行不能のため skip に倒す（メッセージのみ）。
     * 自滅（attack_self）で死亡した場合は tickEnemies 側で回収される。
     */
    private executeForce(dungeon: DungeonMap, leaf: { verb: ForceVerb; arg?: string }): void {
        const turn = dungeon.getTurnCount();
        switch (leaf.verb) {
            case 'attack': {
                const { x: px, y: py } = dungeon.getPlayerPos();
                if (dungeon.canAttack(this.x, this.y, px, py)) {
                    this.target = { x: px, y: py };
                    this.attackPlayer(dungeon);
                } else {
                    EventBus.emit('message-log', `${this.getLabel()}は攻撃する相手がいない！`, turn);
                }
                return;
            }
            case 'attack_self': {
                const { dealt, cleared } = this.takeDamageFromPlayer(this.getEffectiveFormulaVars());
                EventBus.emit('attack-flash', 0xFF2222);
                EventBus.emit('message-log', `${this.getLabel()}は自分を攻撃した！ ${dealt}のダメージ！`, turn);
                for (const c of cleared) {
                    EventBus.emit('message-log', `${this.getLabel()}の${c.label}が解けた`, turn);
                }
                return;
            }
            case 'move': {
                // 敵は player 相対トークンを持たないため常にランダム方向へ移動
                dungeon.tryMoveEnemy(this, getRandomInt(0, 4) as MapDirection);
                return;
            }
            case 'skip':
            case 'use_item':
            case 'equip':
            case 'unequip':
            case 'use_skill': {
                const msg = leaf.verb === 'skip' && leaf.arg ? leaf.arg : `${this.getLabel()}は動けない！`;
                EventBus.emit('message-log', msg, turn);
                return;
            }
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
     * 持続効果（continuous）を付与する。投擲した消費アイテム等から呼ばれる。
     * Player.applyContinuousEffect と同形式。
     * @returns 能力値名 → 加算量
     */
    applyContinuousEffect(effect: ContinuousEffect, sourceLabel: string): Map<string, number> {
        return this.continuousEffects.apply(effect, sourceLabel);
    }

    /**
     * 持続効果を1ターン経過させる。残ターン数が0以下になったエントリは自動削除。
     * @returns 期限切れになったエントリの配列
     */
    tickContinuousEffects(): ExpiredContinuousEffect[] {
        return this.continuousEffects.tick();
    }

    /**
     * definition.resist と付与中 status effect 自身の resist、および持続効果が付与する
     * resist を集約した「現在新規付与を阻止する effect 名」集合を返す
     */
    getEffectiveResists(): Set<string> {
        const resists = new Set<string>();
        for (const r of this.definition.resist ?? []) resists.add(r);
        // 持続効果（continuous）が付与する耐性
        for (const r of this.continuousEffects.getResists()) resists.add(r);
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
        // 持続効果（continuous）のボーナスを加算（base → continuous → permanent の順）
        value += this.continuousEffects.getBonuses().get(key) ?? 0;
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
            existing.actionIndex = 0;
            existing.eligibleAdvance = false;
        } else {
            this.activeStatusEffects.push({ name, count: 0, actionIndex: 0, eligibleAdvance: false });
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
     * 有効な onAction 効果を集約し、その手番の敵ディレクティブを返す（純粋・副作用なし）。
     */
    getActionDirective(): AggregatedDirective {
        return aggregateDirective(
            this.activeStatusEffects,
            (name) => EffectsLoader.getInstance().getCompiledEffect(name)?.onAction ?? [],
        );
    }

    /** 行動決定時（act 冒頭）に呼び、有効な効果へ actionIndex 前進の印を付ける（Player と同形式）。 */
    markStatusEffectsActionEligible(): void {
        for (const entry of this.activeStatusEffects) {
            entry.eligibleAdvance = true;
        }
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
            // onAction の actionIndex は行動決定時に印が付いた効果のみ前進（Player と同形式）
            if (entry.eligibleAdvance) {
                entry.actionIndex++;
                entry.eligibleAdvance = false;
            }
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
        clone.targetIsPlayerPos = this.targetIsPlayerPos;
        clone.lastEnteredFrom = this.lastEnteredFrom ? { ...this.lastEnteredFrom } : null;
        clone.blockedCells = this.blockedCells ? [ ...this.blockedCells ] : [];
        clone.randomWalkCount = this.randomWalkCount;
        clone.activeStatusEffects = this.activeStatusEffects.map(e => ({ name: e.name, count: e.count, actionIndex: e.actionIndex, eligibleAdvance: false }));
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
        activeContinuousEffects: ContinuousEffectSaveData[];
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
            activeStatusEffects: this.activeStatusEffects.map(e => ({ name: e.name, count: e.count, actionIndex: e.actionIndex })),
            activeContinuousEffects: this.continuousEffects.serialize(),
        };
    }

    restoreAfterLoad(
        stats: Record<string, number>,
        maxStats: Record<string, number>,
        isDead: boolean,
        target: { x: number; y: number } | null,
        activeStatusEffects?: StatusEffectSaveData[],
        activeContinuousEffects?: ContinuousEffectSaveData[],
    ): void {
        this.stats = new Map(Object.entries(stats));
        this.maxStats = new Map(Object.entries(maxStats));
        this.isDead = isDead;
        this.target = target;
        this.continuousEffects.restore(activeContinuousEffects);

        this.activeStatusEffects = [];
        const effectsLoader = EffectsLoader.getInstance();
        for (const e of activeStatusEffects ?? []) {
            if (effectsLoader.hasEffect(e.name)) {
                this.activeStatusEffects.push({ name: e.name, count: e.count, actionIndex: e.actionIndex ?? 0, eligibleAdvance: false });
            } else {
                console.warn(`Unknown status effect in save data, skipped: ${e.name}`);
            }
        }
    }
}
