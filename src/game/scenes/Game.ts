import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap, MapObject } from '../../lib/MapGenerator';
import { MainView } from '../../lib/MainView';
import { MiniMapView } from '../../lib/MiniMapView';

export class Game extends Scene {
    keys: {
        keyW: Phaser.Input.Keyboard.Key | undefined,
        keyS: Phaser.Input.Keyboard.Key | undefined,
        keyA: Phaser.Input.Keyboard.Key | undefined,
        keyD: Phaser.Input.Keyboard.Key | undefined,
        keyE: Phaser.Input.Keyboard.Key | undefined,
        keyQ: Phaser.Input.Keyboard.Key | undefined,
    };
    dungeon: DungeonMap;
    floor: integer = 1;

    mainView: MainView;
    miniMapView: MiniMapView;

    constructor() {
        super('Game');
    }

    redrawAll() {
        this.miniMapView.render(this.dungeon);
        this.mainView.render(this.dungeon);
        this.redrawInfo();
    }

    static fontFamily = '\'BIZ UDゴシック\', Consolas, monospace';
    playerInfo: Map<string, number>;
    floorText: Phaser.GameObjects.Text;
    playerTextLabel: Phaser.GameObjects.Text;
    playerTextValue: Phaser.GameObjects.Text;
    redrawInfo() {
        this.floorText.setText(this.floor + 'F');
        let buf = '', buf2 = '';
        this.playerInfo.forEach((value, key) => {
            buf += key + ' : ' + '\n';
            buf2 += value + '\n';
        })
        this.playerTextLabel.setText(buf);
        this.playerTextValue.setText(buf2);
    }

    create() {
        const dun = new DungeonMap(15, 15);
        this.floorText = this.add.text(this.game.canvas.width - 200, 220, this.floor + 'F').setFontFamily(Game.fontFamily)
        this.playerTextLabel = this.add.text(this.game.canvas.width - 200, 250, '').setFontFamily(Game.fontFamily).style.setAlign('left')
        this.playerTextValue = this.add.text(this.game.canvas.width - 100, 250, '').setFontFamily(Game.fontFamily).style.setAlign('right')
        this.playerInfo = new Map([
            ['HP', 100],
            ['MP', 50],
            ['POW', 10],
            ['あ', 10],
        ])

        EventBus.on('go-to-next-floor', (dungeon: DungeonMap) => {
            dungeon.build();
            // dungeon.dump();
            const step = dungeon.getRandomPos(true, true, true);
            if (step.length >= 2) {
                // 階段の追加
                dungeon.addObject(step[0], step[1], 'o', (dungeon: DungeonMap, object: MapObject) => {
                    const player = dungeon.getPlayerPos()
                    if (player.x === object.x && player.y === object.y) {
                        this.floor++;
                        EventBus.emit('go-to-next-floor', dungeon)
                    }
                }, 0x00FF00)
            }
            EventBus.emit('update-view')
        })

        this.mainView = new MainView(this.add, 10, 10, 760, 520);
        this.miniMapView = new MiniMapView(this.add, this.game.canvas.width - 10 - 200, 10, 200, 200);

        this.keys = {
            keyW: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            keyA: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            keyS: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            keyD: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            keyE: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            keyQ: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
        };

        this.keys.keyW?.on('down', () => {
            if (this.dungeon.goPlayer() > 0) {
                this.redrawAll()
            }
        })
        this.keys.keyA?.on('down', () => {
            if (this.dungeon.turnLeftPlayer()) {
                this.redrawAll()
            }
        })
        this.keys.keyS?.on('down', () => {
            if (this.dungeon.turnBackPlayer()) {
                this.redrawAll()
            }
        })
        this.keys.keyD?.on('down', () => {
            if (this.dungeon.turnRightPlayer()) {
                this.redrawAll()
            }
        })
        // this.keys.keyE?.on('down', () => {
        //     if (this.dungeon.turnRightPlayer()) {
        //         this.redrawAll()
        //     }
        // })
        // this.keys.keyQ?.on('down', () => {
        //     if (this.dungeon.turnLeftPlayer()) {
        //         this.redrawAll()
        //     }
        // })

        this.dungeon = dun;

        EventBus.on('update-view', () => {
            this.redrawAll();
        })

        EventBus.emit('go-to-next-floor', this.dungeon);
        EventBus.emit('current-scene-ready', this);
    }

    // update(time: number, delta: number): void {
    //     let distance = 0;
    //     if (this.keys.keyD?.isDown) {
    //         distance = this.dungeon.movePlayer(0);
    //     }
    //     if (this.keys.keyS?.isDown) {
    //         distance = this.dungeon.movePlayer(1);
    //     }
    //     if (this.keys.keyA?.isDown) {
    //         distance = this.dungeon.movePlayer(2);
    //     }
    //     if (this.keys.keyW?.isDown) {
    //         distance = this.dungeon.movePlayer(3);
    //     }

    //     if (distance > 0) {
    //         this.repaint()
    //     }
    // }

    changeScene() {
        this.scene.start('GameOver');
    }
}
