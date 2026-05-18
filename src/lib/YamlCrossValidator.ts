import { BaseLoader } from './BaseLoader';
import { EnemyLoader } from './EnemyLoader';
import { TrapsLoader } from './TrapsLoader';
import { EffectsLoader } from './EffectsLoader';
import { StatsLoader } from './StatsLoader';
import { ItemsLoader } from './ItemsLoader';
import { SkillsLoader } from './SkillsLoader';
import { ItemModifiersLoader } from './ItemModifiersLoader';

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
        const itemModifiers = ItemModifiersLoader.getInstance();

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

        // base.yml floors → enemies.yml / traps.yml / item_modifiers.yml
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
            if (rawConfig.itemModifierChance !== undefined) {
                if (typeof rawConfig.itemModifierChance !== 'number'
                    || rawConfig.itemModifierChance < 0
                    || rawConfig.itemModifierChance > 1) {
                    errors.push(`base.yml floors[${floorKey}]: itemModifierChance は 0..1 の数値である必要があります`);
                }
            }
            if (rawConfig.itemModifierPool !== undefined) {
                if (typeof rawConfig.itemModifierPool !== 'object' || Array.isArray(rawConfig.itemModifierPool)) {
                    errors.push(`base.yml floors[${floorKey}]: itemModifierPool はオブジェクト（modifier 名 → 重み）である必要があります`);
                } else {
                    for (const [modName, weight] of Object.entries(rawConfig.itemModifierPool)) {
                        if (!itemModifiers.has(modName)) {
                            errors.push(`base.yml floors[${floorKey}]: itemModifierPool の modifier "${modName}" が item_modifiers.yml に存在しません`);
                        }
                        if (typeof weight !== 'number' || weight < 0) {
                            errors.push(`base.yml floors[${floorKey}]: itemModifierPool["${modName}"] は 0 以上の数値である必要があります`);
                        }
                    }
                }
            }
            if (rawConfig.enemyDropPool !== undefined) {
                if (!Array.isArray(rawConfig.enemyDropPool)) {
                    errors.push(`base.yml floors[${floorKey}]: enemyDropPool は配列である必要があります`);
                } else {
                    for (let i = 0; i < rawConfig.enemyDropPool.length; i++) {
                        const d = rawConfig.enemyDropPool[i];
                        if (!d || typeof d !== 'object') {
                            errors.push(`base.yml floors[${floorKey}]: enemyDropPool[${i}] はオブジェクトである必要があります`);
                            continue;
                        }
                        if (typeof d.item !== 'string' || !items.getItem(d.item)) {
                            errors.push(`base.yml floors[${floorKey}]: enemyDropPool[${i}].item "${d.item}" が items.yml に存在しません`);
                        }
                        if (typeof d.rate !== 'number' || d.rate < 0 || d.rate > 1) {
                            errors.push(`base.yml floors[${floorKey}]: enemyDropPool[${i}].rate は 0..1 の数値である必要があります`);
                        }
                        if (d.modifierChance !== undefined
                            && (typeof d.modifierChance !== 'number' || d.modifierChance < 0 || d.modifierChance > 1)) {
                            errors.push(`base.yml floors[${floorKey}]: enemyDropPool[${i}].modifierChance は 0..1 の数値である必要があります`);
                        }
                    }
                }
            }
        }

        // enemies.yml drop[] → items.yml
        for (const enemy of enemies.getEnemies()) {
            const dropList = enemy.drop;
            if (!dropList) continue;
            for (let i = 0; i < dropList.length; i++) {
                const d = dropList[i];
                if (!items.getItem(d.item)) {
                    errors.push(`enemies.yml "${enemy.name}": drop[${i}].item "${d.item}" が items.yml に存在しません`);
                }
            }
        }

        // enemies.yml skills[].name → skills.yml（on_attack trigger 必須）
        for (const enemy of enemies.getEnemies()) {
            for (let i = 0; i < (enemy.skills ?? []).length; i++) {
                const s = enemy.skills![i];
                const skillDef = skills.getSkill(s.name);
                if (!skillDef) {
                    errors.push(`enemies.yml "${enemy.name}": skills[${i}].name "${s.name}" が skills.yml に存在しません`);
                } else if ((skillDef.trigger ?? 'active') !== 'on_attack') {
                    errors.push(`enemies.yml "${enemy.name}": skills[${i}].name "${s.name}" は on_attack スキルではありません`);
                }
            }
            for (let i = 0; i < (enemy.resist ?? []).length; i++) {
                const name = enemy.resist![i];
                if (!effects.hasEffect(name)) {
                    errors.push(`enemies.yml "${enemy.name}": resist[${i}] "${name}" が effects.yml に存在しません`);
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
        const TIMING_KEYS = ['onAction', 'onTurnEnd', 'permanent'] as const;
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
            for (let i = 0; i < (effect.resist ?? []).length; i++) {
                const name = effect.resist![i];
                if (!effects.hasEffect(name)) {
                    errors.push(`effects.yml "${effect.name}": resist[${i}] "${name}" が effects.yml に存在しません`);
                }
            }
        }

        // items.yml effect → stats.yml / effects.yml
        for (const item of items.getItems()) {
            const specs = Array.isArray(item.effect) ? item.effect : [item.effect];
            for (const spec of specs) {
                // トップレベルの stat キー（immediate / continuous / resist 以外の数値）
                for (const [k, v] of Object.entries(spec)) {
                    if (k === 'immediate' || k === 'continuous' || k === 'resist') continue;
                    if (typeof v === 'number' && !stats.getStat(k)) {
                        errors.push(`items.yml "${item.name}": effect のキー "${k}" が stats.yml に存在しません`);
                    }
                }
                // トップレベルの resist（装備時に有効な耐性）→ effects.yml
                if (Array.isArray(spec.resist)) {
                    for (let i = 0; i < spec.resist.length; i++) {
                        const name = spec.resist[i];
                        if (typeof name === 'string' && !effects.hasEffect(name)) {
                            errors.push(`items.yml "${item.name}": effect.resist[${i}] "${name}" が effects.yml に存在しません`);
                        }
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
                        } else if (k === 'add_modifier') {
                            if (typeof v === 'string' && !itemModifiers.has(v)) {
                                errors.push(`items.yml "${item.name}": immediate.add_modifier "${v}" が item_modifiers.yml に存在しません`);
                            }
                        } else if (k === 'remove_modifier_kind') {
                            if (v && typeof v === 'object' && !Array.isArray(v)) {
                                const r = v as { kind?: unknown };
                                if (typeof r.kind === 'string') {
                                    if (itemModifiers.getNamesByKind(r.kind).length === 0) {
                                        infos.push(`items.yml "${item.name}": immediate.remove_modifier_kind.kind "${r.kind}" を持つ modifier が item_modifiers.yml に存在しません（解除対象なし）`);
                                    }
                                }
                            }
                        } else if (typeof v === 'number' && !stats.getStat(k)) {
                            errors.push(`items.yml "${item.name}": immediate.${k} が stats.yml に存在しません`);
                        }
                    }
                }
                // continuous 内（turns / resist を除く）
                if (spec.continuous && typeof spec.continuous === 'object') {
                    for (const [k, v] of Object.entries(spec.continuous)) {
                        if (k === 'turns' || k === 'resist') continue;
                        if (typeof v === 'number' && !stats.getStat(k)) {
                            errors.push(`items.yml "${item.name}": continuous.${k} が stats.yml に存在しません`);
                        }
                    }
                    if (Array.isArray(spec.continuous.resist)) {
                        for (let i = 0; i < spec.continuous.resist.length; i++) {
                            const name = spec.continuous.resist[i];
                            if (typeof name === 'string' && !effects.hasEffect(name)) {
                                errors.push(`items.yml "${item.name}": continuous.resist[${i}] "${name}" が effects.yml に存在しません`);
                            }
                        }
                    }
                }
            }
        }

        // item_modifiers.yml: effect.add_stats.target → stats.yml
        for (const mod of itemModifiers.getAll()) {
            for (let i = 0; i < mod.effect.length; i++) {
                const e = mod.effect[i];
                if (e.name === 'add_stats') {
                    if (e.target && !stats.getStat(e.target)) {
                        errors.push(`item_modifiers.yml "${mod.name}": effect[${i}].target "${e.target}" が stats.yml に存在しません`);
                    }
                }
            }
        }

        // skills.yml apply_effect.effect → effects.yml
        for (const skill of skills.getSkills()) {
            for (let i = 0; i < skill.action.length; i++) {
                const entry = skill.action[i];
                if (typeof entry === 'string') continue;
                const keys = Object.keys(entry);
                if (keys[0] !== 'apply_effect') continue;
                const val = (entry as Record<string, unknown>)['apply_effect'];
                let effectName: string | undefined;
                if (typeof val === 'string') {
                    effectName = val;
                } else if (val && typeof val === 'object' && !Array.isArray(val)) {
                    const p = val as Record<string, unknown>;
                    if (typeof p.effect === 'string') effectName = p.effect;
                }
                if (effectName && !effects.hasEffect(effectName)) {
                    errors.push(`skills.yml "${skill.name}": action[${i}].apply_effect.effect "${effectName}" が effects.yml に存在しません`);
                }
            }
        }

        return { errors, infos };
    }
}
