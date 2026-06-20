<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted, computed } from 'vue';
import ModalOverlay from './ModalOverlay.vue';

interface PresetDisplay {
    label: string;
    description: string;
    statLines: { label: string; value: number }[];
    skillLabels: string[];
    itemLabels: string[];
}

interface SkillOption {
    name: string;
    label: string;
    description: string;
}

interface SkillGroupDisplay {
    label: string;
    description: string;
    pick: number;
    options: SkillOption[];
}

const props = defineProps<{
    visible: boolean
    prompt: string
    presets: PresetDisplay[]
    skillGroups: SkillGroupDisplay[]
}>();

const emit = defineEmits<{
    confirm: [payload: { presetIndex: number | null; skills: string[] }]
    cancel: []
}>();

// ウィザードのステップ構成：プリセットステップ（プリセットがあれば）＋スキルグループ各 1 ステップ
type Step = { kind: 'preset' } | { kind: 'group'; groupIndex: number };
const steps = computed<Step[]>(() => {
    const s: Step[] = [];
    if (props.presets.length > 0) s.push({ kind: 'preset' });
    props.skillGroups.forEach((_, i) => s.push({ kind: 'group', groupIndex: i }));
    return s;
});

const currentStep = ref(0);
const selectedPresetIndex = ref(0);
// グループごとに選択したスキル名の配列
const groupSelections = ref<string[][]>([]);

// 表示されるたびに選択状態を初期化
watch(() => props.visible, (v) => {
    if (v) {
        currentStep.value = 0;
        selectedPresetIndex.value = 0;
        groupSelections.value = props.skillGroups.map(() => []);
    }
});

const step = computed<Step | undefined>(() => steps.value[currentStep.value]);
const isLastStep = computed(() => currentStep.value === steps.value.length - 1);

const selectedPreset = computed<PresetDisplay | undefined>(() => props.presets[selectedPresetIndex.value]);

const currentGroup = computed<SkillGroupDisplay | undefined>(() => {
    const s = step.value;
    return s && s.kind === 'group' ? props.skillGroups[s.groupIndex] : undefined;
});
const currentGroupSelection = computed<string[]>(() => {
    const s = step.value;
    return s && s.kind === 'group' ? (groupSelections.value[s.groupIndex] ?? []) : [];
});

// 現在ステップが進行可能か（プリセットは常に可、グループは pick 個ちょうど選択で可）
const isCurrentValid = computed(() => {
    const s = step.value;
    if (!s) return false;
    if (s.kind === 'preset') return props.presets.length > 0;
    const g = props.skillGroups[s.groupIndex];
    return (groupSelections.value[s.groupIndex]?.length ?? 0) === g.pick;
});

function selectPreset(index: number) {
    selectedPresetIndex.value = index;
}

function isSkillSelected(name: string): boolean {
    return currentGroupSelection.value.includes(name);
}

function toggleSkill(name: string) {
    const s = step.value;
    if (!s || s.kind !== 'group') return;
    const sel = groupSelections.value[s.groupIndex];
    const idx = sel.indexOf(name);
    if (idx >= 0) {
        sel.splice(idx, 1);
        return;
    }
    const pick = props.skillGroups[s.groupIndex].pick;
    if (sel.length < pick) {
        sel.push(name);
    } else if (pick === 1) {
        // 単一選択グループは選び直しとして置き換える
        groupSelections.value[s.groupIndex] = [name];
    }
    // pick > 1 で満杯のときは無視（先に解除させる）
}

function next() {
    if (!isCurrentValid.value || isLastStep.value) return;
    currentStep.value++;
}

function back() {
    if (currentStep.value > 0) currentStep.value--;
}

function confirm() {
    if (!isLastStep.value || !isCurrentValid.value) return;
    emit('confirm', {
        presetIndex: props.presets.length > 0 ? selectedPresetIndex.value : null,
        skills: groupSelections.value.flat(),
    });
}

// Escape でキャンセル、Enter で「次へ／決定」。表示中のみ有効。
function onKeyDown(e: KeyboardEvent) {
    if (!props.visible) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        emit('cancel');
    } else if (e.key === 'Enter') {
        e.preventDefault();
        if (isLastStep.value) confirm();
        else next();
    }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.6" :z-index="100">
        <div style="padding: 24px 36px; width: 720px; color: #fff;">
            <h2 style="margin: 0 0 4px 0; text-align: center; font-size: 22px;">{{ prompt }}</h2>
            <p
                v-if="steps.length > 1"
                style="margin: 0 0 16px 0; text-align: center; font-size: 13px; opacity: 0.7;"
            >ステップ {{ currentStep + 1 }} / {{ steps.length }}</p>
            <div v-else style="height: 12px;"></div>

            <!-- プリセット選択ステップ -->
            <div v-if="step && step.kind === 'preset'" style="display: flex; gap: 20px;">
                <div style="width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;">
                    <button
                        v-for="(p, i) in presets"
                        :key="i"
                        class="button preset-item"
                        :class="{ 'preset-item--selected': i === selectedPresetIndex }"
                        @click="selectPreset(i)"
                    >{{ p.label }}</button>
                </div>
                <div
                    style="flex: 1; min-height: 280px; max-height: 360px; overflow-y: auto;
                           background: #111; border: 1px solid #666; border-radius: 4px;
                           padding: 16px 18px; box-sizing: border-box; font-size: 14px; line-height: 1.7;"
                >
                    <template v-if="selectedPreset">
                        <h3 style="margin: 0 0 10px 0; font-size: 18px;">{{ selectedPreset.label }}</h3>
                        <p
                            v-if="selectedPreset.description"
                            style="margin: 0 0 14px 0; white-space: pre-wrap; word-break: break-word; opacity: 0.9;"
                        >{{ selectedPreset.description }}</p>
                        <div v-if="selectedPreset.statLines.length > 0" style="margin-bottom: 12px;">
                            <div style="opacity: 0.7; margin-bottom: 4px;">ステータス</div>
                            <div style="display: flex; flex-wrap: wrap; gap: 6px 16px;">
                                <span v-for="(s, si) in selectedPreset.statLines" :key="si">{{ s.label }} {{ s.value }}</span>
                            </div>
                        </div>
                        <div v-if="selectedPreset.skillLabels.length > 0" style="margin-bottom: 12px;">
                            <div style="opacity: 0.7; margin-bottom: 4px;">習得スキル</div>
                            <div>{{ selectedPreset.skillLabels.join('、') }}</div>
                        </div>
                        <div v-if="selectedPreset.itemLabels.length > 0">
                            <div style="opacity: 0.7; margin-bottom: 4px;">所持アイテム</div>
                            <div>{{ selectedPreset.itemLabels.join('、') }}</div>
                        </div>
                    </template>
                </div>
            </div>

            <!-- スキルグループ選択ステップ -->
            <div v-else-if="currentGroup">
                <h3 style="margin: 0 0 6px 0; font-size: 18px;">{{ currentGroup.label }}</h3>
                <p
                    v-if="currentGroup.description"
                    style="margin: 0 0 10px 0; white-space: pre-wrap; word-break: break-word; opacity: 0.9; font-size: 14px; line-height: 1.6;"
                >{{ currentGroup.description }}</p>
                <p style="margin: 0 0 10px 0; font-size: 13px; opacity: 0.7;">
                    {{ currentGroup.pick }} 個選択（選択中 {{ currentGroupSelection.length }} / {{ currentGroup.pick }}）
                </p>
                <div
                    style="min-height: 240px; max-height: 320px; overflow-y: auto;
                           background: #111; border: 1px solid #666; border-radius: 4px;
                           padding: 8px; box-sizing: border-box; display: flex; flex-direction: column; gap: 6px;"
                >
                    <button
                        v-for="(o, oi) in currentGroup.options"
                        :key="oi"
                        class="button skill-option"
                        :class="{ 'skill-option--selected': isSkillSelected(o.name) }"
                        @click="toggleSkill(o.name)"
                    >
                        <span style="font-size: 14px;">{{ o.label }}</span>
                        <span
                            v-if="o.description"
                            style="display: block; font-size: 12px; opacity: 0.7; margin-top: 2px; white-space: normal;"
                        >{{ o.description }}</span>
                    </button>
                </div>
            </div>

            <div style="display: flex; justify-content: center; gap: 16px; margin-top: 20px;">
                <button v-if="currentStep > 0" class="button" @click="back">戻る</button>
                <button v-if="!isLastStep" class="button" :disabled="!isCurrentValid" @click="next">次へ</button>
                <button v-else class="button" :disabled="!isCurrentValid" @click="confirm">決定</button>
                <button class="button" @click="emit('cancel')">キャンセル</button>
            </div>
        </div>
    </ModalOverlay>
</template>

<style scoped>
.preset-item {
    text-align: center;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
}

.preset-item--selected {
    outline: 2px solid #ffd966;
    background: #3a3a5e;
}

.skill-option {
    text-align: left;
    width: 100%;
    box-sizing: border-box;
}

.skill-option--selected {
    outline: 2px solid #ffd966;
    background: #3a3a5e;
}

.button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
}
</style>
