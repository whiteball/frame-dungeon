<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue';
import { EventBus } from './EventBus';
import StartGame from './main';
import Phaser from 'phaser';

const scene = ref();
const game = ref();
const logs = ref<string[]>([]);
const MAX_LOGS = 50;
const logVisible = ref(false);

const emit = defineEmits(['current-active-scene']);

onMounted(() => {

    game.value = StartGame('game-container');

    EventBus.on('current-scene-ready', (scene_instance: Phaser.Scene) => {
        emit('current-active-scene', scene_instance);
        scene.value = scene_instance;
    });

    EventBus.on('game-scene-start', () => {
        logVisible.value = true;
    });

    EventBus.on('message-log', (message: string) => {
        logs.value.unshift(message);
        if (logs.value.length > MAX_LOGS) logs.value.length = MAX_LOGS;
    });

});

onUnmounted(() => {

    EventBus.removeListener('game-scene-start');
    EventBus.removeListener('message-log');

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
        <textarea
            v-show="logVisible"
            readonly
            :value="logs.join('\n')"
            style="position: absolute; left: 10px; top: 540px;
                   width: 760px; height: 210px;
                   background: rgba(0,0,0,0.7); color: white;
                   font-family: 'BIZ UDゴシック', Consolas, monospace;
                   font-size: 13px; border: 1px solid #444;
                   resize: none; box-sizing: border-box; padding: 6px;"
        ></textarea>
    </div>
</template>