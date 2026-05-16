import { Parser, type Expression } from 'expr-eval-fork';
import { YamlDefinitionStore } from './YamlDefinitionStore';
import { CustomDataStore } from './CustomDataStore';

/**
 * 効果（状態異常/強化）の単一ターゲット指定
 * - target: 変化対象パラメータ名。"_action" など "_" 始まりは特殊指定
 * - formula: 式（変数 x = 対象パラメータの現在値）
 * - value: リテラル値（formula と排他、_action: skip などで使用）
 */
export interface EffectTargetSpec {
    target: string;
    formula?: string;
    value?: string | number;
}

/**
 * 解除条件
 * - formula: count を変数とした 0〜1 の確率式
 * - onDamage: true ならダメージ被弾時に即座に解除
 */
export interface EffectClearSpec {
    formula: string;
    onDamage?: boolean;
}

/**
 * 効果定義（effects.yml の 1 エントリ）
 */
export interface EffectDefinition {
    name: string;
    label: string;
    description: string;
    timing: {
        onPlayerAction?: EffectTargetSpec | EffectTargetSpec[];
        onTurnEnd?: EffectTargetSpec | EffectTargetSpec[];
        permanent?: EffectTargetSpec | EffectTargetSpec[];
    };
    clear: EffectClearSpec;
    /**
     * この effect が付与されている間、新規に付与されることを阻止する effect 名の配列
     */
    resist?: string[];
}

export type EffectTiming = 'onPlayerAction' | 'onTurnEnd' | 'permanent';

/**
 * パース済み式キャッシュ用エントリ
 */
interface CompiledTargetSpec {
    target: string;
    formula?: Expression;
    value?: string | number;
}

interface CompiledEffect {
    definition: EffectDefinition;
    onPlayerAction: CompiledTargetSpec[];
    onTurnEnd: CompiledTargetSpec[];
    permanent: CompiledTargetSpec[];
    clearFormula: Expression | null;
    clearOnDamage: boolean;
    resist: string[];
}

export class EffectsLoader {
    private static instance: EffectsLoader;
    private store = new YamlDefinitionStore<EffectDefinition>();
    private compiledByName: Map<string, CompiledEffect> = new Map();
    private parser: Parser = new Parser();

    private constructor() { }

    static getInstance(): EffectsLoader {
        if (!this.instance) {
            this.instance = new EffectsLoader();
        }
        return this.instance;
    }

    async loadEffects(): Promise<void> {
        this.compiledByName.clear();
        const customText = CustomDataStore.get('effects');
        await this.store.load('/data/effects.yml', '状態異常', () => {}, { customText });
        for (const effect of this.store.getAll()) {
            this.compiledByName.set(effect.name, this.compile(effect));
        }
    }

    /**
     * 単一/配列を統一して配列で扱うためのヘルパ
     */
    private static normalizeSpecs(spec?: EffectTargetSpec | EffectTargetSpec[]): EffectTargetSpec[] {
        if (!spec) return [];
        return Array.isArray(spec) ? spec : [spec];
    }

    /**
     * EffectDefinition から実行用の CompiledEffect を生成（formula を事前パース）
     */
    private compile(def: EffectDefinition): CompiledEffect {
        const compileSpecs = (specs: EffectTargetSpec[]): CompiledTargetSpec[] => {
            return specs.map(s => {
                let formula: Expression | undefined;
                if (s.formula !== undefined) {
                    try {
                        formula = this.parser.parse(s.formula);
                    } catch (e) {
                        console.warn(`Failed to parse formula "${s.formula}" in effect "${def.name}":`, e);
                    }
                }
                return { target: s.target, formula, value: s.value };
            });
        };

        let clearFormula: Expression | null = null;
        if (def.clear?.formula) {
            try {
                clearFormula = this.parser.parse(def.clear.formula);
            } catch (e) {
                console.warn(`Failed to parse clear formula "${def.clear.formula}" in effect "${def.name}":`, e);
            }
        }

        return {
            definition: def,
            onPlayerAction: compileSpecs(EffectsLoader.normalizeSpecs(def.timing?.onPlayerAction)),
            onTurnEnd: compileSpecs(EffectsLoader.normalizeSpecs(def.timing?.onTurnEnd)),
            permanent: compileSpecs(EffectsLoader.normalizeSpecs(def.timing?.permanent)),
            clearFormula,
            clearOnDamage: def.clear?.onDamage === true,
            resist: Array.isArray(def.resist) ? [...def.resist] : [],
        };
    }

    /**
     * 指定 effect が付与中に阻止する resist 名一覧を返す
     */
    getResistsOf(name: string): string[] {
        return this.compiledByName.get(name)?.resist ?? [];
    }

    getEffects(): EffectDefinition[] {
        return this.store.getAll();
    }

    getEffect(name: string): EffectDefinition | undefined {
        return this.store.getByName(name);
    }

    getCompiledEffect(name: string): CompiledEffect | undefined {
        return this.compiledByName.get(name);
    }

    hasEffect(name: string): boolean {
        return this.store.has(name);
    }
}

export type { CompiledEffect, CompiledTargetSpec };
