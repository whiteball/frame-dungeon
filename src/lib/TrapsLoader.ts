import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';
import { MapMark, MapShape } from './MapObject';
import type { MapMark as MapMarkType, MapShape as MapShapeType } from './MapObject';

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
 * 見た目（MapObject 表示プロパティ）のパース済みスペック。
 * mark / shape は YAML のフレンドリ名から定数値に正規化済み。
 * color は数値 (0xRRGGBB) または '#RRGGBB' 文字列を数値に正規化済み。
 */
export interface AppearanceSpec {
    mark?: MapMarkType;
    color?: integer;
    shape?: MapShapeType;
    concentricCircle?: boolean;
}

/**
 * traps.yml の 1 エントリ
 */
export interface TrapDefinition {
    name: string;
    label: string;
    description: string;
    effect: TrapEffect[];
    /** 省略時は false（従来通り隠れ罠）。true で最初から見える */
    visible?: boolean;
    /** 省略時は赤×ピラミッドの既定見た目（TrapObject コンストラクタ既定値） */
    appearance?: AppearanceSpec;
}

const KNOWN_EFFECT_TYPES: ReadonlySet<string> = new Set(['stat', 'addEffect', 'unequip']);

const MAP_MARK_VALUES: ReadonlySet<string> = new Set(Object.values(MapMark));

/**
 * YAML 上のフレンドリ shape 名 → MapShape 定数値。
 * 既存の MapShape は内部値が '5_sphere' 等のソート用 prefix 付きなので、
 * 人間が書きやすい 'sphere' / 'cube' / ... を受け付けて解決する。
 */
const MAP_SHAPE_ALIAS: ReadonlyMap<string, MapShapeType> = new Map([
    ['none', MapShape.NONE],
    ['sphere', MapShape.SPHERE],
    ['cube', MapShape.CUBE],
    ['box', MapShape.BOX],
    ['cylinder', MapShape.CYLINDER],
    ['pyramid', MapShape.PYRAMID],
]);

/**
 * appearance.color を数値 (integer) に正規化する。
 * 数値リテラル (0xRRGGBB)、'#RRGGBB' / '#RGB'、'0xRRGGBB' 文字列を受け付ける。
 */
function parseColor(raw: unknown, context: string): integer {
    if (typeof raw === 'number' && isFinite(raw) && raw >= 0 && raw <= 0xFFFFFF) {
        return Math.floor(raw);
    }
    if (typeof raw === 'string') {
        let hex = raw.trim();
        if (hex.startsWith('#')) hex = hex.slice(1);
        else if (hex.startsWith('0x') || hex.startsWith('0X')) hex = hex.slice(2);
        if (hex.length === 3) {
            // '#RGB' → '#RRGGBB'
            hex = hex.split('').map(c => c + c).join('');
        }
        if (/^[0-9a-fA-F]{6}$/.test(hex)) {
            return parseInt(hex, 16);
        }
    }
    throw new Error(`${context}: color は 0xRRGGBB 数値または '#RRGGBB' / '#RGB' 文字列を指定してください (got: ${JSON.stringify(raw)})`);
}

/**
 * appearance オブジェクトを正規化する。フィールド不正は throw。
 */
export function parseAppearance(raw: any, context: string): AppearanceSpec {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
        throw new Error(`${context}: appearance はオブジェクトである必要があります`);
    }
    const out: AppearanceSpec = {};
    if (raw.mark !== undefined) {
        if (typeof raw.mark !== 'string' || !MAP_MARK_VALUES.has(raw.mark)) {
            throw new Error(`${context}: appearance.mark は ${[...MAP_MARK_VALUES].map(v => `'${v}'`).join(' / ')} のいずれかを指定してください (got: ${JSON.stringify(raw.mark)})`);
        }
        out.mark = raw.mark as MapMarkType;
    }
    if (raw.color !== undefined) {
        out.color = parseColor(raw.color, `${context}.color`);
    }
    if (raw.shape !== undefined) {
        if (typeof raw.shape !== 'string' || !MAP_SHAPE_ALIAS.has(raw.shape)) {
            throw new Error(`${context}: appearance.shape は ${[...MAP_SHAPE_ALIAS.keys()].map(v => `'${v}'`).join(' / ')} のいずれかを指定してください (got: ${JSON.stringify(raw.shape)})`);
        }
        out.shape = MAP_SHAPE_ALIAS.get(raw.shape)!;
    }
    const concentric = raw.concentric_circle ?? raw.concentricCircle;
    if (concentric !== undefined) {
        if (typeof concentric !== 'boolean') {
            throw new Error(`${context}: appearance.concentric_circle は boolean を指定してください (got: ${JSON.stringify(concentric)})`);
        }
        out.concentricCircle = concentric;
    }
    return out;
}

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
        const customText = CustomDataStore.get('traps');
        await this.store.load(`${import.meta.env.BASE_URL}data/traps.yml`, 'トラップ', trap => this.validateTrapDefinition(trap), { customText });
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
        if (trap.visible !== undefined && typeof trap.visible !== 'boolean') {
            throw new Error(`Invalid trap '${trap.name}': 'visible' must be a boolean if specified`);
        }
        if (trap.appearance !== undefined) {
            trap.appearance = parseAppearance(trap.appearance, `traps.yml '${trap.name}'`);
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
