import { Parser, type Expression } from 'expr-eval-fork';
import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';
import { parseAppearance } from './AppearanceSpec';
import type { AppearanceSpec } from './AppearanceSpec';

/**
 * 選択肢メニュー上限。`SceneModeController.enterEventChoiceMode` の
 * シーンアクションボタン（1〜0 ショートカット）と整合。
 */
export const MAX_EVENT_CHOICES = 10;

/**
 * イベント内 action 配列の 1 エントリ。
 *
 * - 文字列：パラメータなしのアクション（例: `'attack'`, `'reveal_trap'`, `'self_destruct'`）
 * - スカラー値オブジェクト：`{ damage: 30 }`, `{ heal: 'life_max * 0.5' }`, `{ message: '...' }`
 * - オブジェクト値オブジェクト：`{ apply_effect: { effect: 'poison', rate: 0.5 } }`,
 *   `{ give_item: { name: 'potion', count: 1 } }`, `{ spawn_enemy: { name: 'goblin', count: 1, near: 'around' } }`
 *
 * skills.yml の action と互換しつつ、イベント固有 action（give_item / spawn_enemy /
 * message / self_destruct / learn_skill / execute_skill / add_modifier / remove_modifier_kind）
 * を追加で許容する。実際の派遣は `EventExecutor` が行う。
 */
export type EventActionEntry = string | { [actionName: string]: number | string | Record<string, unknown> };

/** 選択肢メニューの 1 エントリ */
export interface EventChoice {
    label: string;
    /** skills と同じ formula 記法（実効値 + `<stat>_max` を露出） */
    cost?: Record<string, number | string>;
    /**
     * 確率分岐の判定式（0..1）。指定時は `on_success` / `on_fail` を要求し、
     * `action` は指定不可。未指定時は `action` を要求。
     */
    rate?: number | string;
    /** rate 未指定時の実行内容 */
    action?: EventActionEntry[];
    /** rate 指定時の成功側分岐 */
    on_success?: EventActionEntry[];
    /** rate 指定時の失敗側分岐 */
    on_fail?: EventActionEntry[];
}

/** ランダム結果（メニュー無し）の 1 エントリ */
export interface RandomOutcomeEntry {
    weight: number;
    label?: string;
    action: EventActionEntry[];
}

/**
 * events.yml の 1 エントリ。
 *
 * 結末指定は以下の 3 種のうちちょうど 1 つを指定する：
 * - `action`：選択肢なしで即実行
 * - `random_outcome`：重み付き抽選で 1 件選んで実行
 * - `choices`：選択肢メニューを表示（最大 {@link MAX_EVENT_CHOICES}）
 */
export interface EventDefinition {
    name: string;
    label: string;
    description?: string;
    /** 調査時に必ずメッセージログに出すフレーバーテキスト */
    flavor: string;
    /** 省略時は既定見た目（`*` + `0x88CCFF` + `sphere`） */
    appearance?: AppearanceSpec;
    /** 進入禁止セル化フラグ（既定 true） */
    blocking?: boolean;
    action?: EventActionEntry[];
    random_outcome?: RandomOutcomeEntry[];
    choices?: EventChoice[];
}

/** コンパイル済み choice */
export interface CompiledEventChoice {
    choice: EventChoice;
    /** stat → Expression（cost 式パース済み） */
    cost: Map<string, Expression>;
    /** 数値リテラルなら数値、formula 文字列なら Expression。未指定なら null */
    rate: number | Expression | null;
}

/** コンパイル済みイベント */
export interface CompiledEvent {
    definition: EventDefinition;
    compiledChoices: CompiledEventChoice[];
}

const FINAL_KEYS = ['action', 'random_outcome', 'choices'] as const;

export class EventsLoader {
    private static instance: EventsLoader;
    private store = new YamlDefinitionStore<EventDefinition>();
    private parser: Parser = new Parser();
    private compiledByName: Map<string, CompiledEvent> = new Map();

    private constructor() {}

    static getInstance(): EventsLoader {
        if (!this.instance) {
            this.instance = new EventsLoader();
        }
        return this.instance;
    }

    async loadEvents(): Promise<void> {
        this.compiledByName.clear();
        const customText = CustomDataStore.get('events');
        await this.store.load(
            `${import.meta.env.BASE_URL}data/events.yml`,
            'イベント',
            ev => this.validateEvent(ev),
            { customText },
        );
        for (const ev of this.store.getAll()) {
            this.compiledByName.set(ev.name, this.compile(ev));
        }
    }

    private compile(def: EventDefinition): CompiledEvent {
        const compiledChoices: CompiledEventChoice[] = [];
        for (const ch of def.choices ?? []) {
            const cost = new Map<string, Expression>();
            if (ch.cost) {
                for (const [stat, formulaOrNum] of Object.entries(ch.cost)) {
                    const src = typeof formulaOrNum === 'number' ? String(formulaOrNum) : formulaOrNum;
                    try {
                        cost.set(stat, this.parser.parse(src));
                    } catch (e) {
                        console.warn(`Failed to parse cost formula "${src}" for event "${def.name}":`, e);
                    }
                }
            }
            let rate: number | Expression | null = null;
            if (typeof ch.rate === 'number') {
                rate = ch.rate;
            } else if (typeof ch.rate === 'string') {
                try {
                    rate = this.parser.parse(ch.rate);
                } catch (e) {
                    console.warn(`Failed to parse rate formula "${ch.rate}" for event "${def.name}":`, e);
                }
            }
            compiledChoices.push({ choice: ch, cost, rate });
        }
        return { definition: def, compiledChoices };
    }

    private validateEvent(ev: any): void {
        if (!ev.name || typeof ev.name !== 'string') {
            throw new Error(`Invalid event: missing or invalid 'name' field`);
        }
        if (!ev.label || typeof ev.label !== 'string') {
            throw new Error(`Invalid event '${ev.name}': missing or invalid 'label' field`);
        }
        if (ev.description !== undefined && typeof ev.description !== 'string') {
            throw new Error(`Invalid event '${ev.name}': 'description' must be a string if specified`);
        }
        if (!ev.flavor || typeof ev.flavor !== 'string') {
            throw new Error(`Invalid event '${ev.name}': 'flavor' must be a non-empty string`);
        }
        if (ev.blocking !== undefined && typeof ev.blocking !== 'boolean') {
            throw new Error(`Invalid event '${ev.name}': 'blocking' must be a boolean if specified`);
        }
        if (ev.appearance !== undefined) {
            ev.appearance = parseAppearance(ev.appearance, `events.yml '${ev.name}'`);
        }

        // 結末指定（action / random_outcome / choices）の排他チェック
        const finalKeysPresent = FINAL_KEYS.filter(k => ev[k] !== undefined);
        if (finalKeysPresent.length === 0) {
            throw new Error(`Invalid event '${ev.name}': 結末として 'action' / 'random_outcome' / 'choices' のいずれか 1 つを指定してください`);
        }
        if (finalKeysPresent.length > 1) {
            throw new Error(`Invalid event '${ev.name}': 'action' / 'random_outcome' / 'choices' は同時に指定できません (got: ${finalKeysPresent.join(', ')})`);
        }

        if (ev.action !== undefined) {
            this.validateActionArray(ev.action, `event '${ev.name}'.action`);
        }
        if (ev.random_outcome !== undefined) {
            if (!Array.isArray(ev.random_outcome) || ev.random_outcome.length === 0) {
                throw new Error(`Invalid event '${ev.name}': 'random_outcome' must be a non-empty array`);
            }
            for (let i = 0; i < ev.random_outcome.length; i++) {
                const r = ev.random_outcome[i];
                const ctx = `event '${ev.name}'.random_outcome[${i}]`;
                if (!r || typeof r !== 'object') {
                    throw new Error(`Invalid ${ctx}: must be an object`);
                }
                if (typeof r.weight !== 'number' || !isFinite(r.weight) || r.weight <= 0) {
                    throw new Error(`Invalid ${ctx}: 'weight' must be a positive number`);
                }
                if (r.label !== undefined && typeof r.label !== 'string') {
                    throw new Error(`Invalid ${ctx}: 'label' must be a string if specified`);
                }
                if (!Array.isArray(r.action)) {
                    throw new Error(`Invalid ${ctx}: 'action' must be an array`);
                }
                this.validateActionArray(r.action, `${ctx}.action`);
            }
        }
        if (ev.choices !== undefined) {
            if (!Array.isArray(ev.choices) || ev.choices.length === 0) {
                throw new Error(`Invalid event '${ev.name}': 'choices' must be a non-empty array`);
            }
            if (ev.choices.length > MAX_EVENT_CHOICES) {
                throw new Error(`Invalid event '${ev.name}': 'choices' は最大 ${MAX_EVENT_CHOICES} 個までです (got: ${ev.choices.length})`);
            }
            for (let i = 0; i < ev.choices.length; i++) {
                const c = ev.choices[i];
                const ctx = `event '${ev.name}'.choices[${i}]`;
                if (!c || typeof c !== 'object') {
                    throw new Error(`Invalid ${ctx}: must be an object`);
                }
                if (!c.label || typeof c.label !== 'string') {
                    throw new Error(`Invalid ${ctx}: 'label' must be a non-empty string`);
                }
                if (c.cost !== undefined) {
                    if (typeof c.cost !== 'object' || Array.isArray(c.cost) || c.cost === null) {
                        throw new Error(`Invalid ${ctx}: 'cost' must be an object`);
                    }
                    for (const [k, v] of Object.entries(c.cost)) {
                        if (typeof v !== 'number' && typeof v !== 'string') {
                            throw new Error(`Invalid ${ctx}: cost.${k} must be a number or formula string`);
                        }
                    }
                }
                const hasRate = c.rate !== undefined;
                const hasAction = c.action !== undefined;
                const hasSuccess = c.on_success !== undefined;
                const hasFail = c.on_fail !== undefined;
                if (hasRate) {
                    if (typeof c.rate === 'number') {
                        if (c.rate < 0 || c.rate > 1) {
                            throw new Error(`Invalid ${ctx}: 'rate' は 0..1 の数値を指定してください`);
                        }
                    } else if (typeof c.rate === 'string') {
                        try {
                            this.parser.parse(c.rate);
                        } catch {
                            throw new Error(`Invalid ${ctx}: 'rate' formula parse error: "${c.rate}"`);
                        }
                    } else {
                        throw new Error(`Invalid ${ctx}: 'rate' must be a number or formula string`);
                    }
                    if (hasAction) {
                        throw new Error(`Invalid ${ctx}: 'rate' 指定時は 'action' ではなく 'on_success' / 'on_fail' を指定してください`);
                    }
                    if (!hasSuccess || !hasFail) {
                        throw new Error(`Invalid ${ctx}: 'rate' 指定時は 'on_success' と 'on_fail' の両方が必要です`);
                    }
                    this.validateActionArray(c.on_success!, `${ctx}.on_success`);
                    this.validateActionArray(c.on_fail!, `${ctx}.on_fail`);
                } else {
                    if (hasSuccess || hasFail) {
                        throw new Error(`Invalid ${ctx}: 'on_success' / 'on_fail' は 'rate' 指定時のみ使用できます`);
                    }
                    if (!hasAction) {
                        throw new Error(`Invalid ${ctx}: 'action' を指定してください（空配列 [] で「何もしない」も可）`);
                    }
                    this.validateActionArray(c.action!, `${ctx}.action`);
                }
            }
        }
    }

    private validateActionArray(arr: any, context: string): void {
        if (!Array.isArray(arr)) {
            throw new Error(`Invalid ${context}: must be an array`);
        }
        for (let i = 0; i < arr.length; i++) {
            const entry = arr[i];
            if (typeof entry === 'string') continue;
            if (entry && typeof entry === 'object' && !Array.isArray(entry)) {
                const keys = Object.keys(entry);
                if (keys.length !== 1) {
                    throw new Error(`Invalid ${context}[${i}]: object must have exactly one key`);
                }
                // 値の構造的検証は EventExecutor の各 action 実装に委ねる（skills と同じ方針）。
                // YamlCrossValidator でクロス参照のみ検証する。
                continue;
            }
            throw new Error(`Invalid ${context}[${i}]: must be a string or single-key object`);
        }
    }

    getEvents(): EventDefinition[] {
        return this.store.getAll();
    }

    getEvent(name: string): EventDefinition | undefined {
        return this.store.getByName(name);
    }

    getEventNames(): string[] {
        return this.store.getNames();
    }

    has(name: string): boolean {
        return this.store.has(name);
    }

    getCompiledEvent(name: string): CompiledEvent | undefined {
        return this.compiledByName.get(name);
    }
}
