import { MapMark, MapShape } from './MapObject';
import type { MapMark as MapMarkType, MapShape as MapShapeType } from './MapObject';

/**
 * 見た目（MapObject 表示プロパティ）のパース済みスペック。
 * mark / shape は YAML のフレンドリ名から定数値に正規化済み。
 * color は数値 (0xRRGGBB) または '#RRGGBB' 文字列を数値に正規化済み。
 *
 * `traps.yml` の `appearance:` や `events.yml` の `appearance:` などで共通に使用される。
 */
export interface AppearanceSpec {
    mark?: MapMarkType;
    color?: integer;
    shape?: MapShapeType;
    concentricCircle?: boolean;
}

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

/**
 * MapObject に AppearanceSpec を適用する。各フィールドは指定があったときのみ上書きする。
 */
export function applyAppearance(obj: { mark: any; color: integer; shape: any; concentricCircle: boolean }, ap: AppearanceSpec | undefined): void {
    if (!ap) return;
    if (ap.mark !== undefined) obj.mark = ap.mark;
    if (ap.color !== undefined) obj.color = ap.color;
    if (ap.shape !== undefined) obj.shape = ap.shape;
    if (ap.concentricCircle !== undefined) obj.concentricCircle = ap.concentricCircle;
}
