<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { EventBus } from './EventBus';
import StartGame from './main';
import Phaser from 'phaser';
import JSZip from 'jszip';
import { SaveManager } from '../lib/SaveManager';
import type { SaveData, SlotMeta } from '../lib/SaveManager';
import { CustomDataStore, YAML_KEYS } from '../lib/CustomDataStore';

type SceneAction = { label: string, onClick: () => void, disabled?: boolean };
type ListMode = 'item' | 'equip' | 'drop';
type ItemListEntry = { id: string, label: string, description: string, isEquipped?: boolean, type?: string, effectJson?: string };

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
const selectedSaveSlot = ref(1);
const saveMemo = ref('');

const loadDialogVisible = ref(false);
const loadSlotMetas = ref<SlotMeta[]>([]);
const digestMismatchVisible = ref(false);
const digestMismatchSaveData = ref<SaveData | null>(null);

// データ選択・カスタムデータ関連
const gameStarted = ref(false);
const zipError = ref('');
const zipLoading = ref(false);

// YamlCrossValidatorエラー表示
const yamlValidationErrors = ref<string[]>([]);
const yamlErrorVisible = ref(false);

function closeStatus() {
    statusVisible.value = false;
}

function executeSave() {
    EventBus.emit('save-to-slot', { slot: selectedSaveSlot.value, memo: saveMemo.value });
}

function cancelSave() {
    saveDialogVisible.value = false;
    EventBus.emit('close-save-dialog');
}

async function requestLoad(slot: number) {
    const saveData = SaveManager.loadFromSlot(slot);
    if (!saveData) return;
    const currentDigest = await SaveManager.calculateDigest();
    if (currentDigest !== saveData.meta.yamlDigest) {
        digestMismatchSaveData.value = saveData;
        digestMismatchVisible.value = true;
    } else {
        EventBus.emit('load-game', saveData);
    }
}

function confirmDigestMismatch() {
    if (digestMismatchSaveData.value) {
        EventBus.emit('load-game', digestMismatchSaveData.value);
        digestMismatchSaveData.value = null;
    }
    digestMismatchVisible.value = false;
}

function confirmSettings() {
    EventBus.emit('settings-confirmed', {
        viewRange: settingsViewRange.value,
        enableFog: settingsEnableFog.value,
        showAllEnemies: settingsShowAllEnemies.value,
    });
    settingsVisible.value = false;
}

function cancelSettings() {
    settingsVisible.value = false;
}

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
    if (listMode.value === 'equip') {
        EventBus.emit('equip-item', { instanceId: it.id });
    } else if (listMode.value === 'drop') {
        EventBus.emit('drop-item', { instanceId: it.id });
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
        selectedSaveSlot.value = 1;
        saveMemo.value = '';
        saveDialogVisible.value = true;
    });

    EventBus.on('open-load-dialog', () => {
        loadSlotMetas.value = SaveManager.getAllSlotMeta();
        loadDialogVisible.value = true;
        digestMismatchVisible.value = false;
    });

    EventBus.on('close-load-dialog', () => {
        loadDialogVisible.value = false;
        digestMismatchVisible.value = false;
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
            >{{ listMode === 'equip' ? '装備変更中' : listMode === 'drop' ? '置くもの選択中' : 'アイテム選択中' }}</span>
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
                    :style="{ padding: '2px 4px', cursor: 'pointer',
                              background: i === selectedIndex ? '#335' : 'transparent' }"
                    :title="it.description"
                >{{ (it.isEquipped ? '[E] ' : '') + it.label }}</li>
                <li
                    v-if="itemList.length === 0"
                    style="padding: 2px 4px; opacity: 0.6;"
                >{{ listMode === 'equip' ? '装備できる物がない' : listMode === 'drop' ? '置けるアイテムがない' : '使える薬がない' }}</li>
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
        <div
            v-show="settingsVisible"
            style="position: absolute; left: 0; top: 0;
                   width: 1024px; height: 768px;
                   background: rgba(0,0,0,0.6);
                   display: flex; justify-content: center; align-items: center;
                   z-index: 100;"
        >
            <div style="background: #1a1a2e; color: #fff; border: 2px solid #555;
                        border-radius: 8px; padding: 32px 40px; min-width: 320px;
                        font-family: 'BIZ UDゴシック', Consolas, monospace;
                        box-shadow: 0 0 32px rgba(0,0,0,0.8);">
                <h2 style="margin: 0 0 24px 0; text-align: center; font-size: 22px;">設定</h2>
                <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
                    <tr>
                        <td style="padding: 8px 16px 8px 0; white-space: nowrap;">プレイヤーの視界</td>
                        <td style="padding: 8px 0;">
                            <input
                                type="number"
                                v-model.number="settingsViewRange"
                                min="1"
                                step="1"
                                style="width: 80px; background: #333; color: #fff;
                                       border: 1px solid #666; border-radius: 4px;
                                       padding: 4px 8px; font-size: 15px;"
                            />
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 16px 8px 0; white-space: nowrap;">フォグの有無</td>
                        <td style="padding: 8px 0;">
                            <input
                                type="checkbox"
                                v-model="settingsEnableFog"
                                style="width: 18px; height: 18px; cursor: pointer;"
                            />
                        </td>
                    </tr>
                    <tr>
                        <td style="padding: 8px 16px 8px 0; white-space: nowrap;">常に敵を表示</td>
                        <td style="padding: 8px 0;">
                            <input
                                type="checkbox"
                                v-model="settingsShowAllEnemies"
                                style="width: 18px; height: 18px; cursor: pointer;"
                            />
                        </td>
                    </tr>
                </table>
                <div style="display: flex; justify-content: center; gap: 16px;">
                    <button class="button" @click="confirmSettings">OK</button>
                    <button class="button" @click="cancelSettings">キャンセル</button>
                </div>
            </div>
        </div>
        <div
            v-show="statusVisible"
            style="position: absolute; left: 0; top: 0;
                   width: 1024px; height: 768px;
                   background: rgba(0,0,0,0.6);
                   display: flex; justify-content: center; align-items: center;
                   z-index: 100;"
        >
            <div style="background: #1a1a2e; color: #fff; border: 2px solid #555;
                        border-radius: 8px; padding: 32px 40px; min-width: 380px;
                        font-family: 'BIZ UDゴシック', Consolas, monospace;
                        box-shadow: 0 0 32px rgba(0,0,0,0.8);">
                <h2 style="margin: 0 0 16px 0; text-align: center; font-size: 22px;">ステータス</h2>
                <textarea
                    :value="statusText"
                    readonly
                    style="width: 100%; height: 400px; resize: none;
                           background: #111; color: #fff;
                           border: 1px solid #666; border-radius: 4px;
                           padding: 8px; box-sizing: border-box;
                           font-family: 'BIZ UDゴシック', Consolas, monospace;
                           font-size: 14px; line-height: 1.6;"
                ></textarea>
                <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                    <button class="button" @click="closeStatus">閉じる</button>
                </div>
            </div>
        </div>
        <!-- セーブダイアログ -->
        <div
            v-show="saveDialogVisible"
            style="position: absolute; left: 0; top: 0;
                   width: 1024px; height: 768px;
                   background: rgba(0,0,0,0.65);
                   display: flex; justify-content: center; align-items: center;
                   z-index: 110;"
        >
            <div style="background: #1a1a2e; color: #e0e0e0; border: 2px solid #555;
                        border-radius: 8px; padding: 24px 32px; min-width: 560px;
                        font-family: 'BIZ UDゴシック', Consolas, monospace;
                        box-shadow: 0 0 32px rgba(0,0,0,0.8);">
                <h2 style="margin: 0 0 14px 0; text-align: center; font-size: 20px;">セーブ</h2>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 14px;">
                    <label
                        v-for="i in 10"
                        :key="i"
                        :style="{
                            display: 'flex', alignItems: 'flex-start', gap: '8px',
                            padding: '7px', border: '1px solid #444', borderRadius: '4px',
                            cursor: 'pointer',
                            background: selectedSaveSlot === i ? '#2a2a5e' : 'transparent',
                        }"
                    >
                        <input type="radio" v-model="selectedSaveSlot" :value="i" style="margin-top: 3px; flex-shrink: 0;" />
                        <span style="flex: 1; font-size: 11px; line-height: 1.5;">
                            <span style="opacity: 0.7;">スロット{{ String(i).padStart(2,'0') }} </span>
                            <template v-if="saveSlotMetas[i-1] && !saveSlotMetas[i-1].isEmpty">
                                {{ saveSlotMetas[i-1].gameName }} {{ saveSlotMetas[i-1].floor }}F<br>
                                {{ saveSlotMetas[i-1].savedAt?.slice(0,16).replace('T',' ') }}<br>
                                <span style="opacity: 0.7;">{{ saveSlotMetas[i-1].memo }}</span>
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
                        v-model="saveMemo"
                        maxlength="50"
                        @keydown.stop
                        style="background: #2a2a3e; color: #e0e0e0;
                               border: 1px solid #666; border-radius: 4px;
                               padding: 4px 8px; width: 280px; margin-left: 8px;
                               font-family: 'BIZ UDゴシック', Consolas, monospace;"
                    />
                </div>
                <div style="display: flex; justify-content: center; gap: 16px;">
                    <button class="button" @click="executeSave">保存</button>
                    <button class="button" @click="cancelSave">キャンセル</button>
                </div>
            </div>
        </div>
        <!-- ロードダイアログ -->
        <div
            v-show="loadDialogVisible"
            style="position: absolute; left: 0; top: 0;
                   width: 1024px; height: 768px;
                   background: rgba(0,0,0,0.65);
                   display: flex; justify-content: center; align-items: center;
                   z-index: 110;"
        >
            <div style="background: #1a1a2e; color: #e0e0e0; border: 2px solid #555;
                        border-radius: 8px; padding: 24px 32px; min-width: 560px;
                        font-family: 'BIZ UDゴシック', Consolas, monospace;
                        box-shadow: 0 0 32px rgba(0,0,0,0.8);">
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
                        <button class="button" @click="confirmDigestMismatch">このまま続ける</button>
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
                            :disabled="!loadSlotMetas[i-1] || !!loadSlotMetas[i-1].isEmpty"
                            @click="requestLoad(i)"
                            style="flex-shrink: 0;"
                        >ロード</button>
                        <span style="flex: 1; font-size: 11px; line-height: 1.5;">
                            <template v-if="loadSlotMetas[i-1] && !loadSlotMetas[i-1].isEmpty">
                                {{ loadSlotMetas[i-1].gameName }} {{ loadSlotMetas[i-1].floor }}F<br>
                                {{ loadSlotMetas[i-1].savedAt?.slice(0,16).replace('T',' ') }}<br>
                                <span style="opacity: 0.7;">{{ loadSlotMetas[i-1].memo ? '「' + loadSlotMetas[i-1].memo + '」' : '' }}</span>
                            </template>
                            <template v-else>
                                <span style="opacity: 0.4;">─ データなし ─</span>
                            </template>
                        </span>
                    </div>
                </div>
                <div v-if="!digestMismatchVisible" style="display: flex; justify-content: center;">
                    <button class="button" @click="loadDialogVisible = false">閉じる</button>
                </div>
            </div>
        </div>
        <!-- YamlCrossValidatorエラーモーダル -->
        <div
            v-show="yamlErrorVisible"
            style="position: absolute; left: 0; top: 0;
                   width: 1024px; height: 768px;
                   background: rgba(0,0,0,0.75);
                   display: flex; justify-content: center; align-items: center;
                   z-index: 120;"
        >
            <div style="background: #1a0a0a; color: #e0e0e0; border: 2px solid #f55;
                        border-radius: 8px; padding: 28px 36px; min-width: 500px; max-width: 760px;
                        font-family: 'BIZ UDゴシック', Consolas, monospace;
                        box-shadow: 0 0 32px rgba(0,0,0,0.9);">
                <h2 style="margin: 0 0 16px 0; text-align: center; font-size: 20px; color: #f88;">
                    YAMLデータにエラーがあります
                </h2>
                <ul style="margin: 0 0 16px 0; padding: 0 0 0 20px; max-height: 400px;
                           overflow-y: auto; font-size: 13px; line-height: 1.8; color: #f88;">
                    <li v-for="(e, i) in yamlValidationErrors" :key="i">{{ e }}</li>
                </ul>
                <p style="margin: 0 0 16px 0; font-size: 13px; opacity: 0.7; text-align: center;">
                    YAMLを修正してから再度お試しください。メインメニューに戻ります。
                </p>
                <div style="display: flex; justify-content: center;">
                    <button class="button" @click="yamlErrorVisible = false">閉じる</button>
                </div>
            </div>
        </div>
    </div>
</template>
