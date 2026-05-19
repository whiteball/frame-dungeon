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

const fileInput = ref<HTMLInputElement | null>(null);
const importPendingData = ref<SaveData | null>(null);
const importErrorMessage = ref<string>('');
const isDragOver = ref(false);

watch(() => props.visible, (v) => {
    if (!v) {
        digestMismatchVisible.value = false;
        digestMismatchSaveData.value = null;
        importPendingData.value = null;
        importErrorMessage.value = '';
        isDragOver.value = false;
    }
});

async function proceedLoad(saveData: SaveData) {
    const currentDigest = await SaveManager.calculateDigest();
    if (currentDigest !== saveData.meta.yamlDigest) {
        digestMismatchSaveData.value = saveData;
        digestMismatchVisible.value = true;
        importPendingData.value = null;
    } else {
        emit('loadConfirmed', saveData);
    }
}

async function handleLoadClick(slot: number) {
    const saveData = SaveManager.loadFromSlot(slot);
    if (!saveData) return;
    await proceedLoad(saveData);
}

function confirmMismatch() {
    if (digestMismatchSaveData.value) {
        emit('loadConfirmed', digestMismatchSaveData.value);
        digestMismatchSaveData.value = null;
    }
    digestMismatchVisible.value = false;
}

function onImportClick() {
    if (!fileInput.value) return;
    fileInput.value.value = '';
    fileInput.value.click();
}

function onFileChosen(e: Event) {
    const target = e.target as HTMLInputElement;
    const file = target.files?.[0];
    if (file) void handleImportFile(file);
}

function onDrop(e: DragEvent) {
    isDragOver.value = false;
    const file = e.dataTransfer?.files?.[0];
    if (file) void handleImportFile(file);
}

function readFileAsText(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = () => reject(reader.error ?? new Error('ファイル読み込みエラー'));
        reader.readAsText(file);
    });
}

async function handleImportFile(file: File) {
    try {
        const text = await readFileAsText(file);
        importPendingData.value = SaveManager.parseImportedText(text);
        importErrorMessage.value = '';
    } catch (e: unknown) {
        importErrorMessage.value = (e instanceof Error ? e.message : '') || 'ファイルの読み込みに失敗しました';
        importPendingData.value = null;
    }
}

async function onImportConfirm() {
    if (importPendingData.value) {
        await proceedLoad(importPendingData.value);
    }
}

function onImportCancel() {
    importPendingData.value = null;
}

function onErrorClose() {
    importErrorMessage.value = '';
}
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.65" :z-index="110">
        <div
            :style="{
                padding: '24px 32px',
                minWidth: '560px',
                boxShadow: isDragOver ? 'inset 0 0 0 2px #0ec3c9' : 'none',
                borderRadius: '8px',
            }"
            @dragenter.prevent="isDragOver = true"
            @dragover.prevent="isDragOver = true"
            @dragleave.prevent="isDragOver = false"
            @drop.prevent="onDrop"
        >
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
            <!-- インポート確認パネル -->
            <div
                v-else-if="importPendingData"
                style="background: #2a1010; border: 1px solid #f55;
                       border-radius: 6px; padding: 16px; margin-bottom: 12px;"
            >
                <p style="margin: 0 0 10px 0; line-height: 1.6;">
                    このデータを読み込みます。よろしいですか？
                </p>
                <div style="font-size: 11px; line-height: 1.6; margin-bottom: 12px;">
                    {{ importPendingData.meta.gameName }} {{ importPendingData.floor }}F<br>
                    {{ importPendingData.meta.savedAt.slice(0, 16).replace('T', ' ') }}<br>
                    <span style="opacity: 0.7;">{{ importPendingData.meta.memo ? '「' + importPendingData.meta.memo + '」' : '' }}</span>
                </div>
                <div style="display: flex; justify-content: center; gap: 16px;">
                    <button class="button" @click="onImportConfirm">読み込む</button>
                    <button class="button" @click="onImportCancel">キャンセル</button>
                </div>
            </div>
            <!-- インポートエラーパネル -->
            <div
                v-else-if="importErrorMessage"
                style="background: #2a1010; border: 1px solid #f55;
                       border-radius: 6px; padding: 16px; margin-bottom: 12px;"
            >
                <p style="margin: 0 0 12px 0; line-height: 1.6;">
                    {{ importErrorMessage }}
                </p>
                <div style="display: flex; justify-content: center;">
                    <button class="button" @click="onErrorClose">閉じる</button>
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
            <div
                v-if="!digestMismatchVisible && !importPendingData && !importErrorMessage"
                style="display: flex; justify-content: center; gap: 16px;"
            >
                <button class="button" @click="onImportClick">インポート</button>
                <button class="button" @click="emit('close')">閉じる</button>
            </div>
            <input ref="fileInput" type="file" accept=".sav" style="display: none" @change="onFileChosen" />
        </div>
    </ModalOverlay>
</template>
