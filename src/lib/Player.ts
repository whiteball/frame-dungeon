
import { StatsLoader } from './StatsLoader';
import { Inventory } from './Inventory';
import { Item } from './Item';
import { ItemsLoader, type ImmediateEffect, type ContinuousEffect, type RemoveModifierKindSpec } from './ItemsLoader';
import { EffectsLoader, type CompiledTargetSpec } from './EffectsLoader';
import { BaseLoader } from './BaseLoader';
import { SkillsLoader } from './SkillsLoader';
import { ItemModifiersLoader } from './ItemModifiersLoader';
import type { PlayerSaveData } from './SaveManager';

interface ActiveContinuousEffect {
    effects: Map<string, number>;
    remainingTurns: number;
    sourceLabel: string;
    resists: string[];
}

export interface ActiveStatusEffect {
    name: string;
    count: number;
}

export type ApplyStatusEffectResult = 'applied' | 'resisted' | 'unknown';

export interface StatusEffectTickResult {
    applied: Array<{ label: string; statName: string; delta: number }>;
    /** 解除されたエントリ。`expireEvent` は満了発火する events.yml イベント名（onExpire 設定時のみ） */
    cleared: Array<{ label: string; expireEvent?: string }>;
}

export class Player {
    private stats: Map<string, number>;
    private maxStats: Map<string, number>;
    private inventory: Inventory;

    level: number = 1;
    exp: number = 0;

    // 装備スロット
    private equippedWeapon: Item | null = null;
    private equippedMainArmor: Item | null = null;
    private equippedSubArmor1: Item | null = null;
    private equippedSubArmor2: Item | null = null;

    // 持続効果スロット（同じアイテムを複数使用しても各エントリ独立に管理）
    private activeContinuousEffects: ActiveContinuousEffect[] = [];

    // 状態異常/強化効果スロット（同名効果は 1 エントリのみ、count をリセット）
    private activeStatusEffects: ActiveStatusEffect[] = [];

    // 習得済みスキル名（skills.yml の name と対応）
    private learnedSkills: Set<string> = new Set();

    // 手動で無効化されたトグルスキル名（skills.yml の toggle: yes 対象のみ意味を持つ）。
    // 既定は ON のため、無効化されたものだけを保持する。
    private disabledSkills: Set<string> = new Set();

    // 統計情報（プレイ進行に伴って累積。表示は今後実装予定）
    private enemiesDefeated: number = 0;
    private itemsUsed: number = 0;

    constructor() {
        this.stats = new Map();
        this.maxStats = new Map();
        this.inventory = new Inventory(20);
        this.initializeStats();
    }

    private initializeStats(): void {
        // stats.yml が GameDataLoader.loadAll() で読み込まれている前提
        const statNames = StatsLoader.getInstance().getStatNames();
        if (statNames.length === 0) {
            throw new Error('StatsLoader not loaded. Game cannot start without stats configuration.');
        }
        for (const statName of statNames) {
            const initialValue = this.getInitialValue(statName);
            this.stats.set(statName, initialValue);
            this.maxStats.set(statName, initialValue);
        }
    }

    private getInitialValue(statName: string): number {
        return BaseLoader.getInstance().getPlayerInitialStat(statName);
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

        // fluctuation許可の能力値は実効最大値でクランプ（passive add_stats の <stat>_max を含む）
        if (StatsLoader.getInstance().isFluctuationAllowed(key)) {
            const maxValue = this.getEffectiveMaxStat(key);
            this.stats.set(key, Math.min(newValue, maxValue));
        } else {
            this.stats.set(key, newValue);
        }
    }

    /**
     * 即座効果を能力値へ反映する
     * - 数値キーは能力値変動
     * - applyEffect: <name> は状態異常の付与
     * - clearEffect: <name> は状態異常の解除
     * - learnSkill: <name> はスキル習得（既習得でもアイテムは消費される仕様）
     * @param effect 即座効果
     * @returns 適用結果（能力値変動 + 付与/解除した状態異常名 + 新規/既習得スキル名）
     */
    applyImmediateEffect(effect: ImmediateEffect): {
        stats: Map<string, number>;
        appliedEffects: string[];
        resistedEffects: string[];
        clearedEffects: string[];
        learnedSkills: string[];
        alreadyLearnedSkills: string[];
        addedModifiers: Array<{ itemLabel: string; modifierName: string; newCount: number; modifierLabel: string; countable: boolean }>;
        removedModifiers: Array<{ itemLabel: string; modifierNames: string[] }>;
        modifierNoTarget: boolean;
    } {
        const stats = new Map<string, number>();
        const appliedEffects: string[] = [];
        const resistedEffects: string[] = [];
        const clearedEffects: string[] = [];
        const learnedSkills: string[] = [];
        const alreadyLearnedSkills: string[] = [];
        const addedModifiers: Array<{ itemLabel: string; modifierName: string; newCount: number; modifierLabel: string; countable: boolean }> = [];
        const removedModifiers: Array<{ itemLabel: string; modifierNames: string[] }> = [];
        let modifierNoTarget = false;
        for (const [key, value] of Object.entries(effect)) {
            if (key === 'applyEffect') {
                if (typeof value === 'string') {
                    const r = this.applyStatusEffect(value);
                    if (r === 'applied') appliedEffects.push(value);
                    else if (r === 'resisted') resistedEffects.push(value);
                }
            } else if (key === 'clearEffect') {
                if (typeof value === 'string' && this.clearStatusEffect(value)) {
                    clearedEffects.push(value);
                }
            } else if (key === 'learnSkill') {
                if (typeof value === 'string') {
                    if (this.learnSkill(value)) {
                        learnedSkills.push(value);
                    } else if (SkillsLoader.getInstance().hasSkill(value)) {
                        // 既習得（スキル定義は存在するが既に持っている）
                        // skills.yml に存在しないスキル名は YamlCrossValidator で起動時に検出されるためここでは無視
                        alreadyLearnedSkills.push(value);
                    }
                }
            } else if (key === 'executeSkill') {
                // dungeon を必要とするため Player では処理せず、useConsumableItem 側で executeSkillFromItem を呼ぶ
            } else if (key === 'add_modifier') {
                if (typeof value !== 'string') continue;
                const result = this.applyAddModifierEffect(value);
                if (result.applied.length === 0) {
                    modifierNoTarget = true;
                } else {
                    addedModifiers.push(...result.applied);
                }
            } else if (key === 'remove_modifier_kind') {
                if (!value || typeof value !== 'object' || Array.isArray(value)) continue;
                const spec = value as RemoveModifierKindSpec;
                const result = this.applyRemoveModifierKindEffect(spec);
                if (result.totalRemoved === 0) {
                    modifierNoTarget = true;
                } else {
                    removedModifiers.push(...result.removed);
                }
            } else if (typeof value === 'number') {
                const before = this.getStat(key);
                this.addStat(key, value);
                stats.set(key, this.getStat(key) - before);
            }
        }
        return { stats, appliedEffects, resistedEffects, clearedEffects, learnedSkills, alreadyLearnedSkills, addedModifiers, removedModifiers, modifierNoTarget };
    }

    /**
     * add_modifier 効果: 装備中で modifier の target type に一致する全アイテムに付与（delta +1）
     */
    private applyAddModifierEffect(modifierName: string): {
        applied: Array<{ itemLabel: string; modifierName: string; newCount: number; modifierLabel: string; countable: boolean }>;
    } {
        const applied: Array<{ itemLabel: string; modifierName: string; newCount: number; modifierLabel: string; countable: boolean }> = [];
        const def = ItemModifiersLoader.getInstance().getDefinition(modifierName);
        if (!def) return { applied };

        for (const item of this.getAllEquippedItems()) {
            if (!item) continue;
            if (!def.target.includes(item.getType())) continue;
            const r = item.addModifier(modifierName, 1);
            if (r.added) {
                applied.push({
                    itemLabel: item.getLabelWithModifiers(),
                    modifierName,
                    newCount: r.newCount,
                    modifierLabel: def.label,
                    countable: def.countable === true,
                });
            }
        }
        return { applied };
    }

    /**
     * remove_modifier_kind 効果: 指定スロットの装備から kind 一致 modifier を一括除去
     */
    private applyRemoveModifierKindEffect(spec: RemoveModifierKindSpec): {
        removed: Array<{ itemLabel: string; modifierNames: string[] }>;
        totalRemoved: number;
    } {
        const removed: Array<{ itemLabel: string; modifierNames: string[] }> = [];
        let totalRemoved = 0;

        const items: Item[] = [];
        if (spec.target === 'all_equipped') {
            for (const it of this.getAllEquippedItems()) if (it) items.push(it);
        } else if (spec.target === 'weapon') {
            if (this.equippedWeapon) items.push(this.equippedWeapon);
        } else if (spec.target === 'main_armor') {
            if (this.equippedMainArmor) items.push(this.equippedMainArmor);
        } else if (spec.target === 'sub_armor') {
            if (this.equippedSubArmor1) items.push(this.equippedSubArmor1);
            if (this.equippedSubArmor2) items.push(this.equippedSubArmor2);
        }

        for (const item of items) {
            const names = item.removeModifiersByKind(spec.kind);
            if (names.length > 0) {
                removed.push({ itemLabel: item.getLabelWithModifiers(), modifierNames: names });
                totalRemoved += names.length;
            }
        }
        return { removed, totalRemoved };
    }

    /**
     * 指定 name の状態異常を解除する
     * @returns 解除に成功した場合 true（未付与なら false）
     */
    clearStatusEffect(name: string): boolean {
        const idx = this.activeStatusEffects.findIndex(e => e.name === name);
        if (idx < 0) return false;
        this.activeStatusEffects.splice(idx, 1);
        return true;
    }

    /**
     * 持続効果を有効化する
     * 既存の同種効果と合算せず、エントリとして独立に保持する
     * @param effect 持続効果（turns と能力値変動）
     * @param sourceLabel 効果の発生源（アイテム名など。ログとUI表示に使用）
     * @returns 能力値名 → 加算量
     */
    applyContinuousEffect(effect: ContinuousEffect, sourceLabel: string): Map<string, number> {
        const effects = new Map<string, number>();
        for (const [statName, value] of Object.entries(effect)) {
            if (statName === 'turns' || statName === 'resist') continue;
            if (typeof value !== 'number') continue;
            effects.set(statName, value);
        }
        const resists = Array.isArray(effect.resist) ? [...effect.resist] : [];
        if ((effects.size === 0 && resists.length === 0) || effect.turns <= 0) return effects;

        this.activeContinuousEffects.push({
            effects,
            remainingTurns: effect.turns,
            sourceLabel,
            resists,
        });
        return effects;
    }

    /**
     * 持続効果を1ターン経過させる。残ターン数が0以下になったエントリは自動削除。
     * @returns 期限切れになったエントリの { sourceLabel, effects } 配列
     */
    tickContinuousEffects(): Array<{ sourceLabel: string; effects: Map<string, number>; resists: string[] }> {
        const expired: Array<{ sourceLabel: string; effects: Map<string, number>; resists: string[] }> = [];
        const remaining: ActiveContinuousEffect[] = [];
        for (const entry of this.activeContinuousEffects) {
            entry.remainingTurns--;
            if (entry.remainingTurns <= 0) {
                expired.push({ sourceLabel: entry.sourceLabel, effects: entry.effects, resists: entry.resists });
            } else {
                remaining.push(entry);
            }
        }
        this.activeContinuousEffects = remaining;
        return expired;
    }

    /**
     * 全アクティブ持続効果のボーナス合計（能力値名 → 合計変動量）
     */
    getContinuousBonuses(): Map<string, number> {
        const bonuses = new Map<string, number>();
        for (const entry of this.activeContinuousEffects) {
            for (const [stat, value] of entry.effects) {
                bonuses.set(stat, (bonuses.get(stat) ?? 0) + value);
            }
        }
        return bonuses;
    }

    /**
     * 基本能力値 + 装備生ボーナス + 装備 modifier の add_stats + 持続効果ボーナス + permanent 状態効果の合算。
     * 適用順序:
     *   1. base stat
     *   2. + 装備の生ボーナス（getEquipmentBonuses；modifier は含まない）
     *   3. + 装備 modifier の add_stats（formula 評価。formula の元 stat 値はステップ2 までの累積値）
     *   4. + 持続効果ボーナス
     *   5. + permanent 状態効果（formula(x)）
     */
    getEffectiveStat(key: string): number {
        return this.getEffectiveStatWithEquipment(key, this.getAllEquippedItems());
    }

    /**
     * {@link getEffectiveStat} と同じ計算を、装備セットを差し替えて行う。
     * 投擲武器を「仮に装備して攻撃した場合」のダメージ計算で、武器スロットだけを
     * 投擲アイテムに差し替えた装備セットを渡すために使う。
     * equippedItems の順序・内容は {@link getAllEquippedItems} と同じ形式
     * （[weapon, mainArmor, subArmor1, subArmor2]）を想定する。
     */
    getEffectiveStatWithEquipment(key: string, equippedItems: (Item | null)[]): number {
        const preModValue = this.getStat(key) + (this.getEquipmentBonusesFrom(equippedItems).get(key) ?? 0);
        let value = preModValue;

        // 装備中アイテムの modifier add_stats を合算（元 stat 値は preModValue 固定で渡す）
        if (equippedItems.some(it => it !== null)) {
            const formulaVars = this.getFormulaVars();
            formulaVars[key] = preModValue;
            for (const item of equippedItems) {
                if (!item) continue;
                const bonuses = item.getModifierStatBonuses(formulaVars);
                value += (bonuses.get(key) ?? 0);
            }
        }

        value += (this.getContinuousBonuses().get(key) ?? 0);

        for (const entry of this.activeStatusEffects) {
            const compiled = EffectsLoader.getInstance().getCompiledEffect(entry.name);
            if (!compiled) continue;
            for (const spec of compiled.permanent) {
                if (spec.target !== key) continue;
                value = Player.evaluateTargetSpec(spec, value, entry.count) ?? value;
            }
        }

        // passive スキル add_stats を最終層として適用
        value += this.evaluatePassiveAddStats(key, value);

        return value;
    }

    /**
     * 最大値の実効値を返す。base max + passive スキルの `<stat>_max` add_stats を加算したもの。
     * 装備ボーナス / continuous 効果 / 状態異常 permanent は max には適用されない（既存仕様）。
     */
    getEffectiveMaxStat(key: string): number {
        const baseMax = this.getMaxStat(key);
        return baseMax + this.evaluatePassiveAddStats(`${key}_max`, baseMax);
    }

    /**
     * 指定 targetKey（例: 'life' / 'life_max'）に対する passive スキルの add_stats を合算する。
     * 変数：base stats（raw）+ level + exp + targetKey = currentValue。
     * passive 自身は対象キーをこの formula 経由で増減するため、`<targetKey>` 変数を
     * 「現在値（passive 適用前）」として注入し、formula から自己参照を可能にする。
     */
    private evaluatePassiveAddStats(targetKey: string, currentValue: number): number {
        const passives = this.getActivePassivesByTrigger('passive');
        if (passives.length === 0) return 0;

        const baseVars = this.getFormulaVars();
        baseVars[targetKey] = currentValue;

        let delta = 0;
        for (const p of passives) {
            const compiled = SkillsLoader.getInstance().getCompiledSkill(p.skillName);
            if (!compiled) continue;
            const expr = compiled.addStats.get(targetKey);
            if (!expr) continue;
            try {
                const raw = expr.evaluate(baseVars);
                if (typeof raw === 'number' && Number.isFinite(raw)) {
                    delta += Math.floor(raw);
                }
            } catch (e) {
                console.warn(`Failed to evaluate passive add_stats for skill "${p.skillName}", stat "${targetKey}":`, e);
            }
        }
        return delta;
    }

    /**
     * CompiledTargetSpec を評価して結果値を返す
     * - formula があれば parser で評価（変数 x = currentValue, count = count）
     * - value があればそれを直接返す（数値のみ。文字列は数値としては解釈しない）
     */
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
     * spec.value をリテラル文字列として取得（_action: skip など）
     */
    private static literalValueOf(spec: CompiledTargetSpec): string | number | null {
        return spec.value ?? null;
    }

    /**
     * 装備・持続効果・付与中 status effect の resist を集約し、
     * 「現在新規付与を阻止する effect 名」の集合を返す
     */
    getEffectiveResists(): Set<string> {
        const resists = new Set<string>();
        // 装備中アイテム
        for (const item of this.getAllEquippedItems()) {
            if (!item) continue;
            for (const r of item.getEquipmentResists()) resists.add(r);
        }
        // 持続効果
        for (const entry of this.activeContinuousEffects) {
            for (const r of entry.resists) resists.add(r);
        }
        // 付与中 status effect 自身の resist 付随効果
        for (const entry of this.activeStatusEffects) {
            for (const r of EffectsLoader.getInstance().getResistsOf(entry.name)) resists.add(r);
        }
        return resists;
    }

    /**
     * 状態異常/強化効果を付与する
     * 同名効果が既にあれば count を 0 にリセット（重複は 1 エントリのみ）
     * @returns
     *  - 'applied'  付与に成功した
     *  - 'resisted' 耐性により付与を阻止した
     *  - 'unknown'  effects.yml に未定義の name だった（旧 false 相当）
     */
    applyStatusEffect(name: string): ApplyStatusEffectResult {
        if (!EffectsLoader.getInstance().hasEffect(name)) {
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
     * onAction の効果を走査し、プレイヤーの行動を上書きするディレクティブを返す
     * 現状は _action: skip のみサポート
     */
    getPlayerActionDirective(): 'skip' | null {
        for (const entry of this.activeStatusEffects) {
            const compiled = EffectsLoader.getInstance().getCompiledEffect(entry.name);
            if (!compiled) continue;
            for (const spec of compiled.onAction) {
                if (spec.target === '_action') {
                    const v = Player.literalValueOf(spec);
                    if (v === 'skip') return 'skip';
                }
            }
        }
        return null;
    }

    /**
     * ターン終了時の状態効果処理：
     *   1. onTurnEnd 効果を適用（formula で対象パラメータを書き換え）
     *   2. count++ → clear 判定（formula 評価結果を 0〜1 にクランプして Math.random と比較）
     * @returns 適用結果と解除されたエントリのログ用情報
     */
    tickStatusEffects(): StatusEffectTickResult {
        const result: StatusEffectTickResult = { applied: [], cleared: [] };

        // 1. onTurnEnd 効果を適用
        for (const entry of this.activeStatusEffects) {
            const compiled = EffectsLoader.getInstance().getCompiledEffect(entry.name);
            if (!compiled) continue;
            for (const spec of compiled.onTurnEnd) {
                // _action 等の特殊 target は onTurnEnd では無視（仕様上、数値パラメータのみ対象）
                if (spec.target.startsWith('_')) continue;
                const before = this.getStat(spec.target);
                const evaluated = Player.evaluateTargetSpec(spec, before, entry.count);
                if (evaluated === null) continue;
                let next = Math.floor(evaluated);
                // life などの fluctuation 許可ステータスは [0, max] でクランプ
                if (StatsLoader.getInstance().isFluctuationAllowed(spec.target)) {
                    next = Math.max(0, Math.min(next, this.getEffectiveMaxStat(spec.target)));
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
            const compiled = EffectsLoader.getInstance().getCompiledEffect(entry.name);
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
                // 満了（clear.formula 由来の自然解除）時のみ onExpire イベントを発火対象に載せる。
                // 治療（clearStatusEffect）/ 被弾解除（notifyDamageTaken）では発火しない。
                result.cleared.push({
                    label: compiled.definition.label,
                    ...(compiled.onExpire ? { expireEvent: compiled.onExpire } : {}),
                });
            } else {
                remaining.push(entry);
            }
        }
        this.activeStatusEffects = remaining;
        return result;
    }

    /**
     * ダメージ被弾時の通知。clear.onDamage が true のエントリを即座に解除する
     * @returns 解除されたエントリのラベル一覧（ログ用）
     */
    notifyDamageTaken(): Array<{ label: string }> {
        const cleared: Array<{ label: string }> = [];
        const remaining: ActiveStatusEffect[] = [];
        for (const entry of this.activeStatusEffects) {
            const compiled = EffectsLoader.getInstance().getCompiledEffect(entry.name);
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
        for (const entry of this.activeStatusEffects) {
            const def = EffectsLoader.getInstance().getEffect(entry.name);
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

    /**
     * アクティブな持続効果のスナップショットを取得（UI表示用）
     */
    getActiveContinuousEffects(): ActiveContinuousEffect[] {
        return this.activeContinuousEffects.map(e => ({
            effects: new Map(e.effects),
            remainingTurns: e.remainingTurns,
            sourceLabel: e.sourceLabel,
            resists: [...e.resists],
        }));
    }

    /**
     * スキルを習得する
     * @returns 新規習得に成功した場合 true。未定義スキル名や既習得の場合 false
     */
    learnSkill(name: string): boolean {
        if (!SkillsLoader.getInstance().hasSkill(name)) {
            return false;
        }
        if (this.learnedSkills.has(name)) {
            return false;
        }
        this.learnedSkills.add(name);
        return true;
    }

    /**
     * 習得済みスキルかを判定する
     */
    hasSkill(name: string): boolean {
        return this.learnedSkills.has(name);
    }

    /**
     * 習得済みスキルの一覧を取得する（順序非保証）
     */
    getLearnedSkillNames(): string[] {
        return Array.from(this.learnedSkills);
    }

    /**
     * スキル習得を取り消す（デバッグ・テスト用）
     * @returns 解除に成功した場合 true
     */
    forgetSkill(name: string): boolean {
        return this.learnedSkills.delete(name);
    }

    /**
     * トグルスキルが現在有効か判定する（無効化集合に無ければ有効）。
     * toggle 非対応スキルでも常に true を返す（無効化されないため）。
     */
    isSkillEnabled(name: string): boolean {
        return !this.disabledSkills.has(name);
    }

    /**
     * トグルスキルの有効/無効を反転する。
     * @returns 反転後に有効なら true、無効なら false
     */
    toggleSkill(name: string): boolean {
        if (this.disabledSkills.has(name)) {
            this.disabledSkills.delete(name);
            return true;
        }
        this.disabledSkills.add(name);
        return false;
    }

    /**
     * 指定 trigger のアクティブなパッシブスキル一覧を返す。
     * - 学習済みスキル：trigger 一致なら rate=1.0 として返す
     * - 装備中アイテムの passive_skills：trigger 一致なら item 定義の rate で返す
     * 同一スキル名が学習＋装備の両方にある場合は両方独立にカウント（重複発動）。
     */
    getActivePassivesByTrigger(trigger: 'active' | 'on_attack' | 'on_turn' | 'on_damage' | 'passive'): Array<{ skillName: string; rate: number }> {
        const result: Array<{ skillName: string; rate: number }> = [];

        // 学習済みスキル
        for (const name of this.learnedSkills) {
            const def = SkillsLoader.getInstance().getSkill(name);
            if (!def) continue;
            if ((def.trigger ?? 'active') !== trigger) continue;
            if (def.toggle && this.disabledSkills.has(name)) continue;
            result.push({ skillName: name, rate: 1.0 });
        }

        // 装備中アイテムの passive_skills
        for (const item of this.getAllEquippedItems()) {
            if (!item) continue;
            const entries = item.getDefinition().passive_skills ?? [];
            for (const ps of entries) {
                const def = SkillsLoader.getInstance().getSkill(ps.name);
                if (!def) continue;
                if ((def.trigger ?? 'active') !== trigger) continue;
                if (def.toggle && this.disabledSkills.has(ps.name)) continue;
                result.push({ skillName: ps.name, rate: ps.rate });
            }
        }

        return result;
    }

    getEnemiesDefeated(): number {
        return this.enemiesDefeated;
    }

    incrementEnemiesDefeated(): void {
        this.enemiesDefeated++;
    }

    getItemsUsed(): number {
        return this.itemsUsed;
    }

    incrementItemsUsed(): void {
        this.itemsUsed++;
    }

    getInventory(): Inventory {
        return this.inventory;
    }

    getInventoryCapacity(): number {
        return this.inventory.getCapacity();
    }

    setInventoryCapacity(capacity: number): void {
        this.inventory.setCapacity(capacity);
    }

    addInventoryCapacity(amount: number): void {
        const currentCapacity = this.inventory.getCapacity();
        this.inventory.setCapacity(currentCapacity + amount);
    }

    // 装備関連メソッド
    getEquippedWeapon(): Item | null {
        return this.equippedWeapon;
    }

    getEquippedMainArmor(): Item | null {
        return this.equippedMainArmor;
    }

    getEquippedSubArmor1(): Item | null {
        return this.equippedSubArmor1;
    }

    getEquippedSubArmor2(): Item | null {
        return this.equippedSubArmor2;
    }

    getAllEquippedItems(): (Item | null)[] {
        return [this.equippedWeapon, this.equippedMainArmor, this.equippedSubArmor1, this.equippedSubArmor2];
    }

    /**
     * 指定アイテムを equipItem したときに使われるスロット名を予測する。
     * 既存装備が外せない（cursed 等）かを呼び出し前に検査するために使用。
     */
    predictEquipSlot(item: Item): 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2' | null {
        if (item.isWeapon()) return 'weapon';
        if (item.isMainArmor()) return 'main_armor';
        if (item.isSubArmor()) {
            if (!this.equippedSubArmor1) return 'sub_armor1';
            if (!this.equippedSubArmor2) return 'sub_armor2';
            return 'sub_armor1';
        }
        return null;
    }

    getItemInSlot(slot: 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2'): Item | null {
        switch (slot) {
            case 'weapon': return this.equippedWeapon;
            case 'main_armor': return this.equippedMainArmor;
            case 'sub_armor1': return this.equippedSubArmor1;
            case 'sub_armor2': return this.equippedSubArmor2;
            default: return null;
        }
    }

    /**
     * 指定アイテムが装備されているスロットを返す（instanceId 一致で判定）
     * @returns 装備されている場合はスロット名、未装備なら null
     */
    getEquippedSlotOf(item: Item): 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2' | null {
        const id = item.getInstanceId();
        if (this.equippedWeapon?.getInstanceId() === id) return 'weapon';
        if (this.equippedMainArmor?.getInstanceId() === id) return 'main_armor';
        if (this.equippedSubArmor1?.getInstanceId() === id) return 'sub_armor1';
        if (this.equippedSubArmor2?.getInstanceId() === id) return 'sub_armor2';
        return null;
    }

    equipWeapon(item: Item | null): Item | null {
        const previousItem = this.equippedWeapon;
        this.equippedWeapon = item;
        return previousItem;
    }

    equipMainArmor(item: Item | null): Item | null {
        const previousItem = this.equippedMainArmor;
        this.equippedMainArmor = item;
        return previousItem;
    }

    equipSubArmor1(item: Item | null): Item | null {
        const previousItem = this.equippedSubArmor1;
        this.equippedSubArmor1 = item;
        return previousItem;
    }

    equipSubArmor2(item: Item | null): Item | null {
        const previousItem = this.equippedSubArmor2;
        this.equippedSubArmor2 = item;
        return previousItem;
    }

    /**
     * アイテムを装備（自動的に適切なスロットに装備）
     * @param item 装備するアイテム
     * @returns 装備に成功した場合は交換されたアイテム、失敗した場合はnull
     */
    equipItem(item: Item): Item | null {
        if (item.isWeapon()) {
            return this.equipWeapon(item);
        } else if (item.isMainArmor()) {
            return this.equipMainArmor(item);
        } else if (item.isSubArmor()) {
            // 空いているサブ防具スロットに装備
            if (!this.equippedSubArmor1) {
                return this.equipSubArmor1(item);
            } else if (!this.equippedSubArmor2) {
                return this.equipSubArmor2(item);
            } else {
                // 両方埋まっている場合は1番目を交換
                return this.equipSubArmor1(item);
            }
        }
        return null;
    }

    /**
     * 装備を外す
     * @param slotType スロットタイプ
     * @returns 外されたアイテム
     */
    unequipItem(slotType: 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2'): Item | null {
        switch (slotType) {
            case 'weapon':
                return this.equipWeapon(null);
            case 'main_armor':
                return this.equipMainArmor(null);
            case 'sub_armor1':
                return this.equipSubArmor1(null);
            case 'sub_armor2':
                return this.equipSubArmor2(null);
            default:
                return null;
        }
    }

    /**
     * 装備による能力値ボーナスを計算
     * @returns 装備ボーナスのマップ
     */
    getEquipmentBonuses(): Map<string, number> {
        return this.getEquipmentBonusesFrom(this.getAllEquippedItems());
    }

    /**
     * 指定した装備セットの生ボーナス（modifier 含まず）を計算する。
     * 投擲武器の仮装備計算で装備セットを差し替えるために分離している。
     */
    getEquipmentBonusesFrom(items: (Item | null)[]): Map<string, number> {
        const bonuses = new Map<string, number>();

        const equippedItems = items.filter(item => item !== null) as Item[];

        for (const item of equippedItems) {
            const effects = item.getEquipmentEffects();
            for (const [statName, value] of Object.entries(effects)) {
                const currentBonus = bonuses.get(statName) || 0;
                bonuses.set(statName, currentBonus + value);
            }
        }

        return bonuses;
    }

    getFormulaVars(): Record<string, number> {
        const vars: Record<string, number> = {};
        for (const [key, value] of this.stats) {
            vars[key] = value;
        }
        vars.level = this.level;
        vars.exp = this.exp;
        return vars;
    }

    getEffectiveFormulaVars(): Record<string, number> {
        const vars: Record<string, number> = {};
        for (const [key] of this.stats) {
            vars[key] = this.getEffectiveStat(key);
        }
        vars.level = this.level;
        vars.exp = this.exp;
        return vars;
    }

    /**
     * 投擲武器を「仮に装備して攻撃した」場合の実効ステータス変数辞書を返す。
     * 武器スロットだけを投擲アイテムに差し替えて全 stat を再評価するため、
     * 現在装備中の武器の寄与は除外され、投擲武器自身の modifier は反映される。
     * passive / continuous / permanent 効果はそのまま乗る。
     * `damageFromPlayer` formula 評価（`enemy.takeDamageFromPlayer`）に渡す。
     */
    getThrownWeaponFormulaVars(item: Item): Record<string, number> {
        const override: (Item | null)[] = [
            item,
            this.equippedMainArmor,
            this.equippedSubArmor1,
            this.equippedSubArmor2,
        ];
        const vars: Record<string, number> = {};
        for (const [key] of this.stats) {
            vars[key] = this.getEffectiveStatWithEquipment(key, override);
        }
        vars.level = this.level;
        vars.exp = this.exp;
        return vars;
    }

    /**
     * 効果込みの実効値 + 各ステータスの最大値（`<stat>_max`）を露出した変数辞書を返す。
     * スキルコスト formula の評価で使用する。
     */
    getEffectiveFormulaVarsWithMax(): Record<string, number> {
        const vars = this.getEffectiveFormulaVars();
        for (const [key] of this.stats) {
            vars[`${key}_max`] = this.getEffectiveMaxStat(key);
        }
        return vars;
    }

    expToNextLevel(): number {
        return BaseLoader.getInstance().getRequiredExp(this.getFormulaVars());
    }

    /**
     * 経験値を加算する。閾値を超える分だけ levelUp を繰り返し呼び出す。
     * @returns 各レベルアップの結果（到達レベルとそのレベルで新規習得したスキル名）
     */
    addExp(amount: number): { levels: Array<{ level: number; learnedSkills: string[] }> } {
        this.exp += amount;
        const levels: Array<{ level: number; learnedSkills: string[] }> = [];
        while (this.exp >= this.expToNextLevel()) {
            this.exp -= this.expToNextLevel();
            const learned = this.levelUp();
            levels.push({ level: this.level, learnedSkills: learned });
        }
        return { levels };
    }

    /**
     * レベルアップ処理を実行する。
     * - base.yml の levelUpBonus を適用
     * - skills.yml の mastery 配列に基づき、未習得スキルの抽選を行う
     *   （post-level >= least を満たすうち least が最大のエントリの rate で抽選）
     * @returns 今回のレベルアップで新規習得したスキル名の配列
     */
    levelUp(): string[] {
        this.level++;
        const vars = this.getFormulaVars();
        for (const { target, formula, reset } of BaseLoader.getInstance().getLevelUpBonuses()) {
            const amount = formula.evaluate(vars);
            const isFluctuating = StatsLoader.getInstance().isFluctuationAllowed(target) ?? false;
            if (isFluctuating) {
                const newMax = this.getMaxStat(target) + amount;
                this.maxStats.set(target, newMax);
                if (reset) {
                    this.stats.set(target, newMax);
                }
            } else {
                this.addStat(target, amount);
            }
        }

        // mastery 抽選
        const newlyLearned: string[] = [];
        for (const skill of SkillsLoader.getInstance().getSkills()) {
            if (this.learnedSkills.has(skill.name)) continue;
            const mastery = SkillsLoader.getInstance().getNormalizedMastery(skill.name);
            if (mastery.length === 0) continue;

            // post-level >= least を満たすエントリのうち、least が最大のものを採用
            let chosen: { least: number; rate: number } | null = null;
            for (const m of mastery) {
                if (m.least <= this.level) {
                    if (chosen === null || m.least > chosen.least) {
                        chosen = m;
                    }
                }
            }
            if (chosen === null) continue;

            if (Math.random() < chosen.rate) {
                if (this.learnSkill(skill.name)) {
                    newlyLearned.push(skill.name);
                }
            }
        }
        return newlyLearned;
    }

    // 表示用の能力値を取得（実効値ベース：装備ボーナス・modifier add_stats・持続効果・permanent・passive add_stats を全て反映）
    getDisplayStats(): Map<string, {
        value: number;
        abbreviation: string;
        description: string;
        currentValue: number;
        bonus: number;
        maxValue: number | null;
        hasFluctuation: boolean;
    }> {
        const displayStats = new Map();

        for (const [key, baseValue] of this.stats) {
            const effectiveValue = this.getEffectiveStat(key);
            const bonus = effectiveValue - baseValue;
            const abbreviation = StatsLoader.getInstance().getAbbreviation(key) || key.toUpperCase();
            const description = StatsLoader.getInstance().getDescription(key) || key;
            const hasFluctuation = StatsLoader.getInstance().isFluctuationAllowed(key) ?? false;
            const maxValue = hasFluctuation
                ? (this.maxStats.has(key) ? this.getEffectiveMaxStat(key) : null)
                : null;
            displayStats.set(key, { value: effectiveValue, abbreviation, description, currentValue: baseValue, bonus, maxValue, hasFluctuation });
        }

        return displayStats;
    }

    serialize(): PlayerSaveData {
        return {
            level: this.level,
            exp: this.exp,
            stats: Object.fromEntries(this.stats),
            maxStats: Object.fromEntries(this.maxStats),
            inventory: this.inventory.serialize(),
            equippedWeaponId: this.equippedWeapon?.getInstanceId() ?? null,
            equippedMainArmorId: this.equippedMainArmor?.getInstanceId() ?? null,
            equippedSubArmor1Id: this.equippedSubArmor1?.getInstanceId() ?? null,
            equippedSubArmor2Id: this.equippedSubArmor2?.getInstanceId() ?? null,
            activeContinuousEffects: this.activeContinuousEffects.map(e => ({
                effects: Object.fromEntries(e.effects),
                remainingTurns: e.remainingTurns,
                sourceLabel: e.sourceLabel,
                resists: [...e.resists],
            })),
            activeStatusEffects: this.activeStatusEffects.map(e => ({
                name: e.name,
                count: e.count,
            })),
            learnedSkills: Array.from(this.learnedSkills),
            disabledSkills: Array.from(this.disabledSkills),
            enemiesDefeated: this.enemiesDefeated,
            itemsUsed: this.itemsUsed,
        };
    }

    deserialize(data: PlayerSaveData): void {
        this.level = data.level;
        this.exp = data.exp;
        this.stats = new Map(Object.entries(data.stats));
        this.maxStats = new Map(Object.entries(data.maxStats));

        // インベントリ復元
        this.inventory.clear();
        for (const itemData of data.inventory) {
            const def = ItemsLoader.getInstance().getItem(itemData.name);
            if (def) {
                this.inventory.addItem(Item.deserialize(itemData, def));
            }
        }

        // 装備復元（インベントリ内の同一instanceIdのItemを参照）
        this.equippedWeapon = data.equippedWeaponId
            ? this.inventory.getItemById(data.equippedWeaponId) ?? null : null;
        this.equippedMainArmor = data.equippedMainArmorId
            ? this.inventory.getItemById(data.equippedMainArmorId) ?? null : null;
        this.equippedSubArmor1 = data.equippedSubArmor1Id
            ? this.inventory.getItemById(data.equippedSubArmor1Id) ?? null : null;
        this.equippedSubArmor2 = data.equippedSubArmor2Id
            ? this.inventory.getItemById(data.equippedSubArmor2Id) ?? null : null;

        // 持続効果復元
        this.activeContinuousEffects = data.activeContinuousEffects.map(e => ({
            effects: new Map(Object.entries(e.effects)),
            remainingTurns: e.remainingTurns,
            sourceLabel: e.sourceLabel,
            resists: Array.isArray(e.resists) ? [...e.resists] : [],
        }));

        // 状態異常復元
        this.activeStatusEffects = data.activeStatusEffects.map(e => ({
            name: e.name,
            count: e.count,
        }));

        // 習得スキル復元（旧セーブには存在しないため ?? [] で互換、未定義スキル名は警告 + スキップ）
        this.learnedSkills = new Set();
        for (const name of data.learnedSkills ?? []) {
            if (SkillsLoader.getInstance().hasSkill(name)) {
                this.learnedSkills.add(name);
            } else {
                console.warn(`Unknown skill in save data, skipped: ${name}`);
            }
        }

        // 無効化トグルスキル復元（旧セーブ互換のため ?? []）
        this.disabledSkills = new Set(data.disabledSkills ?? []);

        this.enemiesDefeated = data.enemiesDefeated ?? 0;
        this.itemsUsed = data.itemsUsed ?? 0;
    }
}
