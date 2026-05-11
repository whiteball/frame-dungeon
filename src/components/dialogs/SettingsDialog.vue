<script setup lang="ts">
import { ref, watch } from 'vue';
import ModalOverlay from './ModalOverlay.vue';

const props = defineProps<{
    visible: boolean
    initialViewRange: number
    initialEnableFog: boolean
    initialShowAllEnemies: boolean
}>();

const emit = defineEmits<{
    confirm: [payload: { viewRange: number; enableFog: boolean; showAllEnemies: boolean }]
    cancel: []
}>();

const localViewRange = ref(props.initialViewRange);
const localEnableFog = ref(props.initialEnableFog);
const localShowAllEnemies = ref(props.initialShowAllEnemies);

watch(() => props.visible, (v) => {
    if (v) {
        localViewRange.value = props.initialViewRange;
        localEnableFog.value = props.initialEnableFog;
        localShowAllEnemies.value = props.initialShowAllEnemies;
    }
});

function confirm() {
    emit('confirm', {
        viewRange: localViewRange.value,
        enableFog: localEnableFog.value,
        showAllEnemies: localShowAllEnemies.value,
    });
}
</script>

<template>
    <ModalOverlay :visible="visible" :bg-alpha="0.6" :z-index="100">
        <div style="padding: 32px 40px; min-width: 320px; color: #fff;">
            <h2 style="margin: 0 0 24px 0; text-align: center; font-size: 22px;">設定</h2>
            <table style="width: 100%; border-collapse: collapse; margin-bottom: 28px;">
                <tr>
                    <td style="padding: 8px 16px 8px 0; white-space: nowrap;">プレイヤーの視界</td>
                    <td style="padding: 8px 0;">
                        <input
                            type="number"
                            v-model.number="localViewRange"
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
                            v-model="localEnableFog"
                            style="width: 18px; height: 18px; cursor: pointer;"
                        />
                    </td>
                </tr>
                <tr>
                    <td style="padding: 8px 16px 8px 0; white-space: nowrap;">常に敵を表示</td>
                    <td style="padding: 8px 0;">
                        <input
                            type="checkbox"
                            v-model="localShowAllEnemies"
                            style="width: 18px; height: 18px; cursor: pointer;"
                        />
                    </td>
                </tr>
            </table>
            <div style="display: flex; justify-content: center; gap: 16px;">
                <button class="button" @click="confirm">OK</button>
                <button class="button" @click="emit('cancel')">キャンセル</button>
            </div>
        </div>
    </ModalOverlay>
</template>
