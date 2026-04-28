import yaml from 'js-yaml';

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
    private traps: TrapDefinition[] = [];
    private trapsByName: Map<string, TrapDefinition> = new Map();

    private constructor() { }

    static getInstance(): TrapsLoader {
        if (!this.instance) {
            this.instance = new TrapsLoader();
        }
        return this.instance;
    }

    async loadTraps(): Promise<void> {
        try {
            const response = await fetch('/data/traps.yml');
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }

            const yamlText = await response.text();
            if (!yamlText.trim()) {
                throw new Error('traps.yml is empty');
            }

            const parsed = yaml.load(yamlText) as TrapDefinition[];
            if (!Array.isArray(parsed) || parsed.length === 0) {
                throw new Error('traps.yml does not contain valid trap definitions');
            }

            for (const trap of parsed) {
                this.validateTrapDefinition(trap);
            }

            this.traps = parsed;
            this.trapsByName.clear();

            for (const trap of this.traps) {
                this.trapsByName.set(trap.name, trap);
            }
        } catch (error) {
            console.error('Failed to load traps.yml:', error);
            alert(`トラップデータの読み込みに失敗しました。\n\n` +
                `public/data/traps.yml ファイルが正しく配置されており、\n` +
                `内容が正しい形式であることを確認してください。\n\n` +
                `エラー詳細: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
        }
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
        return [...this.traps];
    }

    getTrap(name: string): TrapDefinition | undefined {
        return this.trapsByName.get(name);
    }

    getTrapNames(): string[] {
        return this.traps.map(t => t.name);
    }

    getRandomTrap(): TrapDefinition | undefined {
        if (this.traps.length === 0) return undefined;
        return this.traps[Math.floor(Math.random() * this.traps.length)];
    }
}
