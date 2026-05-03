import { YamlDefinitionStore } from './YamlDefinitionStore';

export type TrapEffectType = 'stat' | 'addEffect' | 'unequip';

/**
 * トラップの効果スペック
 * - stat: target で指定したステータスに value を加算（負値で減算/ダメージ）
 * - addEffect: value は string（effects.yml の effect 名）
 * - unequip: value/target は不要
 */
export interface TrapEffect {
    type: TrapEffectType;
    target?: string;
    value?: string | number;
}

/**
 * traps.yml の 1 エントリ
 */
export interface TrapDefinition {
    name: string;
    label: string;
    description: string;
    effect: TrapEffect[];
}

const KNOWN_EFFECT_TYPES: ReadonlySet<string> = new Set(['stat', 'addEffect', 'unequip']);

export class TrapsLoader {
    private static instance: TrapsLoader;
    private store = new YamlDefinitionStore<TrapDefinition>();

    private constructor() { }

    static getInstance(): TrapsLoader {
        if (!this.instance) {
            this.instance = new TrapsLoader();
        }
        return this.instance;
    }

    async loadTraps(): Promise<void> {
        await this.store.load('/data/traps.yml', 'トラップ', trap => this.validateTrapDefinition(trap));
    }

    private validateTrapDefinition(trap: any): void {
        if (!trap.name || typeof trap.name !== 'string') {
            throw new Error(`Invalid trap: missing or invalid 'name' field`);
        }
        if (!trap.label || typeof trap.label !== 'string') {
            throw new Error(`Invalid trap '${trap.name}': missing or invalid 'label' field`);
        }
        if (!trap.description || typeof trap.description !== 'string') {
            throw new Error(`Invalid trap '${trap.name}': missing or invalid 'description' field`);
        }
        if (!Array.isArray(trap.effect)) {
            throw new Error(`Invalid trap '${trap.name}': 'effect' must be an array`);
        }
        for (let i = 0; i < trap.effect.length; i++) {
            const e = trap.effect[i];
            if (!e || typeof e !== 'object') {
                throw new Error(`Invalid trap '${trap.name}': effect[${i}] must be an object`);
            }
            if (typeof e.type !== 'string') {
                throw new Error(`Invalid trap '${trap.name}': effect[${i}].type must be a string`);
            }
            if (!KNOWN_EFFECT_TYPES.has(e.type)) {
                console.warn(`Trap '${trap.name}': effect[${i}].type "${e.type}" is unknown and will be ignored at runtime`);
                continue;
            }
            if (e.type === 'stat') {
                if (typeof e.target !== 'string') {
                    throw new Error(`Invalid trap '${trap.name}': effect[${i}].target must be a string for type 'stat'`);
                }
                if (typeof e.value !== 'number') {
                    throw new Error(`Invalid trap '${trap.name}': effect[${i}].value must be a number for type 'stat'`);
                }
            }
            if (e.type === 'addEffect' && typeof e.value !== 'string') {
                throw new Error(`Invalid trap '${trap.name}': effect[${i}].value must be a string for type 'addEffect'`);
            }
        }
    }

    getTraps(): TrapDefinition[] {
        return this.store.getAll();
    }

    getTrap(name: string): TrapDefinition | undefined {
        return this.store.getByName(name);
    }

    getTrapNames(): string[] {
        return this.store.getNames();
    }

    getRandomTrap(): TrapDefinition | undefined {
        const traps = this.store.getAll();
        if (traps.length === 0) return undefined;
        return traps[Math.floor(Math.random() * traps.length)];
    }
}
