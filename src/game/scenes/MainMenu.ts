import { GameObjects, Scene } from 'phaser';

import { EventBus } from '../EventBus';

export class MainMenu extends Scene
{
    background: GameObjects.Image;
    title: GameObjects.Text;

    constructor ()
    {
        super('MainMenu');
    }

    create ()
    {
        this.cameras.main.setViewport(10, 10, 1004, 520);

        this.background = this.add.image(502, 260, 'background');

        this.title = this.add.text(502, 200, 'Main Menu', {
            fontFamily: 'Arial Black', fontSize: 54, color: '#ffffff',
            stroke: '#000000', strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);

        EventBus.emit('current-scene-ready', this);

        EventBus.emit('reset-message-log');

        EventBus.emit('scene-actions', [
            { label: 'ゲーム開始', onClick: () => this.changeScene() },
            { label: '設定', onClick: () => console.log('設定画面は未実装です') },
        ]);

        this.events.once('shutdown', () => {
            EventBus.emit('scene-actions', []);
        });
    }

    changeScene ()
    {
        EventBus.emit('game-scene-start');
        this.scene.start('Game');
    }
}
