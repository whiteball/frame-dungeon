<script setup lang="ts">
import ModalOverlay from './ModalOverlay.vue';

withDefaults(defineProps<{
    visible: boolean
    text: string
    title?: string
    author?: string | null
}>(), {
    title: 'あらすじ',
    author: null
});

const emit = defineEmits<{
    close: []
}>();
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.6" :z-index="100">
        <div style="padding: 32px 40px; min-width: 480px; max-width: 720px; color: #fff;">
            <h2 style="margin: 0 0 16px 0; text-align: center; font-size: 22px;">{{ title }}</h2>
            <p
                v-if="author"
                style="margin: 0 0 8px 0; text-align: right; font-size: 14px; opacity: 0.85;"
            >作者：{{ author }}</p>
            <div
                style="width: 100%; max-height: 420px; overflow-y: auto;
                       white-space: pre-wrap; word-break: break-word;
                       background: #111; color: #fff;
                       border: 1px solid #666; border-radius: 4px;
                       padding: 12px 16px; box-sizing: border-box;
                       font-family: 'BIZ UDゴシック', Consolas, monospace;
                       font-size: 14px; line-height: 1.8;"
            >{{ text }}</div>
            <div style="display: flex; justify-content: flex-end; margin-top: 16px;">
                <button class="button" @click="emit('close')">閉じる</button>
            </div>
        </div>
    </ModalOverlay>
</template>
