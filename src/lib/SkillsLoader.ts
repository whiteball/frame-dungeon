import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';

export type SkillTarget = 'front' | 'around' | 'room' | 'map' | 'self';

const VALID_TARGETS: ReadonlySet<SkillTarget> = new Set<SkillTarget>(['front', 'around', 'room', 'map', 'self']);

/**
 * スキル内 action 配列の 1 エントリ
 * - 文字列の場合：パラメータなしのアクション（例: 'attack', 'reveal_trap'）
 * - オブジェクトの場合：単一キーオブジェクト（例: { damage: 30 }, { heal: 'life_max * 0.3' }）
 */
export type SkillActionEntry = string | { [actionName: string]: number | string };

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
    target: SkillTarget;
    cost?: Record<string, number | string>;
    action: SkillActionEntry[];
    mastery?: SkillMasteryEntry[];
}

export class SkillsLoader {
    private static instance: SkillsLoader;
    private store = new YamlDefinitionStore<SkillDefinition>();

    private constructor() {}

    static getInstance(): SkillsLoader {
        if (!this.instance) {
            this.instance = new SkillsLoader();
        }
        return this.instance;
    }

    async loadSkills(): Promise<void> {
        const customText = CustomDataStore.get('skills');
        await this.store.load('/data/skills.yml', 'スキル', s => this.validateSkill(s), { customText });
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
        if (!skill.target || !VALID_TARGETS.has(skill.target)) {
            throw new Error(`Invalid skill '${skill.name}': 'target' must be one of ${Array.from(VALID_TARGETS).join(', ')}`);
        }
        if (!Array.isArray(skill.action) || skill.action.length === 0) {
            throw new Error(`Invalid skill '${skill.name}': 'action' must be a non-empty array`);
        }
        for (let i = 0; i < skill.action.length; i++) {
            const entry = skill.action[i];
            if (typeof entry === 'string') continue;
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                const keys = Object.keys(entry);
                if (keys.length !== 1) {
                    throw new Error(`Invalid skill '${skill.name}': action[${i}] object must have exactly one key`);
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
}
