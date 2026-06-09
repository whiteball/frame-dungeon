import { EventBus } from '../../EventBus';
import { BaseLoader } from '../../../lib/BaseLoader';
import { SaveManager } from '../../../lib/SaveManager';
import type { SaveData } from '../../../lib/SaveManager';
import type { Game } from '../Game';

/**
 * セーブ / ロード周りの UI 制御と EventBus ハンドラを集約する。
 *
 * - {@link openSaveDialog} はメニュー「セーブ」から呼ばれ、空のシーンアクション
 *   列に切り替えてキー入力をブロックした上で 'open-save-dialog' を発火する。
 * - {@link register} で 'save-to-slot' / 'export-save' / 'close-save-dialog'
 *   の 3 種の EventBus ハンドラを登録する（旧リスナの一掃も同時実施）。
 * - セーブデータ復元（pendingSaveData の適用）は Game.create() のシーン
 *   ライフサイクル内で行われるため、本コントローラには含めない。
 */
export class SaveLoadController {
    constructor(private game: Game) {}

    /**
     * EventBus に各種ハンドラを登録する。
     * シーン再開でリスナが残らないよう、登録前に同名イベントの旧リスナを一掃する。
     */
    register(): void {
        EventBus.removeAllListeners('save-to-slot');
        EventBus.removeAllListeners('export-save');
        EventBus.removeAllListeners('close-save-dialog');

        EventBus.on('save-to-slot', async ({ slot, memo }: { slot: number; memo: string }) => {
            try {
                const saveData = await this.buildSaveData(memo);
                SaveManager.saveToSlot(slot, saveData);
                EventBus.emit('close-save-dialog');
                EventBus.emit('message-log', `スロット${slot}にセーブしました`, this.game.dungeon.getTurnCount());
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                EventBus.emit('message-log', `セーブに失敗しました: ${msg}`, this.game.dungeon.getTurnCount());
                EventBus.emit('close-save-dialog');
            }
            this.game.mode.enterDefaultMode();
        });

        EventBus.on('export-save', async ({ memo }: { memo: string }) => {
            try {
                const saveData = await this.buildSaveData(memo);
                SaveManager.downloadSaveFile(saveData);
                EventBus.emit('message-log', 'セーブデータをエクスポートしました', this.game.dungeon.getTurnCount());
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                EventBus.emit('message-log', `エクスポートに失敗しました: ${msg}`, this.game.dungeon.getTurnCount());
            }
        });

        EventBus.on('close-save-dialog', () => {
            if (this.game.input.keyboard) {
                this.game.input.keyboard.resetKeys();
                this.game.input.keyboard.enabled = true;
            }
            this.game.mode.enterDefaultMode();
        });
    }

    /**
     * セーブダイアログを開く。
     * シーンアクションを空に差し替えて isModalMode=true とし、キー入力もブロックする。
     */
    openSaveDialog(): void {
        this.game.mode.setSceneActions([]);
        if (this.game.input.keyboard) this.game.input.keyboard.enabled = false;
        EventBus.emit('open-save-dialog', {
            floor: this.game.floor,
            gameName: BaseLoader.getInstance().getName(),
        });
    }

    private async buildSaveData(memo: string): Promise<SaveData> {
        const yamlDigest = await SaveManager.calculateDigest();
        const base = BaseLoader.getInstance();
        return {
            meta: {
                savedAt: new Date().toISOString(),
                memo,
                gameName: base.getName(),
                yamlDigest,
            },
            floor: this.game.floor,
            floorLabel: base.formatFloorLabel(this.game.floor),
            player: this.game.player.serialize(),
            dungeon: this.game.dungeon.serialize(),
        };
    }
}
