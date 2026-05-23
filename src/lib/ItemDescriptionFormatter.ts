import type { ItemType, ItemEffectSpec, ImmediateEffect, ContinuousEffect, RemoveModifierKindSpec, RemoveModifierTarget } from './ItemsLoader';
import { StatsLoader } from './StatsLoader';
import { EffectsLoader } from './EffectsLoader';
import { SkillsLoader } from './SkillsLoader';
import { ItemModifiersLoader } from './ItemModifiersLoader';

const ITEM_TYPE_LABELS: Record<ItemType, string> = {
    weapon: '武器',
    main_armor: 'メイン防具',
    sub_armor: 'サブ防具',
    consumable: '消費',
};

const REMOVE_MODIFIER_TARGET_LABELS: Record<RemoveModifierTarget, string> = {
    all_equipped: '全装備',
    weapon: '武器',
    main_armor: 'メイン防具',
    sub_armor: 'サブ防具',
};

const INDENT = '  ';

export function formatItemTypeLabel(type: ItemType): string {
    return ITEM_TYPE_LABELS[type] ?? type;
}

function statLabel(name: string): string {
    const def = StatsLoader.getInstance().getStat(name);
    return def?.description || name;
}

function signed(n: number): string {
    return n >= 0 ? `+${n}` : `${n}`;
}

function effectLabel(name: string): string {
    return EffectsLoader.getInstance().getEffect(name)?.label ?? name;
}

function skillLabel(name: string): string {
    return SkillsLoader.getInstance().getCompiledSkill(name)?.definition.label ?? name;
}

function modifierLabel(name: string): string {
    return ItemModifiersLoader.getInstance().getDefinition(name)?.label ?? name;
}

function kindLabel(kind: string): string {
    const loader = ItemModifiersLoader.getInstance();
    const names = loader.getNamesByKind(kind);
    for (const n of names) {
        const def = loader.getDefinition(n);
        if (def?.label) return def.label;
    }
    return kind;
}

function formatRemoveModifierKind(spec: RemoveModifierKindSpec): string {
    const k = kindLabel(spec.kind);
    const t = REMOVE_MODIFIER_TARGET_LABELS[spec.target] ?? spec.target;
    return `付与解除：種別=${k} 対象=${t}`;
}

function formatResistList(list: string[]): string {
    return list.map(effectLabel).join(', ');
}

function formatImmediateLines(imm: ImmediateEffect): string[] {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(imm)) {
        if (value === undefined) continue;
        switch (key) {
            case 'applyEffect':
                lines.push(`${INDENT}状態異常付与：${effectLabel(String(value))}`);
                break;
            case 'clearEffect':
                lines.push(`${INDENT}状態異常解除：${effectLabel(String(value))}`);
                break;
            case 'learnSkill':
                lines.push(`${INDENT}スキル習得：${skillLabel(String(value))}`);
                break;
            case 'add_modifier':
                lines.push(`${INDENT}付与：${modifierLabel(String(value))}`);
                break;
            case 'remove_modifier_kind':
                lines.push(`${INDENT}${formatRemoveModifierKind(value as RemoveModifierKindSpec)}`);
                break;
            default:
                if (typeof value === 'number') {
                    lines.push(`${INDENT}${statLabel(key)}：${signed(value)}`);
                } else {
                    lines.push(`${INDENT}${key}：${String(value)}`);
                }
        }
    }
    return lines;
}

function formatContinuousLines(cont: ContinuousEffect): string[] {
    const lines: string[] = [];
    for (const [key, value] of Object.entries(cont)) {
        if (value === undefined) continue;
        if (key === 'turns' && typeof value === 'number') {
            lines.push(`${INDENT}ターン：${value}`);
        } else if (key === 'resist' && Array.isArray(value)) {
            lines.push(`${INDENT}耐性：${formatResistList(value as string[])}`);
        } else if (typeof value === 'number') {
            lines.push(`${INDENT}${statLabel(key)}：${signed(value)}`);
        } else {
            lines.push(`${INDENT}${key}：${String(value)}`);
        }
    }
    return lines;
}

function formatSpec(spec: ItemEffectSpec): string[] {
    const lines: string[] = [];

    if (spec.immediate) {
        lines.push('即時：');
        lines.push(...formatImmediateLines(spec.immediate));
    }
    if (spec.continuous) {
        lines.push('継続：');
        lines.push(...formatContinuousLines(spec.continuous));
    }
    if (spec.resist && Array.isArray(spec.resist) && spec.resist.length > 0) {
        lines.push(`耐性：${formatResistList(spec.resist)}`);
    }

    for (const [key, value] of Object.entries(spec)) {
        if (key === 'immediate' || key === 'continuous' || key === 'resist') continue;
        if (value === undefined) continue;
        if (typeof value === 'number') {
            lines.push(`${statLabel(key)}：${signed(value)}`);
        }
    }

    return lines;
}

export function formatItemEffect(specs: ItemEffectSpec[]): string {
    const blocks: string[] = [];
    for (const spec of specs) {
        const lines = formatSpec(spec);
        if (lines.length > 0) blocks.push(lines.join('\n'));
    }
    return blocks.join('\n\n');
}
