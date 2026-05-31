import { Parser, type Expression } from 'expr-eval-fork';
import type { Player } from '../Player';

/**
 * イベント系 formula（cost / rate / condition / heal・damage 数式）の parse / evaluate を
 * 一元化するモジュール。
 *
 * ## なぜ専用 Parser が必要か
 * `expr-eval-fork` は **values 経由で渡した関数の呼び出しをデフォルトで拒否**する
 * （`Error: Variable references an unallowed function`）。`has_item` / `item_count` /
 * `has_skill` のようなクエリ関数を formula 内で使うには、**その式を parse した `Parser`
 * インスタンスの `functions` に関数を登録**しておく必要がある。よって全イベント formula は
 * この {@link eventParser} で parse すること（別 Parser で parse した式から呼ぶと evaluate 時に throw）。
 *
 * ## player 文脈の渡し方
 * クエリ関数は評価対象の player を必要とするが、`expr-eval-fork` の関数は引数のみを受け取る。
 * そこでモジュールレベルの {@link currentPlayer} を評価直前にセットし、関数本体はそれを参照する。
 * 評価は同期・単一スレッドで行われるため、{@link evalWithPlayer} で set → 評価 → 復帰すれば安全。
 */

let currentPlayer: Player | null = null;

function asName(arg: unknown): string | null {
    return typeof arg === 'string' ? arg : null;
}

export const eventParser = new Parser();

// formula 内クエリ関数（真偽は 1 / 0 で返す）
eventParser.functions.has_item = (name: unknown): number => {
    const n = asName(name);
    return n && currentPlayer?.getInventory().hasItem(n) ? 1 : 0;
};
eventParser.functions.item_count = (name: unknown): number => {
    const n = asName(name);
    if (!n || !currentPlayer) return 0;
    return currentPlayer.getInventory().getItemCount(n);
};
eventParser.functions.has_skill = (name: unknown): number => {
    const n = asName(name);
    return n && currentPlayer?.hasSkill(n) ? 1 : 0;
};

const cache = new Map<string, Expression>();

/**
 * イベント formula を {@link eventParser} で parse する（結果はキャッシュ）。
 * parse 失敗時は warn して null を返す。
 */
export function compileEventFormula(src: string): Expression | null {
    const cached = cache.get(src);
    if (cached) return cached;
    try {
        const expr = eventParser.parse(src);
        cache.set(src, expr);
        return expr;
    } catch (e) {
        console.warn(`Failed to parse event formula "${src}":`, e);
        return null;
    }
}

/**
 * `currentPlayer` を一時的に `player` へ差し替えて `fn` を実行し、必ず元へ復帰する。
 * イベント formula の評価（`expr.evaluate(...)`）はこの中で行うこと。
 */
export function evalWithPlayer<T>(player: Player, fn: () => T): T {
    const prev = currentPlayer;
    currentPlayer = player;
    try {
        return fn();
    } finally {
        currentPlayer = prev;
    }
}
