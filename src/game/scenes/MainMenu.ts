import { GameObjects, Scene } from 'phaser';

import { EventBus } from '../EventBus';
import { BaseLoader } from '../../lib/BaseLoader';

export class MainMenu extends Scene
{
    background: GameObjects.Image;
    title: GameObjects.Text;
    private viewRange = 3;
    private enableFog = true;
    private showAllEnemies = false;

    constructor ()
    {
        super('MainMenu');
    }

    async create ()
    {
        await BaseLoader.getInstance().load();
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
            { label: '設定', onClick: () => EventBus.emit('open-settings', { viewRange: this.viewRange, enableFog: this.enableFog, showAllEnemies: this.showAllEnemies }) },
        ]);

        EventBus.on('settings-confirmed', (data: { viewRange: number; enableFog: boolean; showAllEnemies: boolean }) => {
            this.viewRange = data.viewRange;
            this.enableFog = data.enableFog;
            this.showAllEnemies = data.showAllEnemies;
        });

        this.events.once('shutdown', () => {
            EventBus.emit('scene-actions', []);
            EventBus.removeListener('settings-confirmed');
        });
    }

    changeScene ()
    {
        EventBus.emit('game-scene-start');
        this.scene.start('Game', { viewRange: this.viewRange, enableFog: this.enableFog, showAllEnemies: this.showAllEnemies });
    }
}
