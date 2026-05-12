import { BaseLoader } from './BaseLoader';
import { EnemyLoader } from './EnemyLoader';
import { TrapsLoader } from './TrapsLoader';
import { EffectsLoader } from './EffectsLoader';
import { StatsLoader } from './StatsLoader';
import { ItemsLoader } from './ItemsLoader';
import { SkillsLoader } from './SkillsLoader';

export interface ValidationResult {
    errors: string[];
    infos: string[];
}

export class YamlCrossValidator {
    static validate(): ValidationResult {
        const errors: string[] = [];
        const infos: string[] = [];

        const base = BaseLoader.getInstance();
        const enemies = EnemyLoader.getInstance();
        const traps = TrapsLoader.getInstance();
        const effects = EffectsLoader.getInstance();
        const stats = StatsLoader.getInstance();
        const items = ItemsLoader.getInstance();
        const skills = SkillsLoader.getInstance();

        // ─── INFOレベル: base.yml のオプションフィールド ──────────────────────────

        if (!base.hasName()) {
            infos.push(`base.yml: name が未定義です（フォールバック: 'Dungeon Game'）`);
        }
        if (!base.hasGoalFloor()) {
            infos.push(`base.yml: goalFloor が未定義です（フォールバック: 10）`);
        }
        if (!base.hasDeadFormula()) {
            infos.push(`base.yml: dead.formula が未定義です（フォールバック: ${base.getDefaultDamageStat()} <= 0）`);
        }
        if (!base.hasDefaultEnemyDamageStat()) {
            infos.push(`base.yml: defaultEnemyDamageStat が未定義です（フォールバック: ${base.getDefaultDamageStat()}）`);
        }
        if (!base.hasEnemyDeadFormula()) {
            infos.push(`base.yml: enemyDead.formula が未定義です（フォールバック: dead.formula またはデフォルト死亡判定）`);
        }
        if (!base.hasAutoSpawnerFormula()) {
            infos.push(`base.yml: autoSpawner.formula が未定義です（フォールバック: rank比率計算）`);
        }

        // ─── ERRORレベル: クロスYAML参照 ──────────────────────────────────────────

        // base.yml floors → enemies.yml / traps.yml
        for (const [floorKey, rawConfig] of base.getRawFloorConfigs()) {
            for (const entry of rawConfig.enemies ?? []) {
                const name = typeof entry === 'string' ? entry : entry.name;
                if (!enemies.getEnemy(name)) {
                    errors.push(`base.yml floors[${floorKey}]: 敵 "${name}" が enemies.yml に存在しません`);
                }
            }
            for (const trapName of rawConfig.traps ?? []) {
                if (!traps.getTrap(trapName)) {
                    errors.push(`base.yml floors[${floorKey}]: トラップ "${trapName}" が traps.yml に存在しません`);
                }
            }
        }

        // enemies.yml ability.effectAttack.name → effects.yml
        for (const enemy of enemies.getEnemies()) {
            for (let i = 0; i < (enemy.ability ?? []).length; i++) {
                const ab = enemy.ability![i];
                if (ab.effectAttack && !effects.hasEffect(ab.effectAttack.name)) {
                    errors.push(`enemies.yml "${enemy.name}": ability[${i}].effectAttack.name "${ab.effectAttack.name}" が effects.yml に存在しません`);
                }
            }
        }

        // traps.yml effect → effects.yml / stats.yml
        for (const trap of traps.getTraps()) {
            for (let i = 0; i < trap.effect.length; i++) {
                const e = trap.effect[i];
                if (e.type === 'addEffect' && typeof e.value === 'string') {
                    if (!effects.hasEffect(e.value)) {
                        errors.push(`traps.yml "${trap.name}": effect[${i}].value "${e.value}" が effects.yml に存在しません`);
                    }
                }
                if (e.type === 'stat' && typeof e.target === 'string') {
                    if (!stats.getStat(e.target)) {
                        errors.push(`traps.yml "${trap.name}": effect[${i}].target "${e.target}" が stats.yml に存在しません`);
                    }
                }
            }
        }

        // effects.yml timing.*.target（_始まり以外）→ stats.yml
        const TIMING_KEYS = ['onPlayerAction', 'onTurnEnd', 'permanent'] as const;
        for (const effect of effects.getEffects()) {
            for (const timing of TIMING_KEYS) {
                const spec = effect.timing?.[timing];
                if (!spec) continue;
                const specArray = Array.isArray(spec) ? spec : [spec];
                for (const s of specArray) {
                    if (!s.target.startsWith('_') && !stats.getStat(s.target)) {
                        errors.push(`effects.yml "${effect.name}": timing.${timing}.target "${s.target}" が stats.yml に存在しません`);
                    }
                }
            }
        }

        // items.yml effect → stats.yml / effects.yml
        for (const item of items.getItems()) {
            const specs = Array.isArray(item.effect) ? item.effect : [item.effect];
            for (const spec of specs) {
                // トップレベルの stat キー（immediate / continuous 以外の数値）
                for (const [k, v] of Object.entries(spec)) {
                    if (k === 'immediate' || k === 'continuous') continue;
                    if (typeof v === 'number' && !stats.getStat(k)) {
                        errors.push(`items.yml "${item.name}": effect のキー "${k}" が stats.yml に存在しません`);
                    }
                }
                // immediate 内
                if (spec.immediate && typeof spec.immediate === 'object') {
                    for (const [k, v] of Object.entries(spec.immediate)) {
                        if (k === 'applyEffect' || k === 'clearEffect') {
                            if (typeof v === 'string' && !effects.hasEffect(v)) {
                                errors.push(`items.yml "${item.name}": immediate.${k} "${v}" が effects.yml に存在しません`);
                            }
                        } else if (k === 'learnSkill') {
                            if (typeof v === 'string' && !skills.hasSkill(v)) {
                                errors.push(`items.yml "${item.name}": immediate.learnSkill "${v}" が skills.yml に存在しません`);
                            }
                        } else if (typeof v === 'number' && !stats.getStat(k)) {
                            errors.push(`items.yml "${item.name}": immediate.${k} が stats.yml に存在しません`);
                        }
                    }
                }
                // continuous 内（turns を除く）
                if (spec.continuous && typeof spec.continuous === 'object') {
                    for (const [k, v] of Object.entries(spec.continuous)) {
                        if (k === 'turns') continue;
                        if (typeof v === 'number' && !stats.getStat(k)) {
                            errors.push(`items.yml "${item.name}": continuous.${k} が stats.yml に存在しません`);
                        }
                    }
                }
            }
        }

        return { errors, infos };
    }
}
