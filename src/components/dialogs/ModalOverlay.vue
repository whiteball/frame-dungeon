<script setup lang="ts">
defineProps<{
    visible: boolean
    zIndex?: number
    bgAlpha?: number
    variant?: 'default' | 'error'
}>();
</script>

<template>
    <div
        v-show="visible"
        class="modal-overlay"
        :style="{
            background: `rgba(0,0,0,${bgAlpha ?? 0.65})`,
            zIndex: zIndex ?? 100,
        }"
    >
        <div :class="['dialog-box', variant === 'error' ? 'dialog-box--error' : '']">
            <slot />
        </div>
    </div>
</template>

<style scoped>
.modal-overlay {
    position: absolute;
    left: 0;
    top: 0;
    width: 1024px;
    height: 768px;
    display: flex;
    justify-content: center;
    align-items: center;
}

.dialog-box {
    background: #1a1a2e;
    color: #e0e0e0;
    border: 2px solid #555;
    border-radius: 8px;
    font-family: 'BIZ UDゴシック', Consolas, monospace;
    box-shadow: 0 0 32px rgba(0, 0, 0, 0.8);
}

.dialog-box--error {
    background: #1a0a0a;
    border-color: #f55;
    box-shadow: 0 0 32px rgba(0, 0, 0, 0.9);
}

.button-row {
    display: flex;
    justify-content: center;
    gap: 16px;
}

.button-row--end {
    display: flex;
    justify-content: flex-end;
    gap: 16px;
}
</style>
