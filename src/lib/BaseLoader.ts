import yaml from 'js-yaml';
import { Parser, type Expression } from 'expr-eval-fork';
import { EnemyLoader, type EnemyDropEntry } from './EnemyLoader';
import { TrapsLoader } from './TrapsLoader';

interface RawLevelUpBonusSpec {
    target: string;
    formula: string | number;
    reset?: boolean | string;
}

export interface CompiledLevelUpBonus {
    target: string;
    formula: Expression;
    reset: boolean;
}

export interface FloorConfigRaw {
    size: number | { w: number; h: number };
    enemyCount: number;
    enemies: (string | { name: string; count: number })[] | null;
    trapCount: number | { min: number; max: number };
    traps: string[] | null;
    /** フロア床アイテムに modifier を付与する確率（0..1）。未指定/0 なら付与なし */
    itemModifierChance?: number;
    /** 出現可能 modifier 名 → 追加重み。未指定なら item_modifiers.yml の weight のみで全 modifier から抽選 */
    itemModifierPool?: Record<string, number>;
    /**
     * フロア共通の敵ドロップ追加プール。
     * enemies.yml の drop[] と additive に合成され、各エントリは独立に rate で判定される。
     */
    enemyDropPool?: EnemyDropEntry[];
    /**
     * 隠し部屋有効化。
     * true / 'yes' なら確率 0.5、数値ならその確率（0..1）で
     * 「出入口が 1 つしかない部屋」から 1 部屋抽選し扉を壁に偽装する。
     */
    secretRoom?: boolean | number | string;
}

export interface ResolvedFloorConfig {
    width: number;
    height: number;
    enemyCount: number;
    fixedEnemies: { name: string; count: number }[];
    randomEnemyPool: string[];
    trapMin: number;
    trapMax: number;
    trapPool: string[];
    itemModifierChance: number;
    itemModifierPool?: Record<string, number>;
    enemyDropPool: EnemyDropEntry[];
    /** 隠し部屋抽選確率（0..1）。0 なら無効。boolean true は 0.5 に正規化される */
    secretRoomChance: number;
}

export class BaseLoader {
    private static instance: BaseLoader;
    private loaded = false;
    private name = 'Dungeon Game';
    private goalFloor = 10;
    private rawFloorConfigs: Map<number, FloorConfigRaw> = new Map();
    private resolvedCache: Map<number, ResolvedFloorConfig> = new Map();
    private parser = new Parser();
    private _defaultDamageStat: string | null = null;
    private deadFormula: Expression | null = null;
    private _defaultEnemyDamageStat: string | null = null;
    private enemyDeadFormula: Expression | null = null;
    private damageToPlayerFormula: Expression | null = null;
    private damageFromPlayerFormula: Expression | null = null;
    private requiredExpFormula: Expression | null = null;
    private compiledLevelUpBonuses: CompiledLevelUpBonus[] = [];
    private autoSpawnerFormula: Expression | null = null;
    private playerInitialStats: Map<string, number> = new Map();

    // INFOレベル判定用フラグ
    private _nameExplicit = false;
    private _goalFloorExplicit = false;

    private constructor() {}

    static getInstance(): BaseLoader {
        if (!this.instance) {
            this.instance = new BaseLoader();
        }
        return this.instance;
    }

    async load(customText?: string): Promise<void> {
        if (this.loaded) return;

        const filePath = `${import.meta.env.BASE_URL}data/base.yml`;
        let yamlText: string;

        if (customText !== undefined) {
            yamlText = customText;
            if (!yamlText.trim()) {
                this._throwWithAlert(filePath, new Error('base.yml のカスタムデータが空です'));
            }
        } else {
            const response = await fetch(filePath);
            if (!response.ok) {
                this._throwWithAlert(filePath, new Error(`HTTP ${response.status}: ${response.statusText}`));
            }
            yamlText = await response.text();
            if (!yamlText.trim()) {
                this._throwWithAlert(filePath, new Error(`${filePath} is empty`));
            }
        }

        try {
            const parsed = yaml.load(yamlText) as any;
            if (!parsed || typeof parsed !== 'object') {
                throw new Error(`${filePath} の内容が不正です`);
            }

            if (typeof parsed.name === 'string') {
                this.name = parsed.name;
                this._nameExplicit = true;
            }
            if (typeof parsed.goalFloor === 'number') {
                this.goalFloor = parsed.goalFloor;
                this._goalFloorExplicit = true;
            }

            if (Array.isArray(parsed.floors)) {
                for (const entry of parsed.floors) {
                    if (!entry || typeof entry !== 'object') continue;
                    const key = parseInt(Object.keys(entry)[0], 10);
                    if (isNaN(key)) continue;
                    const rawConfig = entry[key] as FloorConfigRaw;
                    if (rawConfig && typeof rawConfig === 'object') {
                        this.rawFloorConfigs.set(key, rawConfig);
                    }
                }
            }

            if (this.rawFloorConfigs.size === 0) {
                throw new Error(`${filePath} に floors の設定が見つかりません`);
            }

            if (typeof parsed.defaultDamageStat === 'string') {
                this._defaultDamageStat = parsed.defaultDamageStat;
            }

            if (parsed.dead && typeof parsed.dead.formula === 'string') {
                try {
                    this.deadFormula = this.parser.parse(parsed.dead.formula);
                } catch (e) {
                    throw new Error(`dead.formula のパースに失敗しました: ${parsed.dead.formula}`);
                }
            }

            if (typeof parsed.defaultEnemyDamageStat === 'string') {
                this._defaultEnemyDamageStat = parsed.defaultEnemyDamageStat;
            }

            if (parsed.enemyDead && typeof parsed.enemyDead.formula === 'string') {
                try {
                    this.enemyDeadFormula = this.parser.parse(parsed.enemyDead.formula);
                } catch (e) {
                    throw new Error(`enemyDead.formula のパースに失敗しました: ${parsed.enemyDead.formula}`);
                }
            }

            if (parsed.damageToPlayer && typeof parsed.damageToPlayer.formula === 'string') {
                try {
                    this.damageToPlayerFormula = this.parser.parse(parsed.damageToPlayer.formula);
                } catch (e) {
                    throw new Error(`damageToPlayer.formula のパースに失敗しました: ${parsed.damageToPlayer.formula}`);
                }
            }

            if (parsed.damageFromPlayer && typeof parsed.damageFromPlayer.formula === 'string') {
                try {
                    this.damageFromPlayerFormula = this.parser.parse(parsed.damageFromPlayer.formula);
                } catch (e) {
                    throw new Error(`damageFromPlayer.formula のパースに失敗しました: ${parsed.damageFromPlayer.formula}`);
                }
            }

            if (parsed.requiredExp && typeof parsed.requiredExp.formula === 'string') {
                try {
                    this.requiredExpFormula = this.parser.parse(parsed.requiredExp.formula);
                } catch (e) {
                    throw new Error(`requiredExp.formula のパースに失敗しました: ${parsed.requiredExp.formula}`);
                }
            }

            if (Array.isArray(parsed.levelUpBonus)) {
                for (const entry of parsed.levelUpBonus as RawLevelUpBonusSpec[]) {
                    if (!entry || typeof entry.target !== 'string') continue;
                    if (entry.formula === undefined || entry.formula === null) continue;
                    const formulaStr = String(entry.formula);
                    try {
                        this.compiledLevelUpBonuses.push({
                            target: entry.target,
                            formula: this.parser.parse(formulaStr),
                            reset: entry.reset === true || entry.reset === 'yes',
                        });
                    } catch (e) {
                        console.warn(`levelUpBonus[${entry.target}].formula のパースに失敗しました: ${formulaStr}`);
                    }
                }
            }

            if (parsed.autoSpawner && typeof parsed.autoSpawner.formula === 'string') {
                try {
                    this.autoSpawnerFormula = this.parser.parse(parsed.autoSpawner.formula);
                } catch (e) {
                    throw new Error(`autoSpawner.formula のパースに失敗しました: ${parsed.autoSpawner.formula}`);
                }
            }

            if (parsed.playerInitialStats && typeof parsed.playerInitialStats === 'object') {
                for (const [key, value] of Object.entries(parsed.playerInitialStats)) {
                    if (typeof value === 'number') {
                        this.playerInitialStats.set(key, value);
                    }
                }
            }
        } catch (error) {
            this._throwWithAlert(filePath, error);
        }

        if (!this._defaultDamageStat) {
            this._throwWithAlert(filePath, new Error('base.yml に defaultDamageStat が定義されていません'));
        }
        if (!this.requiredExpFormula) {
            this._throwWithAlert(filePath, new Error('base.yml に requiredExp が定義されていません'));
        }
        if (!this.damageToPlayerFormula) {
            this._throwWithAlert(filePath, new Error('base.yml に damageToPlayer が定義されていません'));
        }
        if (!this.damageFromPlayerFormula) {
            this._throwWithAlert(filePath, new Error('base.yml に damageFromPlayer が定義されていません'));
        }

        this.loaded = true;
    }

    private _throwWithAlert(filePath: string, error: unknown): never {
        console.error(`Failed to load ${filePath}:`, error);
        alert(
            `ベース設定データの読み込みに失敗しました。\n\n` +
            `public${filePath} ファイルが正しく配置されており、\n` +
            `内容が正しい形式であることを確認してください。\n\n` +
            `エラー詳細: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }

    // ─── INFOレベル判定アクセサ ───────────────────────────────────────────────

    hasName(): boolean { return this._nameExplicit; }
    hasGoalFloor(): boolean { return this._goalFloorExplicit; }
    hasDeadFormula(): boolean { return this.deadFormula !== null; }
    hasDefaultEnemyDamageStat(): boolean { return this._defaultEnemyDamageStat !== null; }
    hasEnemyDeadFormula(): boolean { return this.enemyDeadFormula !== null; }
    hasAutoSpawnerFormula(): boolean { return this.autoSpawnerFormula !== null; }

    // ─── クロスバリデーション用 ────────────────────────────────────────────────

    getRawFloorConfigs(): ReadonlyMap<number, FloorConfigRaw> {
        return this.rawFloorConfigs;
    }

    // ─── ゲームロジック用アクセサ ─────────────────────────────────────────────

    getDefaultDamageStat(): string {
        return this._defaultDamageStat!;
    }

    isDead(vars: Record<string, number>): boolean {
        if (this.deadFormula) {
            return Boolean(this.deadFormula.evaluate(vars));
        }
        return (vars[this._defaultDamageStat!] ?? 0) <= 0;
    }

    getDefaultEnemyDamageStat(): string {
        return this._defaultEnemyDamageStat ?? this._defaultDamageStat!;
    }

    isEnemyDead(enemyVars: Record<string, number>): boolean {
        const formula = this.enemyDeadFormula ?? this.deadFormula;
        if (formula) {
            return Boolean(formula.evaluate(enemyVars));
        }
        return (enemyVars[this.getDefaultEnemyDamageStat()] ?? 0) <= 0;
    }

    calculateDamageToPlayer(enemyVars: Record<string, number>, playerVars: Record<string, number>): number {
        const vars: Record<string, number> = {};
        for (const [k, v] of Object.entries(enemyVars)) vars[`enemy_${k}`] = v;
        for (const [k, v] of Object.entries(playerVars)) vars[`player_${k}`] = v;
        return Math.max(1, Math.floor(Number(this.damageToPlayerFormula!.evaluate(vars))));
    }

    calculateDamageFromPlayer(playerVars: Record<string, number>, enemyVars: Record<string, number>): number {
        const vars: Record<string, number> = {};
        for (const [k, v] of Object.entries(playerVars)) vars[`player_${k}`] = v;
        for (const [k, v] of Object.entries(enemyVars)) vars[`enemy_${k}`] = v;
        return Math.max(1, Math.floor(Number(this.damageFromPlayerFormula!.evaluate(vars))));
    }

    getRequiredExp(vars: Record<string, number>): number {
        return Number(this.requiredExpFormula!.evaluate(vars));
    }

    getLevelUpBonuses(): CompiledLevelUpBonus[] {
        return this.compiledLevelUpBonuses;
    }

    isEnemySpawnableOnFloor(
        enemyVars: Record<string, number>,
        floor: number,
        maxFloor: number,
        rankInfo: { rank: number; minRank: number; maxRank: number }
    ): boolean {
        const vars = { ...enemyVars, currentFloor: floor, maxFloor, ...rankInfo };
        if (this.autoSpawnerFormula) {
            return Boolean(this.autoSpawnerFormula.evaluate(vars));
        }
        const { rank, minRank, maxRank } = rankInfo;
        if (maxRank === minRank) return true;
        return rank / (maxRank - minRank) * maxFloor <= floor;
    }

    getPlayerInitialStat(statName: string): number {
        return this.playerInitialStats.get(statName) ?? 0;
    }

    getName(): string {
        return this.name;
    }

    getGoalFloor(): number {
        return this.goalFloor;
    }

    getFloorConfig(floor: number): ResolvedFloorConfig {
        const keys = [...this.rawFloorConfigs.keys()].sort((a, b) => a - b);
        const matchingKeys = keys.filter(k => k <= floor);
        const matchKey = matchingKeys.length > 0 ? matchingKeys[matchingKeys.length - 1] : keys[0];

        if (this.resolvedCache.has(matchKey)) {
            return this.resolvedCache.get(matchKey)!;
        }

        const raw = this.rawFloorConfigs.get(matchKey)!;
        const resolved = this.resolveConfig(matchKey, raw);
        this.resolvedCache.set(matchKey, resolved);
        return resolved;
    }

    private resolveConfig(key: number, raw: FloorConfigRaw): ResolvedFloorConfig {
        const width = typeof raw.size === 'number' ? raw.size : raw.size.w;
        const height = typeof raw.size === 'number' ? raw.size : raw.size.h;

        const fixedEnemies: { name: string; count: number }[] = [];
        const randomEnemyPool: string[] = [];
        for (const entry of raw.enemies ?? []) {
            const name = typeof entry === 'string' ? entry : entry.name;
            if (!EnemyLoader.getInstance().getEnemy(name)) {
                console.error(`base.yml floors[${key}]: 敵 "${name}" が enemies.yml に存在しません。スキップします`);
                continue;
            }
            if (typeof entry === 'string') {
                randomEnemyPool.push(name);
            } else {
                fixedEnemies.push({ name, count: entry.count });
            }
        }

        const trapPool: string[] = [];
        for (const name of raw.traps ?? []) {
            if (!TrapsLoader.getInstance().getTrap(name)) {
                console.error(`base.yml floors[${key}]: トラップ "${name}" が traps.yml に存在しません。スキップします`);
                continue;
            }
            trapPool.push(name);
        }

        const trapMin = typeof raw.trapCount === 'number' ? raw.trapCount : (raw.trapCount?.min ?? 0);
        const trapMax = typeof raw.trapCount === 'number' ? raw.trapCount : (raw.trapCount?.max ?? 0);

        if (trapMin > 0 && trapPool.length === 0) {
            console.warn(`base.yml floors[${key}]: trapCount=${trapMin} ですが traps リストが空です。トラップは配置されません`);
        }

        let itemModifierChance = 0;
        if (typeof raw.itemModifierChance === 'number') {
            itemModifierChance = Math.max(0, Math.min(1, raw.itemModifierChance));
        }
        let itemModifierPool: Record<string, number> | undefined;
        if (raw.itemModifierPool && typeof raw.itemModifierPool === 'object' && !Array.isArray(raw.itemModifierPool)) {
            const pool: Record<string, number> = {};
            for (const [name, weight] of Object.entries(raw.itemModifierPool)) {
                if (typeof weight === 'number' && weight > 0) {
                    pool[name] = weight;
                }
            }
            if (Object.keys(pool).length > 0) {
                itemModifierPool = pool;
            }
        }

        let secretRoomChance = 0;
        if (raw.secretRoom === true || raw.secretRoom === 'yes' || raw.secretRoom === 'true') {
            secretRoomChance = 0.5;
        } else if (typeof raw.secretRoom === 'number' && isFinite(raw.secretRoom)) {
            secretRoomChance = Math.max(0, Math.min(1, raw.secretRoom));
        }

        const enemyDropPool: EnemyDropEntry[] = [];
        if (Array.isArray(raw.enemyDropPool)) {
            for (const entry of raw.enemyDropPool) {
                if (!entry || typeof entry !== 'object') continue;
                if (typeof entry.item !== 'string' || typeof entry.rate !== 'number') continue;
                if (entry.rate <= 0) continue;
                enemyDropPool.push({
                    item: entry.item,
                    rate: Math.max(0, Math.min(1, entry.rate)),
                    modifierChance: typeof entry.modifierChance === 'number'
                        ? Math.max(0, Math.min(1, entry.modifierChance))
                        : undefined,
                });
            }
        }

        return {
            width, height,
            enemyCount: raw.enemyCount ?? 0,
            fixedEnemies, randomEnemyPool,
            trapMin, trapMax, trapPool,
            itemModifierChance,
            itemModifierPool,
            enemyDropPool,
            secretRoomChance,
        };
    }
}
