<script setup lang="ts">
import ModalOverlay from './ModalOverlay.vue';

defineProps<{
    visible: boolean
    errors: string[]
}>();

const emit = defineEmits<{
    close: []
}>();
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.75" :z-index="120" variant="error">
        <div style="padding: 28px 36px; min-width: 500px; max-width: 760px;">
            <h2 style="margin: 0 0 16px 0; text-align: center; font-size: 20px; color: #f88;">
                YAMLデータにエラーがあります
            </h2>
            <ul style="margin: 0 0 16px 0; padding: 0 0 0 20px; max-height: 400px;
                       overflow-y: auto; font-size: 13px; line-height: 1.8; color: #f88;">
                <li v-for="(e, i) in errors" :key="i">{{ e }}</li>
            </ul>
            <p style="margin: 0 0 16px 0; font-size: 13px; opacity: 0.7; text-align: center;">
                YAMLを修正してから再度お試しください。メインメニューに戻ります。
            </p>
            <div style="display: flex; justify-content: center;">
                <button class="button" @click="emit('close')">閉じる</button>
            </div>
        </div>
    </ModalOverlay>
</template>
