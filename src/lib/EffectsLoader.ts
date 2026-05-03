import yaml from 'js-yaml';
import { Parser, type Expression } from 'expr-eval-fork';

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
}

export class EffectsLoader {
    private static instance: EffectsLoader;
    private effects: EffectDefinition[] = [];
    private effectsByName: Map<string, EffectDefinition> = new Map();
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
        const response = await fetch('/data/effects.yml');
        if (!response.ok) {
            console.log(`effects.yml が見つかりません (HTTP ${response.status})。状態異常なしで続行します。`);
            return;
        }

        const yamlText = await response.text();
        if (!yamlText.trim()) {
            console.log('effects.yml が空です。状態異常なしで続行します。');
            return;
        }

        try {
            const parsed = yaml.load(yamlText) as any;

            if (parsed === null || parsed === undefined) {
                console.log('effects.yml にデータが定義されていません。状態異常なしで続行します。');
                return;
            }

            if (!Array.isArray(parsed)) {
                throw new Error('effects.yml does not contain a valid array');
            }

            if (parsed.length === 0) {
                console.log('effects.yml の状態異常定義が空の配列です。状態異常なしで続行します。');
                return;
            }

            this.effects = parsed;
            this.effectsByName.clear();
            this.compiledByName.clear();

            for (const effect of this.effects) {
                this.effectsByName.set(effect.name, effect);
                this.compiledByName.set(effect.name, this.compile(effect));
            }
        } catch (error) {
            console.error('Failed to load effects.yml:', error);
            alert(`ゲームデータの読み込みに失敗しました。\n\n` +
                `public/data/effects.yml ファイルが正しく配置されており、\n` +
                `内容が正しい形式であることを確認してください。\n\n` +
                `エラー詳細: ${error instanceof Error ? error.message : String(error)}`);
            throw error;
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
        };
    }

    getEffects(): EffectDefinition[] {
        return [...this.effects];
    }

    getEffect(name: string): EffectDefinition | undefined {
        return this.effectsByName.get(name);
    }

    getCompiledEffect(name: string): CompiledEffect | undefined {
        return this.compiledByName.get(name);
    }

    hasEffect(name: string): boolean {
        return this.effectsByName.has(name);
    }
}

export type { CompiledEffect, CompiledTargetSpec };
