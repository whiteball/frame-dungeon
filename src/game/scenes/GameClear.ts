import { EventBus } from '../EventBus';
import { Scene } from 'phaser';

export class GameClear extends Scene
{
    camera: Phaser.Cameras.Scene2D.Camera;
    background: Phaser.GameObjects.Image;
    gameClearText: Phaser.GameObjects.Text;

    constructor ()
    {
        super('GameClear');
    }

    create ()
    {
        this.camera = this.cameras.main;
        this.camera.setViewport(10, 10, 1004, 520);
        this.camera.setBackgroundColor(0x006600);

        this.background = this.add.image(502, 260, 'background');
        this.background.setAlpha(0.5);

        this.gameClearText = this.add.text(502, 260, 'Game Clear!', {
            fontFamily: 'Arial Black', fontSize: 64, color: '#ffff00',
            stroke: '#000000', strokeThickness: 8,
            align: 'center'
        }).setOrigin(0.5).setDepth(100);

        EventBus.emit('current-scene-ready', this);

        const data = this.scene.settings.data as { resultText?: string };
        const resultText = data?.resultText ?? '';

        EventBus.emit('scene-actions', [
            { label: 'リザルト', onClick: () => EventBus.emit('open-result', resultText) },
            { label: 'タイトルへ', onClick: () => this.scene.start('MainMenu') },
        ]);
    }
}
