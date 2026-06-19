import { BaseLoader } from './BaseLoader';
import { EnemyLoader } from './EnemyLoader';
import { TrapsLoader } from './TrapsLoader';
import { EffectsLoader } from './EffectsLoader';
import { StatsLoader } from './StatsLoader';
import { ItemsLoader } from './ItemsLoader';
import { SkillsLoader } from './SkillsLoader';
import { ItemModifiersLoader } from './ItemModifiersLoader';
import { EventsLoader } from './EventsLoader';
import type { EventActionEntry, EventChoice, RandomOutcomeEntry } from './EventsLoader';
import { validateActionValue } from './effects/StatusActionResolver';
import { DEFAULT_INVENTORY_CAPACITY } from './Inventory';

export interface ValidationResult {
    errors: string[];
    infos: string[];
}

/**
 * stats.yml には登録されないが、システムが装備 `effect` / passive `add_stats` 経由で
 * 解釈する派生ステータスキー。`Player.getStat` は未知キーで 0 を返すため、
 * これらは base 0 ＋装備/パッシブ加算として `getEffectiveStat` で集計される。
 * - `throwRange`: アイテム投擲の射程ボーナス（基準射程は `base.yml` の `throwRange`）
 */
const DERIVED_STAT_KEYS = new Set<string>(['throwRange']);

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
        const events = EventsLoader.getInstance();

        // ─── 施錠扉システムの可用性判定 ────────────────────────────────────────
        // `events.yml` に `secret_room_key`（解錠レバー）が無いと施錠扉に入れない部屋になるため、
        // BaseLoader 側で `secretRoomDoorVariants.locked` / `lockedDisguised` を強制 0 にする。
        // どんな base.yml 設定であっても plain（壁偽装のみ）にフォールバックされる。
        const hasSecretRoomKey = events.has('secret_room_key');
        base.setLockedDoorsAvailable(hasSecretRoomKey);
        if (!hasSecretRoomKey) {
            infos.push(`events.yml: "secret_room_key" が未定義のため、隠し部屋扉は plain（壁偽装のみ）に強制されます`);
        }

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

        // base.yml playerInitialStats.skills / items → skills.yml / items.yml
        // 初期スキル・初期アイテムの存在チェックと、初期アイテム合計数のインベントリ上限チェック。
        const initialSkills = base.getPlayerInitialSkills();
        for (let i = 0; i < initialSkills.length; i++) {
            if (!skills.hasSkill(initialSkills[i])) {
                errors.push(`base.yml playerInitialStats.skills[${i}] "${initialSkills[i]}" が skills.yml に存在しません`);
            }
        }
        const initialItems = base.getPlayerInitialItems();
        for (let i = 0; i < initialItems.length; i++) {
            if (!items.getItem(initialItems[i].name)) {
                errors.push(`base.yml playerInitialStats.items[${i}] "${initialItems[i].name}" が items.yml に存在しません`);
            }
        }
        const initialItemTotal = base.getPlayerInitialItemTotalCount();
        if (initialItemTotal > DEFAULT_INVENTORY_CAPACITY) {
            errors.push(`base.yml playerInitialStats.items: 初期アイテム合計数 ${initialItemTotal} がインベントリ上限 ${DEFAULT_INVENTORY_CAPACITY} を超えています`);
        }

        // base.yml characterCreation.presets → stats.yml / skills.yml / items.yml
        // プリセットの stats 上書きキー・追加スキル・追加アイテムの存在チェックと、
        // 合成後（playerInitialStats.items ＋ preset.items）のインベントリ上限チェック。
        const presets = base.getCharacterPresets();
        for (let i = 0; i < presets.length; i++) {
            const preset = presets[i];
            const ctx = `base.yml characterCreation.presets[${i}]`;
            for (const statName of Object.keys(preset.stats)) {
                if (!stats.getStat(statName)) {
                    errors.push(`${ctx} ("${preset.label}"): stats のキー "${statName}" が stats.yml に存在しません`);
                }
            }
            for (let j = 0; j < preset.skills.length; j++) {
                if (!skills.hasSkill(preset.skills[j])) {
                    errors.push(`${ctx} ("${preset.label}"): skills[${j}] "${preset.skills[j]}" が skills.yml に存在しません`);
                }
            }
            let presetItemTotal = 0;
            for (let j = 0; j < preset.items.length; j++) {
                const it = preset.items[j];
                if (!items.getItem(it.name)) {
                    errors.push(`${ctx} ("${preset.label}"): items[${j}] "${it.name}" が items.yml に存在しません`);
                }
                if (typeof it.count !== 'number' || it.count <= 0) {
                    errors.push(`${ctx} ("${preset.label}"): items[${j}].count は正の数値である必要があります`);
                } else {
                    presetItemTotal += it.count;
                }
            }
            // 合成後の所持数（土台 playerInitialStats.items ＋ preset.items）が上限を超えないか
            if (initialItemTotal + presetItemTotal > DEFAULT_INVENTORY_CAPACITY) {
                errors.push(`${ctx} ("${preset.label}"): 合成後の初期アイテム合計数 ${initialItemTotal + presetItemTotal} がインベントリ上限 ${DEFAULT_INVENTORY_CAPACITY} を超えています`);
            }
        }

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
            if (rawConfig.treasure !== undefined) {
                const t = rawConfig.treasure;
                if (typeof t !== 'object' || Array.isArray(t)) {
                    errors.push(`base.yml floors[${floorKey}]: treasure はオブジェクトである必要があります`);
                } else {
                    if (typeof t.rate !== 'number' || t.rate < 0 || t.rate > 1) {
                        errors.push(`base.yml floors[${floorKey}]: treasure.rate は 0..1 の数値である必要があります`);
                    }
                    if (typeof t.trapRate !== 'number' || t.trapRate < 0 || t.trapRate > 1) {
                        errors.push(`base.yml floors[${floorKey}]: treasure.trapRate は 0..1 の数値である必要があります`);
                    }
                    if (!Array.isArray(t.items)) {
                        errors.push(`base.yml floors[${floorKey}]: treasure.items は配列である必要があります`);
                    } else {
                        for (let i = 0; i < t.items.length; i++) {
                            const it = t.items[i];
                            if (!it || typeof it !== 'object') {
                                errors.push(`base.yml floors[${floorKey}]: treasure.items[${i}] はオブジェクトである必要があります`);
                                continue;
                            }
                            if (typeof it.name !== 'string' || !items.getItem(it.name)) {
                                errors.push(`base.yml floors[${floorKey}]: treasure.items[${i}].name "${it.name}" が items.yml に存在しません`);
                            }
                            if (it.bias !== undefined && (typeof it.bias !== 'number' || it.bias <= 0)) {
                                errors.push(`base.yml floors[${floorKey}]: treasure.items[${i}].bias は正の数値である必要があります`);
                            }
                            if (it.modifiers !== undefined) {
                                if (!Array.isArray(it.modifiers)) {
                                    errors.push(`base.yml floors[${floorKey}]: treasure.items[${i}].modifiers は配列である必要があります`);
                                } else {
                                    for (let j = 0; j < it.modifiers.length; j++) {
                                        const m = it.modifiers[j];
                                        if (!m || typeof m !== 'object') {
                                            errors.push(`base.yml floors[${floorKey}]: treasure.items[${i}].modifiers[${j}] はオブジェクトである必要があります`);
                                            continue;
                                        }
                                        if (typeof m.name !== 'string' || !itemModifiers.has(m.name)) {
                                            errors.push(`base.yml floors[${floorKey}]: treasure.items[${i}].modifiers[${j}].name "${m.name}" が item_modifiers.yml に存在しません`);
                                        }
                                        if (typeof m.count !== 'number' || m.count <= 0) {
                                            errors.push(`base.yml floors[${floorKey}]: treasure.items[${i}].modifiers[${j}].count は正の数値である必要があります`);
                                        }
                                    }
                                }
                            }
                        }
                    }
                    // info: secretRoom 未設定なのに treasure 設定あり
                    const secretEnabled = rawConfig.secretRoom === true
                        || rawConfig.secretRoom === 'yes'
                        || rawConfig.secretRoom === 'true'
                        || (typeof rawConfig.secretRoom === 'number' && rawConfig.secretRoom > 0);
                    if (!secretEnabled) {
                        infos.push(`base.yml floors[${floorKey}]: treasure が設定されていますが secretRoom が無効なため宝箱は配置されません`);
                    }
                    // info: trapRate > 0 なのに trapPool が空
                    const trapPoolEmpty = !rawConfig.traps || rawConfig.traps.length === 0;
                    if (typeof t.trapRate === 'number' && t.trapRate > 0 && trapPoolEmpty) {
                        infos.push(`base.yml floors[${floorKey}]: treasure.trapRate=${t.trapRate} ですがフロアに traps がないため宝箱開封時のトラップは発動しません`);
                    }
                }
            }
            // base.yml floors[].events / eventCount → events.yml
            if (rawConfig.eventCount !== undefined) {
                const ec = rawConfig.eventCount;
                if (typeof ec === 'number') {
                    if (!isFinite(ec) || ec < 0) {
                        errors.push(`base.yml floors[${floorKey}]: eventCount は 0 以上の数値である必要があります`);
                    }
                } else if (ec && typeof ec === 'object' && !Array.isArray(ec)) {
                    if (typeof (ec as any).min !== 'number' || typeof (ec as any).max !== 'number') {
                        errors.push(`base.yml floors[${floorKey}]: eventCount は数値または { min, max } の形式で指定してください`);
                    }
                } else {
                    errors.push(`base.yml floors[${floorKey}]: eventCount は数値または { min, max } の形式で指定してください`);
                }
            }
            if (rawConfig.events !== undefined && rawConfig.events !== null) {
                if (!Array.isArray(rawConfig.events)) {
                    errors.push(`base.yml floors[${floorKey}]: events は配列である必要があります`);
                } else {
                    for (let i = 0; i < rawConfig.events.length; i++) {
                        const entry = rawConfig.events[i];
                        const name = typeof entry === 'string' ? entry : entry?.name;
                        if (typeof name !== 'string' || !name) {
                            errors.push(`base.yml floors[${floorKey}]: events[${i}] は文字列または { name, weight } である必要があります`);
                            continue;
                        }
                        if (!events.has(name)) {
                            errors.push(`base.yml floors[${floorKey}]: events[${i}].name "${name}" が events.yml に存在しません`);
                        }
                        if (entry && typeof entry === 'object' && entry.weight !== undefined) {
                            if (typeof entry.weight !== 'number' || entry.weight <= 0) {
                                errors.push(`base.yml floors[${floorKey}]: events[${i}].weight は正の数値である必要があります`);
                            }
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
                    // onAction の _action value（強制/禁止アクションツリー）の構造＋クロス参照を検証
                    if (timing === 'onAction' && s.target === '_action' && s.value !== undefined) {
                        errors.push(...validateActionValue(
                            s.value,
                            `effects.yml "${effect.name}": onAction.value`,
                            {
                                hasItem: (n) => !!items.getItem(n),
                                hasActiveSkill: (n) => {
                                    const d = skills.getSkill(n);
                                    return !!d && (d.trigger ?? 'active') === 'active';
                                },
                            },
                        ));
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
                    if (typeof v === 'number' && !stats.getStat(k) && !DERIVED_STAT_KEYS.has(k)) {
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
                        } else if (k === 'executeSkill') {
                            if (typeof v === 'string') {
                                const skillDef = skills.getSkill(v);
                                if (!skillDef) {
                                    errors.push(`items.yml "${item.name}": immediate.executeSkill "${v}" が skills.yml に存在しません`);
                                } else if ((skillDef.trigger ?? 'active') !== 'active') {
                                    errors.push(`items.yml "${item.name}": immediate.executeSkill "${v}" はパッシブスキル（trigger=${skillDef.trigger}）のため指定できません`);
                                }
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

            // throwEffect の effect 名参照 → effects.yml（damage の formula は検証対象外）
            const throwEntries = item.throwEffect ?? [];
            for (let i = 0; i < throwEntries.length; i++) {
                const e = throwEntries[i];
                const ae = e.apply_effect;
                const aeName = typeof ae === 'string' ? ae : (ae && typeof ae === 'object' ? ae.effect : undefined);
                if (typeof aeName === 'string' && aeName && !effects.hasEffect(aeName)) {
                    errors.push(`items.yml "${item.name}": throwEffect[${i}].apply_effect "${aeName}" が effects.yml に存在しません`);
                }
                if (typeof e.clear_effect === 'string' && !effects.hasEffect(e.clear_effect)) {
                    errors.push(`items.yml "${item.name}": throwEffect[${i}].clear_effect "${e.clear_effect}" が effects.yml に存在しません`);
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

        // items.yml passive_skills[].name → skills.yml（パッシブ系 trigger 必須）
        for (const item of items.getItems()) {
            const passiveList = item.passive_skills ?? [];
            for (let i = 0; i < passiveList.length; i++) {
                const ps = passiveList[i];
                const skillDef = skills.getSkill(ps.name);
                if (!skillDef) {
                    errors.push(`items.yml "${item.name}": passive_skills[${i}].name "${ps.name}" が skills.yml に存在しません`);
                    continue;
                }
                const trig = skillDef.trigger ?? 'active';
                if (trig === 'active') {
                    errors.push(`items.yml "${item.name}": passive_skills[${i}].name "${ps.name}" は active スキルのため装備パッシブとして使用できません`);
                }
            }
        }

        // skills.yml add_stats.<key> → stats.yml（_max サフィックスを許容）
        for (const skill of skills.getSkills()) {
            if (!skill.add_stats) continue;
            for (const key of Object.keys(skill.add_stats)) {
                const isMax = key.endsWith('_max');
                const baseKey = isMax ? key.slice(0, -'_max'.length) : key;
                if (!stats.getStat(baseKey) && !DERIVED_STAT_KEYS.has(baseKey)) {
                    errors.push(`skills.yml "${skill.name}": add_stats."${key}" の対応 stat が stats.yml に存在しません`);
                }
            }
        }

        // skills.yml apply_effect.effect → effects.yml
        for (const skill of skills.getSkills()) {
            const skillActionArray = skill.action ?? [];
            for (let i = 0; i < skillActionArray.length; i++) {
                const entry = skillActionArray[i];
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

        // events.yml の各 action 配列内クロス参照
        // (give_item.name / consume_item.name → items.yml, spawn_enemy.name → enemies.yml,
        //  learn_skill / execute_skill → skills.yml, add_modifier → item_modifiers.yml,
        //  apply_effect.effect → effects.yml, remove_modifier_kind.kind → item_modifiers.yml の kind タグ)
        const checkEventActionEntry = (
            entry: EventActionEntry,
            ctx: string,
        ): void => {
            if (typeof entry === 'string') return; // 'attack' / 'self_destruct' などのキーレス action
            const keys = Object.keys(entry);
            if (keys.length !== 1) return;
            const actionKey = keys[0];
            const value = (entry as Record<string, unknown>)[actionKey];

            switch (actionKey) {
                case 'give_item': {
                    let itemName: string | undefined;
                    if (typeof value === 'string') itemName = value;
                    else if (value && typeof value === 'object' && !Array.isArray(value)) {
                        const p = value as Record<string, unknown>;
                        if (typeof p.name === 'string') itemName = p.name;
                        // modifiers[] のクロス参照も検証
                        if (Array.isArray(p.modifiers)) {
                            for (let i = 0; i < p.modifiers.length; i++) {
                                const m = (p.modifiers as any[])[i];
                                if (m && typeof m === 'object' && typeof m.name === 'string') {
                                    if (!itemModifiers.has(m.name)) {
                                        errors.push(`${ctx}.give_item.modifiers[${i}].name "${m.name}" が item_modifiers.yml に存在しません`);
                                    }
                                }
                            }
                        }
                    }
                    if (itemName !== undefined && !items.getItem(itemName)) {
                        errors.push(`${ctx}.give_item "${itemName}" が items.yml に存在しません`);
                    }
                    break;
                }
                case 'consume_item': {
                    let itemName: string | undefined;
                    if (typeof value === 'string') itemName = value;
                    else if (value && typeof value === 'object' && !Array.isArray(value)) {
                        const p = value as Record<string, unknown>;
                        if (typeof p.name === 'string') itemName = p.name;
                        if (p.count !== undefined && (typeof p.count !== 'number' || p.count <= 0)) {
                            errors.push(`${ctx}.consume_item.count は正の数値である必要があります`);
                        }
                    }
                    if (itemName !== undefined && !items.getItem(itemName)) {
                        errors.push(`${ctx}.consume_item "${itemName}" が items.yml に存在しません`);
                    }
                    break;
                }
                case 'spawn_enemy': {
                    let enemyName: string | undefined;
                    if (typeof value === 'string') enemyName = value;
                    else if (value && typeof value === 'object' && !Array.isArray(value)) {
                        const p = value as Record<string, unknown>;
                        if (typeof p.name === 'string') enemyName = p.name;
                        if (p.near !== undefined && p.near !== 'around' && p.near !== 'room') {
                            errors.push(`${ctx}.spawn_enemy.near は 'around' または 'room' を指定してください (got: ${JSON.stringify(p.near)})`);
                        }
                        if (p.count !== undefined && (typeof p.count !== 'number' || p.count <= 0)) {
                            errors.push(`${ctx}.spawn_enemy.count は正の数値である必要があります`);
                        }
                    }
                    if (enemyName !== undefined && !enemies.getEnemy(enemyName)) {
                        errors.push(`${ctx}.spawn_enemy "${enemyName}" が enemies.yml に存在しません`);
                    }
                    break;
                }
                case 'learn_skill': {
                    if (typeof value === 'string' && !skills.hasSkill(value)) {
                        errors.push(`${ctx}.learn_skill "${value}" が skills.yml に存在しません`);
                    }
                    break;
                }
                case 'execute_skill': {
                    if (typeof value === 'string') {
                        const skillDef = skills.getSkill(value);
                        if (!skillDef) {
                            errors.push(`${ctx}.execute_skill "${value}" が skills.yml に存在しません`);
                        } else if ((skillDef.trigger ?? 'active') !== 'active') {
                            errors.push(`${ctx}.execute_skill "${value}" はパッシブスキル（trigger=${skillDef.trigger}）のため指定できません`);
                        }
                    }
                    break;
                }
                case 'add_modifier': {
                    if (typeof value === 'string' && !itemModifiers.has(value)) {
                        errors.push(`${ctx}.add_modifier "${value}" が item_modifiers.yml に存在しません`);
                    }
                    break;
                }
                case 'remove_modifier_kind': {
                    if (value && typeof value === 'object' && !Array.isArray(value)) {
                        const r = value as { kind?: unknown };
                        if (typeof r.kind === 'string' && itemModifiers.getNamesByKind(r.kind).length === 0) {
                            infos.push(`${ctx}.remove_modifier_kind.kind "${r.kind}" を持つ modifier が item_modifiers.yml に存在しません（解除対象なし）`);
                        }
                    }
                    break;
                }
                case 'apply_effect': {
                    let effectName: string | undefined;
                    if (typeof value === 'string') effectName = value;
                    else if (value && typeof value === 'object' && !Array.isArray(value)) {
                        const p = value as Record<string, unknown>;
                        if (typeof p.effect === 'string') effectName = p.effect;
                    }
                    if (effectName !== undefined && !effects.hasEffect(effectName)) {
                        errors.push(`${ctx}.apply_effect.effect "${effectName}" が effects.yml に存在しません`);
                    }
                    break;
                }
                case 'unlock_door': {
                    // 鍵 EventObject 専用 action。`param: 'self'` 固定（EventObject.linkedDoor を runtime に解決）。
                    if (value !== 'self') {
                        errors.push(`${ctx}.unlock_door は 'self' のみサポートします (got: ${JSON.stringify(value)})`);
                    }
                    break;
                }
                case 'mod_stat': {
                    if (!value || typeof value !== 'object' || Array.isArray(value)) {
                        errors.push(`${ctx}.mod_stat は { stat, formula } オブジェクトである必要があります`);
                        break;
                    }
                    const p = value as Record<string, unknown>;
                    if (typeof p.stat !== 'string' || !stats.getStatNames().includes(p.stat)) {
                        errors.push(`${ctx}.mod_stat.stat "${String(p.stat)}" が stats.yml に存在しません`);
                    }
                    if (p.formula === undefined || (typeof p.formula !== 'number' && typeof p.formula !== 'string')) {
                        errors.push(`${ctx}.mod_stat.formula は数値または formula 文字列である必要があります`);
                    }
                    break;
                }
            }
        };

        const checkActionArray = (arr: EventActionEntry[] | undefined, ctx: string): void => {
            if (!arr) return;
            for (let i = 0; i < arr.length; i++) {
                checkEventActionEntry(arr[i], `${ctx}[${i}]`);
            }
        };

        for (const ev of events.getEvents()) {
            const evCtx = `events.yml "${ev.name}"`;
            checkActionArray(ev.action, `${evCtx}.action`);
            if (ev.random_outcome) {
                for (let i = 0; i < ev.random_outcome.length; i++) {
                    const r: RandomOutcomeEntry = ev.random_outcome[i];
                    checkActionArray(r.action, `${evCtx}.random_outcome[${i}].action`);
                }
            }
            if (ev.choices) {
                for (let i = 0; i < ev.choices.length; i++) {
                    const c: EventChoice = ev.choices[i];
                    checkActionArray(c.action, `${evCtx}.choices[${i}].action`);
                    checkActionArray(c.on_success, `${evCtx}.choices[${i}].on_success`);
                    checkActionArray(c.on_fail, `${evCtx}.choices[${i}].on_fail`);
                }
            }
        }

        // base.yml scheduledEvents → events.yml
        // 時限イベントは events.yml の action / random_outcome を無人実行するため、
        // 名前の存在と「choices 形式でない」ことを検証する。
        const scheduled = base.getScheduledEvents();
        for (let i = 0; i < scheduled.length; i++) {
            const se = scheduled[i];
            const ctx = `base.yml scheduledEvents[${i}]`;
            const def = events.getEvent(se.event);
            if (!def) {
                errors.push(`${ctx}: event "${se.event}" が events.yml に存在しません`);
            } else if (!def.action && !def.random_outcome) {
                errors.push(`${ctx}: event "${se.event}" は choices 形式のため時限実行できません（action / random_outcome のみ対応）`);
            }
        }

        // effects.yml onExpire → events.yml
        // 状態異常の満了時に無人発火するため、scheduledEvents と同じ制約（存在 + choices 不可）を課す。
        for (const ef of effects.getEffects()) {
            if (!ef.onExpire) continue;
            const ctx = `effects.yml "${ef.name}".onExpire`;
            const def = events.getEvent(ef.onExpire);
            if (!def) {
                errors.push(`${ctx}: event "${ef.onExpire}" が events.yml に存在しません`);
            } else if (!def.action && !def.random_outcome) {
                errors.push(`${ctx}: event "${ef.onExpire}" は choices 形式のため満了実行できません（action / random_outcome のみ対応）`);
            }
        }

        return { errors, infos };
    }
}
