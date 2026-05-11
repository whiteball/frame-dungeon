<script setup lang="ts">
import { ref, watch } from 'vue';
import ModalOverlay from './ModalOverlay.vue';
import { SaveManager } from '../../lib/SaveManager';
import type { SaveData, SlotMeta } from '../../lib/SaveManager';

const props = defineProps<{
    visible: boolean
    slotMetas: SlotMeta[]
}>();

const emit = defineEmits<{
    loadConfirmed: [saveData: SaveData]
    close: []
}>();

const digestMismatchVisible = ref(false);
const digestMismatchSaveData = ref<SaveData | null>(null);

watch(() => props.visible, (v) => {
    if (!v) {
        digestMismatchVisible.value = false;
        digestMismatchSaveData.value = null;
    }
});

async function handleLoadClick(slot: number) {
    const saveData = SaveManager.loadFromSlot(slot);
    if (!saveData) return;
    const currentDigest = await SaveManager.calculateDigest();
    if (currentDigest !== saveData.meta.yamlDigest) {
        digestMismatchSaveData.value = saveData;
        digestMismatchVisible.value = true;
    } else {
        emit('loadConfirmed', saveData);
    }
}

function confirmMismatch() {
    if (digestMismatchSaveData.value) {
        emit('loadConfirmed', digestMismatchSaveData.value);
        digestMismatchSaveData.value = null;
    }
    digestMismatchVisible.value = false;
}
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.65" :z-index="110">
        <div style="padding: 24px 32px; min-width: 560px;">
            <h2 style="margin: 0 0 14px 0; text-align: center; font-size: 20px;">ロード</h2>
            <!-- ダイジェスト不一致確認パネル -->
            <div
                v-if="digestMismatchVisible"
                style="background: #2a1010; border: 1px solid #f55;
                       border-radius: 6px; padding: 16px; margin-bottom: 12px;"
            >
                <p style="margin: 0 0 12px 0; line-height: 1.6;">
                    セーブデータのゲームバージョンが現在と異なります。<br>
                    このまま続けると不具合が発生する可能性があります。
                </p>
                <div style="display: flex; justify-content: center; gap: 16px;">
                    <button class="button" @click="confirmMismatch">このまま続ける</button>
                    <button class="button" @click="digestMismatchVisible = false">戻る</button>
                </div>
            </div>
            <!-- スロット一覧 -->
            <div v-else style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 14px;">
                <div
                    v-for="i in 10"
                    :key="i"
                    style="display: flex; align-items: flex-start; gap: 8px;
                           padding: 7px; border: 1px solid #444; border-radius: 4px;"
                >
                    <button
                        class="button"
                        :disabled="!slotMetas[i-1] || !!slotMetas[i-1].isEmpty"
                        @click="handleLoadClick(i)"
                        style="flex-shrink: 0;"
                    >ロード</button>
                    <span style="flex: 1; font-size: 11px; line-height: 1.5;">
                        <template v-if="slotMetas[i-1] && !slotMetas[i-1].isEmpty">
                            {{ slotMetas[i-1].gameName }} {{ slotMetas[i-1].floor }}F<br>
                            {{ slotMetas[i-1].savedAt?.slice(0, 16).replace('T', ' ') }}<br>
                            <span style="opacity: 0.7;">{{ slotMetas[i-1].memo ? '「' + slotMetas[i-1].memo + '」' : '' }}</span>
                        </template>
                        <template v-else>
                            <span style="opacity: 0.4;">─ データなし ─</span>
                        </template>
                    </span>
                </div>
            </div>
            <div v-if="!digestMismatchVisible" style="display: flex; justify-content: center;">
                <button class="button" @click="emit('close')">閉じる</button>
            </div>
        </div>
    </ModalOverlay>
</template>
