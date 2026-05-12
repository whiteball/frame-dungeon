<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { EventBus } from './EventBus';
import StartGame from './main';
import Phaser from 'phaser';
import JSZip from 'jszip';
import { SaveManager } from '../lib/SaveManager';
import type { SaveData, SlotMeta } from '../lib/SaveManager';
import { CustomDataStore, YAML_KEYS } from '../lib/CustomDataStore';
import SettingsDialog from '../components/dialogs/SettingsDialog.vue';
import StatusDialog from '../components/dialogs/StatusDialog.vue';
import SaveDialog from '../components/dialogs/SaveDialog.vue';
import LoadDialog from '../components/dialogs/LoadDialog.vue';
import YamlErrorDialog from '../components/dialogs/YamlErrorDialog.vue';

type SceneAction = { label: string, onClick: () => void, disabled?: boolean };
type ListMode = 'item' | 'equip' | 'drop' | 'skill';
type ItemListEntry = {
    id: string, label: string, description: string,
    isEquipped?: boolean, type?: string, effectJson?: string,
    costSummary?: string, targetSummary?: string,
    disabled?: boolean, disabledReason?: string,
};

const scene = ref();
const game = ref();
const logs = ref<string[]>([]);
const MAX_LOGS = 50;
const logVisible = ref(false);
const logRef = ref<HTMLDivElement | null>(null);
const lastLogTurn = ref(0);
const actions = ref<SceneAction[]>([]);

const itemList = ref<ItemListEntry[]>([]);
const itemListVisible = ref(false);
const selectedIndex = ref(0);
const listRef = ref<HTMLUListElement | null>(null);
const listMode = ref<ListMode>('item');
const actionLabel = ref<string>('使用');

const settingsVisible = ref(false);
const settingsViewRange = ref(3);
const settingsEnableFog = ref(true);
const settingsShowAllEnemies = ref(false);

const statusVisible = ref(false);
const statusText = ref('');

const saveDialogVisible = ref(false);
const saveSlotMetas = ref<SlotMeta[]>([]);

const loadDialogVisible = ref(false);
const loadSlotMetas = ref<SlotMeta[]>([]);

// データ選択・カスタムデータ関連
const gameStarted = ref(false);
const zipError = ref('');
const zipLoading = ref(false);

// YamlCrossValidatorエラー表示
const yamlValidationErrors = ref<string[]>([]);
const yamlErrorVisible = ref(false);

const emit = defineEmits(['current-active-scene']);

function onListKeyDown(e: KeyboardEvent) {
    switch (e.key) {
        case 'ArrowDown':
        case 's':
            if (itemList.value.length > 0) {
                selectedIndex.value = Math.min(itemList.value.length - 1, selectedIndex.value + 1);
            }
            e.preventDefault();
            break;
        case 'ArrowUp':
        case 'w':
            if (itemList.value.length > 0) {
                selectedIndex.value = Math.max(0, selectedIndex.value - 1);
            }
            e.preventDefault();
            break;
        case 'Enter':
        case ' ':
            confirmSelect();
            e.preventDefault();
            break;
        case 'Escape':
            requestClose();
            e.preventDefault();
            break;
        case '1':
        case '2':
        case '3':
        case '4':
        case '5':
        case '6':
        case '7':
        case '8':
        case '9':
        case '0':
            document.getElementById('action-button-' + e.key)?.dispatchEvent(new Event('click'));
            e.preventDefault();
            break;
    }
}

function confirmSelect() {
    const it = itemList.value[selectedIndex.value];
    if (!it) return;
    if (it.disabled) return;
    if (listMode.value === 'equip') {
        EventBus.emit('equip-item', { instanceId: it.id });
    } else if (listMode.value === 'drop') {
        EventBus.emit('drop-item', { instanceId: it.id });
    } else if (listMode.value === 'skill') {
        EventBus.emit('use-skill', { skillName: it.id });
    } else {
        EventBus.emit('use-item', { instanceId: it.id });
    }
}

function showDescription() {
    const it = itemList.value[selectedIndex.value];
    if (!it) return;
    const line1 = `${it.label}:${it.type ?? ''}:${it.description}`;
    const line2 = it.effectJson ?? '{}';
    EventBus.emit('message-log', `${line1}\n${line2}`);
}

function requestClose() {
    EventBus.emit('close-item-list-request');
}

function handleCloseSaveDialog() {
    saveDialogVisible.value = false;
}

async function launchGame(): Promise<void> {
    gameStarted.value = true;
    await nextTick();
    game.value = StartGame('game-container');
}

async function startWithDefault(): Promise<void> {
    // CustomDataStoreには何もセットしない（デフォルトfetchを使用）
    await launchGame();
}

async function handleZipFile(event: Event): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    zipLoading.value = true;
    zipError.value = '';

    try {
        const zip = await JSZip.loadAsync(file);
        const missing: string[] = [];

        for (const key of YAML_KEYS) {
            const entry = zip.file(`${key}.yml`) ?? zip.file(`data/${key}.yml`);
            if (!entry) {
                missing.push(`${key}.yml`);
            } else {
                CustomDataStore.set(key, await entry.async('string'));
            }
        }

        if (missing.length > 0) {
            CustomDataStore.clear();
            zipError.value = `ZIPファイルに以下のファイルが見つかりません:\n${missing.join(', ')}`;
            return;
        }

        await launchGame();
    } catch (e) {
        CustomDataStore.clear();
        zipError.value = `ZIPファイルの読み込みに失敗しました: ${e instanceof Error ? e.message : String(e)}`;
    } finally {
        zipLoading.value = false;
    }
}

onMounted(() => {

    // StartGame() はデータ選択後に呼ぶため、ここでは EventBus リスナのみ登録する

    EventBus.on('current-scene-ready', (scene_instance: Phaser.Scene) => {
        emit('current-active-scene', scene_instance);
        scene.value = scene_instance;
        actions.value = [];
        // Game.ts の create() が removeAllListeners('close-save-dialog') で Vue 側リスナを
        // 消してしまうため、current-scene-ready（removeAllListeners より後に発火）で再登録する
        EventBus.removeListener('close-save-dialog', handleCloseSaveDialog);
        EventBus.on('close-save-dialog', handleCloseSaveDialog);
    });

    EventBus.on('game-scene-start', () => {
        logVisible.value = true;
    });

    EventBus.on('message-log', (message: string, turn?: number) => {
        if (turn && turn !== lastLogTurn.value) {
            logs.value.push(`(${turn}ターン目)`);
            lastLogTurn.value = turn;
        }
        logs.value.push(message);
        if (logs.value.length > MAX_LOGS) logs.value.splice(0, logs.value.length - MAX_LOGS);
        nextTick(() => {
            if (logRef.value) logRef.value.scrollTop = logRef.value.scrollHeight;
        });
    });

    EventBus.on('scene-actions', (list: SceneAction[]) => {
        actions.value = list;
    });

    EventBus.on('reset-message-log', () => {
        logs.value = [];
        lastLogTurn.value = 0;
        logVisible.value = false;
        itemListVisible.value = false;
        itemList.value = [];
        selectedIndex.value = 0;
    });

    EventBus.on('open-item-list', (payload: { items: ItemListEntry[]; mode?: ListMode; actionLabel?: string }) => {
        listMode.value = payload.mode ?? 'item';
        actionLabel.value = payload.actionLabel ?? '使用';
        itemList.value = payload.items;
        if (selectedIndex.value >= itemList.value.length) {
            selectedIndex.value = Math.max(0, itemList.value.length - 1);
        }
        if (!itemListVisible.value) selectedIndex.value = 0;
        itemListVisible.value = true;
        nextTick(() => listRef.value?.focus());
    });

    EventBus.on('close-item-list', () => {
        itemListVisible.value = false;
        itemList.value = [];
        selectedIndex.value = 0;
    });

    EventBus.on('open-settings', (data: { viewRange: number; enableFog: boolean; showAllEnemies: boolean }) => {
        settingsViewRange.value = data.viewRange;
        settingsEnableFog.value = data.enableFog;
        settingsShowAllEnemies.value = data.showAllEnemies;
        settingsVisible.value = true;
    });

    EventBus.on('open-status', (text: string) => {
        statusText.value = text;
        statusVisible.value = true;
    });

    EventBus.on('open-save-dialog', () => {
        saveSlotMetas.value = SaveManager.getAllSlotMeta();
        saveDialogVisible.value = true;
    });

    EventBus.on('open-load-dialog', () => {
        loadSlotMetas.value = SaveManager.getAllSlotMeta();
        loadDialogVisible.value = true;
    });

    EventBus.on('close-load-dialog', () => {
        loadDialogVisible.value = false;
    });

    EventBus.on('yaml-cross-validation-errors', (errors: string[]) => {
        yamlValidationErrors.value = errors;
        yamlErrorVisible.value = true;
    });

});

onUnmounted(() => {

    EventBus.removeListener('game-scene-start');
    EventBus.removeListener('message-log');
    EventBus.removeListener('scene-actions');
    EventBus.removeListener('reset-message-log');
    EventBus.removeListener('open-item-list');
    EventBus.removeListener('close-item-list');
    EventBus.removeListener('open-settings');
    EventBus.removeListener('open-status');
    EventBus.removeListener('open-save-dialog');
    EventBus.removeListener('close-save-dialog', handleCloseSaveDialog);
    EventBus.removeListener('open-load-dialog');
    EventBus.removeListener('close-load-dialog');
    EventBus.removeListener('yaml-cross-validation-errors');

    if (game.value)
    {
        game.value.destroy(true);
        game.value = null;
    }

});

defineExpose({ scene, game });

</script>

<template>
    <!-- データ選択UI（ゲーム未起動時） -->
    <div
        v-if="!gameStarted"
        style="width: 1024px; height: 768px;
               display: flex; justify-content: center; align-items: center;
               background: #0a0a14;"
    >
        <div style="background: #1a1a2e; color: #e0e0e0; border: 2px solid #555;
                    border-radius: 8px; padding: 40px 48px; min-width: 400px;
                    font-family: 'BIZ UDゴシック', Consolas, monospace;
                    box-shadow: 0 0 32px rgba(0,0,0,0.8); text-align: center;">
            <h2 style="margin: 0 0 32px 0; font-size: 22px; letter-spacing: 2px;">ゲームデータを選択</h2>
            <div style="margin-bottom: 24px;">
                <button
                    class="button"
                    style="font-size: 16px; padding: 10px 32px; width: 80%;"
                    @click="startWithDefault"
                >デフォルトデータでプレイ</button>
            </div>
            <div style="border-top: 1px solid #444; padding-top: 24px;">
                <p style="margin: 0 0 12px 0; font-size: 14px; opacity: 0.8;">
                    または ZIPファイルからカスタムデータを読み込む:
                </p>
                <label style="display: inline-block; cursor: pointer;">
                    <input
                        type="file"
                        accept=".zip"
                        :disabled="zipLoading"
                        @change="handleZipFile"
                        style="display: none;"
                    />
                    <span
                        class="button"
                        style="display: inline-block; font-size: 14px; padding: 8px 24px;
                               opacity: 1;"
                        :style="{ opacity: zipLoading ? '0.5' : '1', cursor: zipLoading ? 'not-allowed' : 'pointer' }"
                    >{{ zipLoading ? '読み込み中...' : 'ZIPを選択' }}</span>
                </label>
                <div
                    v-if="zipError"
                    style="margin-top: 16px; padding: 12px; background: #2a1010;
                           border: 1px solid #f55; border-radius: 4px;
                           color: #f88; font-size: 13px; white-space: pre-wrap;
                           text-align: left;"
                >{{ zipError }}</div>
            </div>
        </div>
    </div>

    <!-- ゲーム本体（起動後） -->
    <div v-else style="position: relative; display: inline-block;">
        <div id="game-container"></div>
        <div
            style="position: absolute; left: 0; top: 540px;
                   width: 1024px; height: 50px;
                   display: flex; flex-direction: row; justify-content: flex-start;
                   align-items: center; gap: 8px; padding: 6px;
                   box-sizing: border-box;"
        >
            <button
                v-for="(a, i) in actions"
                :key="i"
                :id="'action-button-' + ((i + 1) % 10)"
                class="button"
                :disabled="a.disabled"
                @mousedown.prevent
                @click="a.onClick"
            >{{ a.label }}</button>
        </div>
        <div
            ref="logRef"
            v-show="logVisible"
            style="position: absolute; left: 10px; top: 590px;
                   width: 760px; height: 170px;
                   background: rgba(0,0,0,0.7); color: white;
                   font-family: 'BIZ UDゴシック', Consolas, monospace;
                   font-size: 13px; border: 1px solid #444;
                   overflow-y: auto; box-sizing: border-box; padding: 6px;"
        >
            <div
                v-for="(log, i) in logs"
                :key="i"
                :style="{ whiteSpace: 'pre-wrap', ...(/^\(\d+ターン目\)$/.test(log) ? {opacity: '0.55', fontSize: '11px', marginTop: '6px'} : {})}"
            >{{ log }}</div>
        </div>
        <div
            v-show="itemListVisible"
            style="position: absolute; left: 10px; top: 10px;
                   width: 760px; height: 520px;
                   display: flex; justify-content: center; align-items: center;
                   pointer-events: none;"
        >
            <span
                style="font-family: 'BIZ UDゴシック', Consolas, monospace;
                       font-size: 36px; font-weight: bold; color: #fff;
                       background: rgba(0, 0, 0, 0.8);
                       border: 2px solid #fff;
                       border-radius: 6px;
                       padding: 12px 32px;
                       box-shadow: 0 0 12px rgba(0, 0, 0, 0.6);"
            >{{ listMode === 'skill' ? 'スキル選択中' : listMode === 'equip' ? '装備変更中' : listMode === 'drop' ? '置くもの選択中' : 'アイテム選択中' }}</span>
        </div>
        <div
            v-show="itemListVisible"
            style="position: absolute; left: 780px; top: 590px;
                   width: 234px; height: 170px;
                   background: rgba(0,0,0,0.85); color: white;
                   font-family: 'BIZ UDゴシック', Consolas, monospace;
                   font-size: 13px; border: 1px solid #666;
                   display: flex; flex-direction: column; box-sizing: border-box;"
        >
            <ul
                ref="listRef"
                tabindex="0"
                @keydown="onListKeyDown"
                style="list-style: none; margin: 0; padding: 4px; flex: 1;
                       overflow-y: auto; outline: none;"
            >
                <li
                    v-for="(it, i) in itemList"
                    :key="it.id"
                    @click="selectedIndex = i"
                    @dblclick="confirmSelect"
                    :style="{
                        padding: '2px 4px',
                        cursor: it.disabled ? 'not-allowed' : 'pointer',
                        opacity: it.disabled ? 0.5 : 1,
                        background: i === selectedIndex ? '#335' : 'transparent'
                    }"
                    :title="it.disabled && it.disabledReason ? it.disabledReason : it.description"
                >{{ (it.isEquipped ? '[E] ' : '') + it.label }}</li>
                <li
                    v-if="itemList.length === 0"
                    style="padding: 2px 4px; opacity: 0.6;"
                >{{ listMode === 'skill' ? '習得しているスキルがない' : listMode === 'equip' ? '装備できる物がない' : listMode === 'drop' ? '置けるアイテムがない' : '使える薬がない' }}</li>
            </ul>
            <div style="display: flex; gap: 4px; padding: 4px; border-top: 1px solid #666;">
                <button
                    class="button"
                    @click="confirmSelect"
                    :disabled="itemList.length === 0"
                >{{ actionLabel }}</button>
                <button
                    class="button"
                    @click="showDescription"
                    :disabled="itemList.length === 0"
                >説明</button>
                <button class="button" @click="requestClose">閉</button>
            </div>
        </div>

        <SettingsDialog
            :visible="settingsVisible"
            :initial-view-range="settingsViewRange"
            :initial-enable-fog="settingsEnableFog"
            :initial-show-all-enemies="settingsShowAllEnemies"
            @confirm="(p) => { EventBus.emit('settings-confirmed', p); settingsVisible = false; }"
            @cancel="settingsVisible = false"
        />
        <StatusDialog
            :visible="statusVisible"
            :status-text="statusText"
            @close="statusVisible = false"
        />
        <SaveDialog
            :visible="saveDialogVisible"
            :slot-metas="saveSlotMetas"
            @save="(p) => EventBus.emit('save-to-slot', p)"
            @cancel="() => { saveDialogVisible = false; EventBus.emit('close-save-dialog'); }"
        />
        <LoadDialog
            :visible="loadDialogVisible"
            :slot-metas="loadSlotMetas"
            @load-confirmed="(saveData: SaveData) => EventBus.emit('load-game', saveData)"
            @close="loadDialogVisible = false"
        />
        <YamlErrorDialog
            :visible="yamlErrorVisible"
            :errors="yamlValidationErrors"
            @close="yamlErrorVisible = false"
        />
    </div>
</template>
