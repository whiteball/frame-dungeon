<script setup lang="ts">
import ModalOverlay from './ModalOverlay.vue';

defineProps<{
    visible: boolean
    statusText: string
}>();

const emit = defineEmits<{
    close: []
}>();
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.6" :z-index="100">
        <div style="padding: 32px 40px; min-width: 380px; color: #fff;">
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
                <button class="button" @click="emit('close')">閉じる</button>
            </div>
        </div>
    </ModalOverlay>
</template>
