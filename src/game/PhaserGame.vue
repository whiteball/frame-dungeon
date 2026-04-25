<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, ref } from 'vue';
import { EventBus } from './EventBus';
import StartGame from './main';
import Phaser from 'phaser';

type SceneAction = { label: string, onClick: () => void };
type ListMode = 'item' | 'equip';
type ItemListEntry = { id: string, label: string, description: string, isEquipped?: boolean };

const scene = ref();
const game = ref();
const logs = ref<string[]>([]);
const MAX_LOGS = 50;
const logVisible = ref(false);
const actions = ref<SceneAction[]>([]);

const itemList = ref<ItemListEntry[]>([]);
const itemListVisible = ref(false);
const selectedIndex = ref(0);
const listRef = ref<HTMLUListElement | null>(null);
const listMode = ref<ListMode>('item');
const actionLabel = ref<string>('使用');

const emit = defineEmits(['current-active-scene']);

function onListKeyDown(e: KeyboardEvent) {
    if (e.key === 'ArrowDown') {
        if (itemList.value.length > 0) {
            selectedIndex.value = Math.min(itemList.value.length - 1, selectedIndex.value + 1);
        }
        e.preventDefault();
    } else if (e.key === 'ArrowUp') {
        if (itemList.value.length > 0) {
            selectedIndex.value = Math.max(0, selectedIndex.value - 1);
        }
        e.preventDefault();
    } else if (e.key === 'Enter') {
        confirmSelect();
        e.preventDefault();
    } else if (e.key === 'Escape') {
        requestClose();
        e.preventDefault();
    }
}

function confirmSelect() {
    const it = itemList.value[selectedIndex.value];
    if (!it) return;
    if (listMode.value === 'equip') {
        EventBus.emit('equip-item', { instanceId: it.id });
    } else {
        EventBus.emit('use-item', { instanceId: it.id });
    }
}

function requestClose() {
    EventBus.emit('close-item-list-request');
}

onMounted(() => {

    game.value = StartGame('game-container');

    EventBus.on('current-scene-ready', (scene_instance: Phaser.Scene) => {
        emit('current-active-scene', scene_instance);
        scene.value = scene_instance;
        actions.value = [];
    });

    EventBus.on('game-scene-start', () => {
        logVisible.value = true;
    });

    EventBus.on('message-log', (message: string) => {
        logs.value.unshift(message);
        if (logs.value.length > MAX_LOGS) logs.value.length = MAX_LOGS;
    });

    EventBus.on('scene-actions', (list: SceneAction[]) => {
        actions.value = list;
    });

    EventBus.on('reset-message-log', () => {
        logs.value = [];
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

});

onUnmounted(() => {

    EventBus.removeListener('game-scene-start');
    EventBus.removeListener('message-log');
    EventBus.removeListener('scene-actions');
    EventBus.removeListener('reset-message-log');
    EventBus.removeListener('open-item-list');
    EventBus.removeListener('close-item-list');

    if (game.value)
    {
        game.value.destroy(true);
        game.value = null;
    }

});

defineExpose({ scene, game });

</script>

<template>
    <div style="position: relative; display: inline-block;">
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
                class="button"
                @click="a.onClick"
            >{{ a.label }}</button>
        </div>
        <textarea
            v-show="logVisible"
            readonly
            :value="logs.join('\n')"
            style="position: absolute; left: 10px; top: 590px;
                   width: 760px; height: 170px;
                   background: rgba(0,0,0,0.7); color: white;
                   font-family: 'BIZ UDゴシック', Consolas, monospace;
                   font-size: 13px; border: 1px solid #444;
                   resize: none; box-sizing: border-box; padding: 6px;"
        ></textarea>
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
            >{{ listMode === 'equip' ? '装備変更中' : 'アイテム選択中' }}</span>
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
                >{{ listMode === 'equip' ? '装備できる物がない' : '使える薬がない' }}</li>
            </ul>
            <div style="display: flex; gap: 4px; padding: 4px; border-top: 1px solid #666;">
                <button
                    class="button"
                    @click="confirmSelect"
                    :disabled="itemList.length === 0"
                >{{ actionLabel }}</button>
                <button class="button" @click="requestClose">閉じる</button>
            </div>
        </div>
    </div>
</template>
