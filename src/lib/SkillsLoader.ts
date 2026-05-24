import { Parser, type Expression } from 'expr-eval-fork';
import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';

export type SkillTarget = 'front' | 'around' | 'room' | 'map' | 'self' | 'hit';
export type SkillTrigger = 'active' | 'on_attack' | 'on_turn' | 'on_damage' | 'passive';

const VALID_TARGETS: ReadonlySet<SkillTarget> = new Set<SkillTarget>(['front', 'around', 'room', 'map', 'self', 'hit']);
const VALID_TRIGGERS: ReadonlySet<SkillTrigger> = new Set<SkillTrigger>(['active', 'on_attack', 'on_turn', 'on_damage', 'passive']);

/**
 * スキル内 action 配列の 1 エントリ
 * - 文字列の場合：パラメータなしのアクション（例: 'attack', 'reveal_trap'）
 * - スカラー値オブジェクト：{ damage: 30 }, { heal: 'life_max * 0.3' }
 * - オブジェクト値オブジェクト：{ apply_effect: { effect: 'poison', rate: 0.5 } }
 */
export type SkillActionEntry = string | { [actionName: string]: number | string | Record<string, number | string> };

/**
 * 習得条件エントリ
 * - exact: N → 内部的に { least: N, rate: 1 } として扱う
 * - least: N + rate: R → post-level >= N のレベルアップで rate 抽選
 */
export interface SkillMasteryEntry {
    exact?: number;
    least?: number;
    rate?: number;
}

export interface SkillDefinition {
    name: string;
    label: string;
    description: string;
    /** 省略時は 'active' として扱う */
    trigger?: SkillTrigger;
    /** trigger='passive' のときは省略可（target は意味を持たない） */
    target?: SkillTarget;
    cost?: Record<string, number | string>;
    /** trigger='passive' のときは省略可（action 配列も空でよい） */
    action?: SkillActionEntry[];
    mastery?: SkillMasteryEntry[];
    /** trigger='passive' 専用：常時 stat に加算する formula（省略可・空オブジェクト可） */
    add_stats?: Record<string, number | string>;
}

/**
 * パース済みコスト式付きのスキル定義
 * - cost: ステータス名 → コンパイル済み Expression（数値リテラルも文字列化して統一）
 * - addStats: stat 名 → コンパイル済み add_stats Expression（passive 専用）
 */
interface CompiledSkill {
    definition: SkillDefinition;
    cost: Map<string, Expression>;
    addStats: Map<string, Expression>;
}

export class SkillsLoader {
    private static instance: SkillsLoader;
    private store = new YamlDefinitionStore<SkillDefinition>();
    private parser: Parser = new Parser();
    private compiledByName: Map<string, CompiledSkill> = new Map();

    private constructor() {}

    static getInstance(): SkillsLoader {
        if (!this.instance) {
            this.instance = new SkillsLoader();
        }
        return this.instance;
    }

    async loadSkills(): Promise<void> {
        this.compiledByName.clear();
        const customText = CustomDataStore.get('skills');
        await this.store.load(`${import.meta.env.BASE_URL}data/skills.yml`, 'スキル', s => this.validateSkill(s), { customText });
        for (const skill of this.store.getAll()) {
            this.compiledByName.set(skill.name, this.compile(skill));
        }
    }

    /**
     * スキル定義からコンパイル済み版（コスト式を事前パース）を生成
     */
    private compile(def: SkillDefinition): CompiledSkill {
        const cost = new Map<string, Expression>();
        if (def.cost) {
            for (const [stat, formulaOrNum] of Object.entries(def.cost)) {
                const src = typeof formulaOrNum === 'number' ? String(formulaOrNum) : formulaOrNum;
                try {
                    cost.set(stat, this.parser.parse(src));
                } catch (e) {
                    console.warn(`Failed to parse cost formula "${src}" for skill "${def.name}":`, e);
                }
            }
        }
        const addStats = new Map<string, Expression>();
        if (def.add_stats) {
            for (const [stat, formulaOrNum] of Object.entries(def.add_stats)) {
                const src = typeof formulaOrNum === 'number' ? String(formulaOrNum) : formulaOrNum;
                try {
                    addStats.set(stat, this.parser.parse(src));
                } catch (e) {
                    console.warn(`Failed to parse add_stats formula "${src}" for skill "${def.name}":`, e);
                }
            }
        }
        return { definition: def, cost, addStats };
    }

    private validateSkill(skill: any): void {
        if (!skill.name || typeof skill.name !== 'string') {
            throw new Error(`Invalid skill: missing or invalid 'name' field`);
        }
        if (!skill.label || typeof skill.label !== 'string') {
            throw new Error(`Invalid skill '${skill.name}': missing or invalid 'label' field`);
        }
        if (!skill.description || typeof skill.description !== 'string') {
            throw new Error(`Invalid skill '${skill.name}': missing or invalid 'description' field`);
        }
        if (skill.trigger !== undefined && !VALID_TRIGGERS.has(skill.trigger)) {
            throw new Error(`Invalid skill '${skill.name}': 'trigger' must be one of ${Array.from(VALID_TRIGGERS).join(', ')}`);
        }
        const triggerValue: SkillTrigger = (skill.trigger ?? 'active');
        const isPassiveTrigger = triggerValue === 'passive';

        if (skill.target !== undefined && !VALID_TARGETS.has(skill.target)) {
            throw new Error(`Invalid skill '${skill.name}': 'target' must be one of ${Array.from(VALID_TARGETS).join(', ')}`);
        }
        if (!isPassiveTrigger && !skill.target) {
            throw new Error(`Invalid skill '${skill.name}': 'target' is required for trigger '${triggerValue}'`);
        }
        if (skill.target === 'hit' && triggerValue !== 'on_attack' && triggerValue !== 'on_damage') {
            throw new Error(`Invalid skill '${skill.name}': target 'hit' requires trigger 'on_attack' or 'on_damage'`);
        }
        if (triggerValue === 'on_turn' && skill.target !== 'self') {
            throw new Error(`Invalid skill '${skill.name}': trigger 'on_turn' requires target 'self'`);
        }
        if (triggerValue === 'on_damage' && skill.target !== 'self' && skill.target !== 'hit') {
            throw new Error(`Invalid skill '${skill.name}': trigger 'on_damage' requires target 'self' or 'hit'`);
        }
        if (triggerValue === 'on_attack' && skill.target !== 'hit') {
            throw new Error(`Invalid skill '${skill.name}': trigger 'on_attack' requires target 'hit'`);
        }

        // passive: action は省略可・空配列可、add_stats は省略可・空オブジェクト可
        if (isPassiveTrigger) {
            if (skill.action !== undefined) {
                if (!Array.isArray(skill.action)) {
                    throw new Error(`Invalid skill '${skill.name}': 'action' must be an array (or omitted for passive)`);
                }
                if (skill.action.length > 0) {
                    throw new Error(`Invalid skill '${skill.name}': 'passive' skills cannot have actions (use add_stats or remove action)`);
                }
            }
            if (skill.add_stats !== undefined) {
                if (typeof skill.add_stats !== 'object' || Array.isArray(skill.add_stats) || skill.add_stats === null) {
                    throw new Error(`Invalid skill '${skill.name}': 'add_stats' must be an object`);
                }
                for (const [k, v] of Object.entries(skill.add_stats)) {
                    if (typeof v !== 'number' && typeof v !== 'string') {
                        throw new Error(`Invalid skill '${skill.name}': add_stats.${k} must be a number or formula string`);
                    }
                }
            }
        } else {
            if (skill.add_stats !== undefined) {
                throw new Error(`Invalid skill '${skill.name}': 'add_stats' is only allowed for trigger 'passive'`);
            }
            if (!Array.isArray(skill.action) || skill.action.length === 0) {
                throw new Error(`Invalid skill '${skill.name}': 'action' must be a non-empty array`);
            }
        }
        const actionArray: any[] = Array.isArray(skill.action) ? skill.action : [];
        for (let i = 0; i < actionArray.length; i++) {
            const entry = actionArray[i];
            if (typeof entry === 'string') continue;
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                const keys = Object.keys(entry);
                if (keys.length !== 1) {
                    throw new Error(`Invalid skill '${skill.name}': action[${i}] object must have exactly one key`);
                }
                const actionKey = keys[0];
                if (actionKey === 'apply_effect') {
                    const val = (entry as Record<string, unknown>)[actionKey];
                    if (typeof val === 'string') {
                        // OK: apply_effect: 'poison'
                    } else if (val && typeof val === 'object' && !Array.isArray(val)) {
                        const p = val as Record<string, unknown>;
                        if (typeof p.effect !== 'string' || !p.effect) {
                            throw new Error(`Invalid skill '${skill.name}': action[${i}].apply_effect.effect must be a non-empty string`);
                        }
                        if (p.rate !== undefined) {
                            if (typeof p.rate === 'number') {
                                if (p.rate < 0 || p.rate > 1) {
                                    throw new Error(`Invalid skill '${skill.name}': action[${i}].apply_effect.rate must be in [0, 1]`);
                                }
                            } else if (typeof p.rate === 'string') {
                                try {
                                    this.parser.parse(p.rate);
                                } catch {
                                    throw new Error(`Invalid skill '${skill.name}': action[${i}].apply_effect.rate formula parse error: "${p.rate}"`);
                                }
                            } else {
                                throw new Error(`Invalid skill '${skill.name}': action[${i}].apply_effect.rate must be a number or formula string`);
                            }
                        }
                    } else {
                        throw new Error(`Invalid skill '${skill.name}': action[${i}].apply_effect must be a string (effect name) or object {effect, rate?}`);
                    }
                }
                continue;
            }
            throw new Error(`Invalid skill '${skill.name}': action[${i}] must be a string or single-key object`);
        }
        if (skill.cost !== undefined) {
            if (typeof skill.cost !== 'object' || Array.isArray(skill.cost) || skill.cost === null) {
                throw new Error(`Invalid skill '${skill.name}': 'cost' must be an object`);
            }
            for (const [k, v] of Object.entries(skill.cost)) {
                if (typeof v !== 'number' && typeof v !== 'string') {
                    throw new Error(`Invalid skill '${skill.name}': cost.${k} must be a number or formula string`);
                }
            }
        }
        if (skill.mastery !== undefined) {
            if (!Array.isArray(skill.mastery)) {
                throw new Error(`Invalid skill '${skill.name}': 'mastery' must be an array`);
            }
            for (let i = 0; i < skill.mastery.length; i++) {
                const m = skill.mastery[i];
                if (!m || typeof m !== 'object') {
                    throw new Error(`Invalid skill '${skill.name}': mastery[${i}] must be an object`);
                }
                const hasExact = typeof m.exact === 'number';
                const hasLeast = typeof m.least === 'number';
                if (!hasExact && !hasLeast) {
                    throw new Error(`Invalid skill '${skill.name}': mastery[${i}] must have 'exact' or 'least'`);
                }
                if (hasExact && hasLeast) {
                    throw new Error(`Invalid skill '${skill.name}': mastery[${i}] cannot have both 'exact' and 'least'`);
                }
                const level = hasExact ? m.exact : m.least;
                if (!Number.isInteger(level) || level <= 0) {
                    throw new Error(`Invalid skill '${skill.name}': mastery[${i}] level must be a positive integer`);
                }
                if (hasLeast) {
                    if (typeof m.rate !== 'number' || m.rate < 0 || m.rate > 1) {
                        throw new Error(`Invalid skill '${skill.name}': mastery[${i}].rate must be a number in [0, 1]`);
                    }
                }
            }
        }
    }

    getSkills(): SkillDefinition[] {
        return this.store.getAll();
    }

    getSkill(name: string): SkillDefinition | undefined {
        return this.store.getByName(name);
    }

    getSkillNames(): string[] {
        return this.store.getNames();
    }

    hasSkill(name: string): boolean {
        return this.store.has(name);
    }

    /**
     * コンパイル済みスキル（コスト式パース済み）を取得する
     */
    getCompiledSkill(name: string): CompiledSkill | undefined {
        return this.compiledByName.get(name);
    }

    /**
     * `exact: N` を `{ least: N, rate: 1 }` に展開して正規化した mastery 配列を返す。
     * validation で `exact` または `least + rate` のいずれかが保証されているため、
     * 戻り値のエントリは必ず `least` と `rate` の両方を持つ。
     */
    getNormalizedMastery(skillName: string): Array<{ least: number; rate: number }> {
        const def = this.getSkill(skillName);
        if (!def?.mastery) return [];
        return def.mastery.map(SkillsLoader.normalizeMasteryEntry);
    }

    private static normalizeMasteryEntry(m: SkillMasteryEntry): { least: number; rate: number } {
        if (m.exact !== undefined) return { least: m.exact, rate: 1 };
        return { least: m.least!, rate: m.rate! };
    }
}

export type { CompiledSkill };
