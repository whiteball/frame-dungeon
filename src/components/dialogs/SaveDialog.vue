<script setup lang="ts">
import { ref, watch } from 'vue';
import ModalOverlay from './ModalOverlay.vue';
import type { SlotMeta } from '../../lib/SaveManager';

const props = defineProps<{
    visible: boolean
    slotMetas: SlotMeta[]
}>();

const emit = defineEmits<{
    save: [payload: { slot: number; memo: string }]
    cancel: []
}>();

const selectedSlot = ref(1);
const memo = ref('');

watch(() => props.visible, (v) => {
    if (v) {
        selectedSlot.value = 1;
        memo.value = '';
    }
});
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.65" :z-index="110">
        <div style="padding: 24px 32px; min-width: 560px;">
            <h2 style="margin: 0 0 14px 0; text-align: center; font-size: 20px;">セーブ</h2>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 14px;">
                <label
                    v-for="i in 10"
                    :key="i"
                    :style="{
                        display: 'flex', alignItems: 'flex-start', gap: '8px',
                        padding: '7px', border: '1px solid #444', borderRadius: '4px',
                        cursor: 'pointer',
                        background: selectedSlot === i ? '#2a2a5e' : 'transparent',
                    }"
                >
                    <input type="radio" v-model="selectedSlot" :value="i" style="margin-top: 3px; flex-shrink: 0;" />
                    <span style="flex: 1; font-size: 11px; line-height: 1.5;">
                        <span style="opacity: 0.7;">スロット{{ String(i).padStart(2, '0') }} </span>
                        <template v-if="slotMetas[i-1] && !slotMetas[i-1].isEmpty">
                            {{ slotMetas[i-1].gameName }} {{ slotMetas[i-1].floor }}F<br>
                            {{ slotMetas[i-1].savedAt?.slice(0, 16).replace('T', ' ') }}<br>
                            <span style="opacity: 0.7;">{{ slotMetas[i-1].memo }}</span>
                        </template>
                        <template v-else>
                            <span style="opacity: 0.4;">─ 空きスロット ─</span>
                        </template>
                    </span>
                </label>
            </div>
            <div style="margin-bottom: 14px; font-size: 13px;">
                メモ:
                <input
                    type="text"
                    v-model="memo"
                    maxlength="50"
                    @keydown.stop
                    style="background: #2a2a3e; color: #e0e0e0;
                           border: 1px solid #666; border-radius: 4px;
                           padding: 4px 8px; width: 280px; margin-left: 8px;
                           font-family: 'BIZ UDゴシック', Consolas, monospace;"
                />
            </div>
            <div style="display: flex; justify-content: center; gap: 16px;">
                <button class="button" @click="emit('save', { slot: selectedSlot, memo })">保存</button>
                <button class="button" @click="emit('cancel')">キャンセル</button>
            </div>
        </div>
    </ModalOverlay>
</template>
