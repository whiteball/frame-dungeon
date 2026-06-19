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

const props = defineProps<{
    visible: boolean
    prompt: string
    presets: PresetDisplay[]
}>();

const emit = defineEmits<{
    confirm: [index: number]
    cancel: []
}>();

const selectedIndex = ref(0);

// 表示されるたびに先頭プリセットを選択状態に戻す
watch(() => props.visible, (v) => {
    if (v) selectedIndex.value = 0;
});

const selected = computed<PresetDisplay | undefined>(() => props.presets[selectedIndex.value]);

function select(index: number) {
    selectedIndex.value = index;
}

function confirm() {
    if (props.presets.length === 0) return;
    emit('confirm', selectedIndex.value);
}

// Escape でキャンセル（タイトルへ戻る）、Enter で決定。表示中のみ有効。
function onKeyDown(e: KeyboardEvent) {
    if (!props.visible) return;
    if (e.key === 'Escape') {
        e.preventDefault();
        emit('cancel');
    } else if (e.key === 'Enter') {
        e.preventDefault();
        confirm();
    }
}

onMounted(() => window.addEventListener('keydown', onKeyDown));
onUnmounted(() => window.removeEventListener('keydown', onKeyDown));
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.6" :z-index="100">
        <div style="padding: 28px 36px; width: 720px; color: #fff;">
            <h2 style="margin: 0 0 20px 0; text-align: center; font-size: 22px;">{{ prompt }}</h2>
            <div style="display: flex; gap: 20px;">
                <!-- 左: プリセット一覧 -->
                <div style="width: 220px; flex-shrink: 0; display: flex; flex-direction: column; gap: 8px;">
                    <button
                        v-for="(p, i) in presets"
                        :key="i"
                        class="button preset-item"
                        :class="{ 'preset-item--selected': i === selectedIndex }"
                        @click="select(i)"
                    >{{ p.label }}</button>
                </div>
                <!-- 右: 選択中プリセットの詳細 -->
                <div
                    style="flex: 1; min-height: 280px; max-height: 360px; overflow-y: auto;
                           background: #111; border: 1px solid #666; border-radius: 4px;
                           padding: 16px 18px; box-sizing: border-box; font-size: 14px; line-height: 1.7;"
                >
                    <template v-if="selected">
                        <h3 style="margin: 0 0 10px 0; font-size: 18px;">{{ selected.label }}</h3>
                        <p
                            v-if="selected.description"
                            style="margin: 0 0 14px 0; white-space: pre-wrap; word-break: break-word; opacity: 0.9;"
                        >{{ selected.description }}</p>
                        <div v-if="selected.statLines.length > 0" style="margin-bottom: 12px;">
                            <div style="opacity: 0.7; margin-bottom: 4px;">ステータス</div>
                            <div style="display: flex; flex-wrap: wrap; gap: 6px 16px;">
                                <span v-for="(s, si) in selected.statLines" :key="si">{{ s.label }} {{ s.value }}</span>
                            </div>
                        </div>
                        <div v-if="selected.skillLabels.length > 0" style="margin-bottom: 12px;">
                            <div style="opacity: 0.7; margin-bottom: 4px;">習得スキル</div>
                            <div>{{ selected.skillLabels.join('、') }}</div>
                        </div>
                        <div v-if="selected.itemLabels.length > 0">
                            <div style="opacity: 0.7; margin-bottom: 4px;">所持アイテム</div>
                            <div>{{ selected.itemLabels.join('、') }}</div>
                        </div>
                    </template>
                </div>
            </div>
            <div style="display: flex; justify-content: center; gap: 16px; margin-top: 24px;">
                <button class="button" @click="confirm">決定</button>
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
</style>
