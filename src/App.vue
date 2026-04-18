<script setup lang="ts">
import { ref, toRaw } from 'vue';
import type { MainMenu } from './game/scenes/MainMenu';
import PhaserGame from './game/PhaserGame.vue';

const phaserRef = ref();

const changeScene = () => {
    const scene = toRaw(phaserRef.value.scene) as MainMenu;
    if (scene) {
        scene.changeScene();
    }
}
</script>

<template>
    <PhaserGame ref="phaserRef" />
    <div>
        <div>
            <button class="button" @click="changeScene">Change Scene</button>
        </div>
    </div>
</template>
