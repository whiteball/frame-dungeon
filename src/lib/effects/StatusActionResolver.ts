/**
 * 状態異常 `_action`（onAction）のアクションツリー解決ロジック。
 *
 * effects.yml の `timing.onAction.target: _action` の `value` を、行動を強制（force）または
 * 一部行動を禁止（forbid）するアクションノードのツリーとして解釈する。
 *
 * このモジュールは **副作用を持たない純粋関数のみ** を公開し、EffectsLoader 等の実行系を
 * import しない（循環参照回避。EffectsLoader 側がここの parseActionValue を import する一方向）。
 */

// ── カテゴリ・verb 定義 ──────────────────────────────────────────────

/** プレイヤーの行動カテゴリ（forbid 判定の単位）。investigate に「調べる」「足下」を含む。 */
export type ActionCategory = 'move' | 'attack' | 'skill' | 'item' | 'equip' | 'investigate';

/** 行動を強制する verb（ターン消費・入力上書き）。 */
export const FORCE_VERBS = [
    'skip', 'use_item', 'equip', 'unequip', 'attack', 'use_skill', 'attack_self', 'move',
] as const;
export type ForceVerb = typeof FORCE_VERBS[number];

/** 一部行動を禁止する verb（ターン非消費・入力拒否）。 */
export const FORBID_VERBS = ['not_move', 'not_skill', 'not_attack', 'not_action'] as const;
export type ForbidVerb = typeof FORBID_VERBS[number];

/** アクション配列を組み合わせる combinator verb。 */
export const COMBINATOR_VERBS = ['random', 'repeat'] as const;

/** move アクションの方向トークン（相対）。 */
export const MOVE_TOKENS = ['forward', 'back', 'left', 'right'] as const;
export type MoveToken = typeof MOVE_TOKENS[number];

/** unequip アクションの装備スロット名。 */
export const SLOT_TOKENS = ['weapon', 'main_armor', 'sub_armor1', 'sub_armor2'] as const;
export type SlotToken = typeof SLOT_TOKENS[number];

function isForceVerb(v: string): v is ForceVerb {
    return (FORCE_VERBS as readonly string[]).includes(v);
}
function isForbidVerb(v: string): v is ForbidVerb {
    return (FORBID_VERBS as readonly string[]).includes(v);
}
function isCombinatorVerb(v: string): boolean {
    return (COMBINATOR_VERBS as readonly string[]).includes(v);
}

// ── コンパイル済みアクションツリー ─────────────────────────────────────

export type CompiledActionNode =
    | { kind: 'force'; verb: ForceVerb; arg?: string }
    | { kind: 'forbid'; verb: ForbidVerb; message?: string }
    | { kind: 'random'; children: CompiledActionNode[] }
    | { kind: 'repeat'; children: CompiledActionNode[] };

/** resolveLeaf が返す末端アクション（random/repeat を解決済み）。 */
export type ResolvedLeaf =
    | { kind: 'force'; verb: ForceVerb; arg?: string }
    | { kind: 'forbid'; verb: ForbidVerb; message?: string };

/** 複数効果を集約した、その手番のプレイヤーディレクティブ。 */
export interface AggregatedDirective {
    /** 禁止カテゴリ → 表示メッセージ（最初に該当した効果のもの）。 */
    forbid: Map<ActionCategory, string | undefined>;
    /** 実行すべき強制行動（先頭の force、forbid に上書きされた場合 skip）。 */
    force?: { verb: ForceVerb; arg?: string };
}

// ── verb → カテゴリ写像 ────────────────────────────────────────────

/** force verb が属するカテゴリ（forbid 上書き判定用）。skip は降格対象外のため空集合。 */
export function forceCategories(verb: ForceVerb): ActionCategory[] {
    switch (verb) {
        case 'attack':
        case 'attack_self': return ['attack'];
        case 'use_skill': return ['skill'];
        case 'use_item': return ['item'];
        case 'equip':
        case 'unequip': return ['equip'];
        case 'move': return ['move'];
        case 'skip': return [];
    }
}

/** not_* verb が禁止するカテゴリ集合。 */
export function forbidCategories(verb: ForbidVerb): ActionCategory[] {
    switch (verb) {
        case 'not_move': return ['move'];
        case 'not_skill': return ['skill'];
        case 'not_attack': return ['attack', 'skill', 'investigate'];
        case 'not_action': return ['attack', 'skill', 'investigate', 'item', 'equip'];
    }
}

// ── パース（raw value → CompiledActionNode[]）─────────────────────────

interface ParseCtx {
    topLevel: boolean;
    isLastTop: boolean;
    insideCombinator: boolean;
    path: string;
}

/**
 * raw な onAction.value を CompiledActionNode のリストへ正規化する。
 * - string/number → 単一ノードのリスト（後方互換: `value: skip`）
 * - array → ノードのリスト（各要素がノード。引数付き単一行動は 1 要素リストで書く）
 * 構造エラーは errors に積む（クロス参照は別途 validateActionValue で行う）。
 */
export function parseActionValue(raw: unknown): { tree: CompiledActionNode[]; errors: string[] } {
    const errors: string[] = [];
    if (raw === undefined || raw === null) return { tree: [], errors };

    const rawList: unknown[] = Array.isArray(raw) ? raw : [raw];
    const tree: CompiledActionNode[] = [];
    for (let i = 0; i < rawList.length; i++) {
        const node = parseNode(rawList[i], {
            topLevel: true,
            isLastTop: i === rawList.length - 1,
            insideCombinator: false,
            path: `value[${i}]`,
        }, errors);
        if (node) tree.push(node);
    }
    return { tree, errors };
}

function parseNode(raw: unknown, ctx: ParseCtx, errors: string[]): CompiledActionNode | null {
    // 文字列（引数なし verb）
    if (typeof raw === 'string') {
        return parseVerbLeaf(raw, undefined, ctx, errors);
    }
    if (typeof raw === 'number') {
        errors.push(`${ctx.path}: 数値 "${raw}" はアクションとして無効です`);
        return null;
    }
    if (!Array.isArray(raw)) {
        errors.push(`${ctx.path}: アクションは文字列または配列である必要があります`);
        return null;
    }

    // 配列ノード： [verb] / [verb, arg] / [random|repeat, [...]]
    const first = raw[0];
    if (typeof first !== 'string') {
        errors.push(`${ctx.path}: アクション配列の先頭は verb 文字列である必要があります`);
        return null;
    }

    if (isCombinatorVerb(first)) {
        return parseCombinator(first, raw, ctx, errors);
    }

    if (raw.length > 2) {
        errors.push(`${ctx.path}: "${first}" の引数は 1 つまでです`);
    }
    const arg = raw.length >= 2 ? raw[1] : undefined;
    if (arg !== undefined && typeof arg !== 'string') {
        errors.push(`${ctx.path}: "${first}" の引数は文字列である必要があります`);
        return parseVerbLeaf(first, undefined, ctx, errors);
    }
    return parseVerbLeaf(first, arg as string | undefined, ctx, errors);
}

function parseVerbLeaf(verb: string, arg: string | undefined, ctx: ParseCtx, errors: string[]): CompiledActionNode | null {
    if (isForceVerb(verb)) {
        return arg !== undefined ? { kind: 'force', verb, arg } : { kind: 'force', verb };
    }
    if (isForbidVerb(verb)) {
        if (ctx.insideCombinator) {
            errors.push(`${ctx.path}: 禁止系 "${verb}" は random/repeat の中に置けません（force 系のみ）`);
            return null;
        }
        if (!ctx.topLevel) {
            errors.push(`${ctx.path}: 禁止系 "${verb}" は top-level のみ指定できます`);
            return null;
        }
        return arg !== undefined ? { kind: 'forbid', verb, message: arg } : { kind: 'forbid', verb };
    }
    if (isCombinatorVerb(verb)) {
        errors.push(`${ctx.path}: "${verb}" はアクション配列 [${verb}, [...]] の形式で指定してください`);
        return null;
    }
    errors.push(`${ctx.path}: 未知のアクション "${verb}"`);
    return null;
}

function parseCombinator(verb: string, raw: unknown[], ctx: ParseCtx, errors: string[]): CompiledActionNode | null {
    if (verb === 'repeat') {
        if (ctx.insideCombinator) {
            errors.push(`${ctx.path}: repeat は入れ子にできません`);
            return null;
        }
        if (!ctx.topLevel || !ctx.isLastTop) {
            errors.push(`${ctx.path}: repeat は top-level の末尾要素のみ指定できます`);
            return null;
        }
    }
    const sub = raw[1];
    if (!Array.isArray(sub)) {
        errors.push(`${ctx.path}: "${verb}" は [${verb}, [サブアクション...]] の形式である必要があります`);
        return null;
    }
    const children: CompiledActionNode[] = [];
    for (let i = 0; i < sub.length; i++) {
        const child = parseNode(sub[i], {
            topLevel: false,
            isLastTop: false,
            insideCombinator: true,
            path: `${ctx.path}.${verb}[${i}]`,
        }, errors);
        if (child) children.push(child);
    }
    return verb === 'repeat' ? { kind: 'repeat', children } : { kind: 'random', children };
}

// ── 解決（actionIndex → ResolvedLeaf）─────────────────────────────────

/**
 * actionTree から actionIndex に対応する末端アクションを解決する（純粋・副作用なし）。
 * - top-level は min(actionIndex, lastIndex) で要素を選ぶ（末尾要素を反復）
 * - random は毎回一様抽選、repeat は (actionIndex - nodeIndex) mod サブ長 で巡回
 */
export function resolveLeaf(
    tree: CompiledActionNode[],
    actionIndex: number,
    rng: () => number = Math.random,
): ResolvedLeaf | null {
    if (tree.length === 0) return null;
    const lastIndex = tree.length - 1;
    const i = Math.min(Math.max(actionIndex, 0), lastIndex);
    return resolveNode(tree[i], actionIndex, i, rng);
}

function resolveNode(
    node: CompiledActionNode,
    actionIndex: number,
    nodeIndex: number,
    rng: () => number,
): ResolvedLeaf | null {
    switch (node.kind) {
        case 'force': return node.arg !== undefined
            ? { kind: 'force', verb: node.verb, arg: node.arg }
            : { kind: 'force', verb: node.verb };
        case 'forbid': return node.message !== undefined
            ? { kind: 'forbid', verb: node.verb, message: node.message }
            : { kind: 'forbid', verb: node.verb };
        case 'random': {
            if (node.children.length === 0) return null;
            const pick = node.children[Math.floor(rng() * node.children.length)];
            return resolveNode(pick, actionIndex, nodeIndex, rng);
        }
        case 'repeat': {
            const len = node.children.length;
            if (len === 0) return null;
            const sub = ((actionIndex - nodeIndex) % len + len) % len;
            return resolveNode(node.children[sub], actionIndex, nodeIndex, rng);
        }
    }
}

// ── 集約（複数効果 → AggregatedDirective）─────────────────────────────

/** 集約に必要な onAction spec の最小形（EffectsLoader の CompiledTargetSpec が満たす）。 */
export interface OnActionSpecLike {
    target: string;
    actionTree?: CompiledActionNode[];
}

/**
 * 有効な状態異常群の onAction を集約し、その手番のディレクティブを返す（純粋）。
 * - forbid は和集合（最初に該当した効果のメッセージを保持）
 * - force は activeStatusEffects 並び順で最初の 1 つ
 * - force のカテゴリが forbid 集合に入れば skip へ降格（G-2）
 */
export function aggregateDirective(
    activeEffects: ReadonlyArray<{ name: string; actionIndex: number }>,
    lookup: (name: string) => ReadonlyArray<OnActionSpecLike>,
    rng: () => number = Math.random,
): AggregatedDirective {
    const forbid = new Map<ActionCategory, string | undefined>();
    let force: { verb: ForceVerb; arg?: string } | undefined;

    for (const entry of activeEffects) {
        for (const spec of lookup(entry.name)) {
            if (spec.target !== '_action' || !spec.actionTree) continue;
            const leaf = resolveLeaf(spec.actionTree, entry.actionIndex, rng);
            if (!leaf) continue;
            if (leaf.kind === 'forbid') {
                for (const cat of forbidCategories(leaf.verb)) {
                    if (!forbid.has(cat)) forbid.set(cat, leaf.message);
                }
            } else if (!force) {
                force = leaf.arg !== undefined ? { verb: leaf.verb, arg: leaf.arg } : { verb: leaf.verb };
            }
        }
    }

    // G-2: 禁止が強制を上書き（force のカテゴリが禁止されていれば skip 降格）
    if (force && forceCategories(force.verb).some(c => forbid.has(c))) {
        force = { verb: 'skip' };
    }
    return { forbid, force };
}

// ── バリデーション（起動時クロス参照）─────────────────────────────────

export interface ActionValueValidationDeps {
    /** items.yml に存在するか */
    hasItem: (name: string) => boolean;
    /** skills.yml に active スキルとして存在するか */
    hasActiveSkill: (name: string) => boolean;
}

/**
 * onAction.value の構造＋クロス参照を検証してエラー文字列配列を返す（起動時 YamlCrossValidator から呼ぶ）。
 */
export function validateActionValue(
    raw: unknown,
    ctx: string,
    deps: ActionValueValidationDeps,
): string[] {
    const { tree, errors } = parseActionValue(raw);
    const out = errors.map(e => `${ctx}: ${e}`);
    walkCrossRef(tree, ctx, deps, out);
    return out;
}

function walkCrossRef(
    nodes: CompiledActionNode[],
    ctx: string,
    deps: ActionValueValidationDeps,
    out: string[],
): void {
    for (const node of nodes) {
        if (node.kind === 'random' || node.kind === 'repeat') {
            walkCrossRef(node.children, ctx, deps, out);
            continue;
        }
        if (node.kind !== 'force' || node.arg === undefined) continue;
        switch (node.verb) {
            case 'use_item':
            case 'equip':
                if (!deps.hasItem(node.arg)) {
                    out.push(`${ctx}: "${node.verb}" の引数 "${node.arg}" が items.yml に存在しません`);
                }
                break;
            case 'use_skill':
                if (!deps.hasActiveSkill(node.arg)) {
                    out.push(`${ctx}: "use_skill" の引数 "${node.arg}" が skills.yml の active スキルとして存在しません`);
                }
                break;
            case 'unequip':
                if (!(SLOT_TOKENS as readonly string[]).includes(node.arg)) {
                    out.push(`${ctx}: "unequip" の引数 "${node.arg}" は ${SLOT_TOKENS.join(' / ')} のいずれかである必要があります`);
                }
                break;
            case 'move':
                if (!(MOVE_TOKENS as readonly string[]).includes(node.arg)) {
                    out.push(`${ctx}: "move" の引数 "${node.arg}" は ${MOVE_TOKENS.join(' / ')} のいずれかである必要があります`);
                }
                break;
        }
    }
}
