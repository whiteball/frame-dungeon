import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap, MapObject, newMapEvent } from '../../lib/MapGenerator';
import { MainView } from '../../lib/MainView';
import { MiniMapView } from '../../lib/MiniMapView';
import { InfoView } from '../../lib/InfoView';

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
    infoView: InfoView;

    params: Map<string, number | string>;

    constructor() {
        super('Game');
    }

    render() {
        this.miniMapView.render(this.dungeon);
        this.mainView.render(this.dungeon);
        this.infoView.render(this.floor, this.params);
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

        EventBus.on('go-to-next-floor', (dungeon: DungeonMap) => {
            dungeon.build();
            // dungeon.dump();
            const step = dungeon.getRandomPos({ withoutCorridor: true, withoutDoor: true, withoutPlayer: true });
            if (step.length >= 2) {
                // 階段の追加
                dungeon.addObject(step[0], step[1], 'o', newMapEvent('around-0', (dungeon: DungeonMap) => {
                    this.floor++;
                    EventBus.emit('go-to-next-floor', dungeon)
                    return true;
                }), 0x00FF00)
            }
            const traps = dungeon.getRandomPosList(10, false, { withoutPlayer: true, excludePositionList: [step] });
            for (const trap of traps) {
                // トラップの追加
                dungeon.addObject(trap[0], trap[1], 'x', newMapEvent('around-0', (_, object: MapObject) => {
                    console.log('trap!!')
                    object.visible = true;
                    return true;
                }), 0xFF0000, 1, false, false);
            }
            EventBus.emit('update-view')
        })

        this.params = new Map([
            ['HP', 100],
            ['MP', 50],
            ['POW', 10],
            ['EXP', 0],
        ]);

        this.mainView = new MainView(this.add, 10, 10, 760, 520);
        this.miniMapView = new MiniMapView(this.add, this.game.canvas.width - 10 - 200, 10, 200, 200);
        this.infoView = new InfoView(this.add, this.game.canvas.width - 10 - 200, 220, 200, 400);

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
                this.render()
            }
        })
        this.keys.keyA?.on('down', () => {
            if (this.dungeon.turnLeftPlayer()) {
                this.render()
            }
        })
        this.keys.keyS?.on('down', () => {
            if (this.dungeon.turnBackPlayer()) {
                this.render()
            }
        })
        this.keys.keyD?.on('down', () => {
            if (this.dungeon.turnRightPlayer()) {
                this.render()
            }
        })
        // this.keys.keyE?.on('down', () => {
        //     if (this.dungeon.turnRightPlayer()) {
        //         this.render()
        //     }
        // })
        // this.keys.keyQ?.on('down', () => {
        //     if (this.dungeon.turnLeftPlayer()) {
        //         this.render()
        //     }
        // })

        this.dungeon = dun;

        EventBus.on('update-view', () => {
            this.render();
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
