import yaml from 'js-yaml';
import { Parser, type Expression } from 'expr-eval-fork';
import { EnemyLoader } from './EnemyLoader';
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

interface FloorConfigRaw {
    size: number | { w: number; h: number };
    enemyCount: number;
    enemies: (string | { name: string; count: number })[] | null;
    trapCount: number | { min: number; max: number };
    traps: string[] | null;
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
    private requiredExpFormula: Expression | null = null;
    private compiledLevelUpBonuses: CompiledLevelUpBonus[] = [];
    private autoSpawnerFormula: Expression | null = null;

    private constructor() {}

    static getInstance(): BaseLoader {
        if (!this.instance) {
            this.instance = new BaseLoader();
        }
        return this.instance;
    }

    async load(): Promise<void> {
        if (this.loaded) return;

        const filePath = '/data/base.yml';
        const response = await fetch(filePath);
        if (!response.ok) {
            this._throwWithAlert(filePath, new Error(`HTTP ${response.status}: ${response.statusText}`));
        }

        const yamlText = await response.text();
        if (!yamlText.trim()) {
            this._throwWithAlert(filePath, new Error(`${filePath} is empty`));
        }

        try {
            const parsed = yaml.load(yamlText) as any;
            if (!parsed || typeof parsed !== 'object') {
                throw new Error(`${filePath} の内容が不正です`);
            }

            if (typeof parsed.name === 'string') {
                this.name = parsed.name;
            }
            if (typeof parsed.gaolFloor === 'number') {
                this.goalFloor = parsed.gaolFloor;
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
        } catch (error) {
            this._throwWithAlert(filePath, error);
        }

        if (!this._defaultDamageStat) {
            this._throwWithAlert(filePath, new Error('base.yml に defaultDamageStat が定義されていません'));
        }
        if (!this.requiredExpFormula) {
            this._throwWithAlert(filePath, new Error('base.yml に requiredExp が定義されていません'));
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

        return { width, height, enemyCount: raw.enemyCount ?? 0, fixedEnemies, randomEnemyPool, trapMin, trapMax, trapPool };
    }
}
