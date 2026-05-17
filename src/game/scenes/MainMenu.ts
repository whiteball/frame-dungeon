import { GameObjects, Scene } from 'phaser';

import { EventBus } from '../EventBus';
import { BaseLoader } from '../../lib/BaseLoader';
import { CustomDataStore } from '../../lib/CustomDataStore';
import type { SaveData } from '../../lib/SaveManager';

export class MainMenu extends Scene
{
    background: GameObjects.Image;
    title: GameObjects.Text;
    private viewRange = 3;
    private enableFog = true;
    private showAllEnemies = false;
    private swapQEandAD = false;
    private swapSandShiftS = false;

    private loadSettings () {
        try {
            const saved = localStorage.getItem('gameSettings');
            if (saved) {
                const parsed = JSON.parse(saved);
                if (typeof parsed.viewRange === 'number') this.viewRange = parsed.viewRange;
                if (typeof parsed.enableFog === 'boolean') this.enableFog = parsed.enableFog;
                if (typeof parsed.showAllEnemies === 'boolean') this.showAllEnemies = parsed.showAllEnemies;
                if (typeof parsed.swapQEandAD === 'boolean') this.swapQEandAD = parsed.swapQEandAD;
                if (typeof parsed.swapSandShiftS === 'boolean') this.swapSandShiftS = parsed.swapSandShiftS;
            }
        } catch { /* 読み込み失敗時はデフォルト値を使用 */ }
    }

    private saveSettings () {
        localStorage.setItem('gameSettings', JSON.stringify({
            viewRange: this.viewRange,
            enableFog: this.enableFog,
            showAllEnemies: this.showAllEnemies,
            swapQEandAD: this.swapQEandAD,
            swapSandShiftS: this.swapSandShiftS,
        }));
    }

    constructor ()
    {
        super('MainMenu');
    }

    async create ()
    {
        this.loadSettings();
        await BaseLoader.getInstance().load(CustomDataStore.get('base'));
        const gameName = BaseLoader.getInstance().getName();

        this.cameras.main.setViewport(10, 10, 1004, 520);

        this.background = this.add.image(502, 260, 'background');

        this.title = this.add.text(502, 200, gameName, {
            fontFamily: 'Arial Black', fontSize: 54, color: '#ffffff',
            stroke: '#000000', strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);

        EventBus.emit('current-scene-ready', this);

        EventBus.emit('reset-message-log');

        EventBus.emit('scene-actions', [
            { label: 'ゲーム開始', onClick: () => this.changeScene() },
            { label: 'ロード', onClick: () => EventBus.emit('open-load-dialog') },
            { label: '設定', onClick: () => EventBus.emit('open-settings', { viewRange: this.viewRange, enableFog: this.enableFog, showAllEnemies: this.showAllEnemies, swapQEandAD: this.swapQEandAD, swapSandShiftS: this.swapSandShiftS }) },
        ]);

        EventBus.on('settings-confirmed', (data: { viewRange: number; enableFog: boolean; showAllEnemies: boolean; swapQEandAD: boolean; swapSandShiftS: boolean }) => {
            this.viewRange = data.viewRange;
            this.enableFog = data.enableFog;
            this.showAllEnemies = data.showAllEnemies;
            this.swapQEandAD = data.swapQEandAD;
            this.swapSandShiftS = data.swapSandShiftS;
            this.saveSettings();
        });

        EventBus.on('load-game', (saveData: SaveData) => {
            this.startLoadedGame(saveData);
        });

        this.events.once('shutdown', () => {
            EventBus.emit('scene-actions', []);
            EventBus.removeListener('settings-confirmed');
            EventBus.removeListener('load-game');
        });
    }

    changeScene ()
    {
        EventBus.emit('game-scene-start');
        this.scene.start('Game', { viewRange: this.viewRange, enableFog: this.enableFog, showAllEnemies: this.showAllEnemies, swapQEandAD: this.swapQEandAD, swapSandShiftS: this.swapSandShiftS });
    }

    private startLoadedGame(saveData: SaveData): void {
        EventBus.emit('close-load-dialog');
        EventBus.emit('game-scene-start');
        this.scene.start('Game', {
            viewRange: this.viewRange,
            enableFog: this.enableFog,
            showAllEnemies: this.showAllEnemies,
            swapQEandAD: this.swapQEandAD,
            swapSandShiftS: this.swapSandShiftS,
            saveData,
        });
    }
}
