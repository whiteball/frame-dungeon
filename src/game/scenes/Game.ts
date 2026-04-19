import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap } from '../../lib/MapGenerator';
import { MapObject, MapMark, newMapEvent } from '../../lib/MapObject';
import { MainView } from '../../lib/MainView';
import { MiniMapView } from '../../lib/MiniMapView';
import { InfoView } from '../../lib/InfoView';
import { Player } from '../../lib/Player';

export class Game extends Scene {
    keys: {
        keyW: Phaser.Input.Keyboard.Key | undefined,
        keyS: Phaser.Input.Keyboard.Key | undefined,
        keyA: Phaser.Input.Keyboard.Key | undefined,
        keyD: Phaser.Input.Keyboard.Key | undefined,
        keyE: Phaser.Input.Keyboard.Key | undefined,
        keyQ: Phaser.Input.Keyboard.Key | undefined,
        keySpace: Phaser.Input.Keyboard.Key | undefined,
    };
    dungeon: DungeonMap;
    floor: integer = 1;

    mainView: MainView;
    miniMapView: MiniMapView;
    infoView: InfoView;

    params: Map<string, number | string>;
    player: Player;

    constructor() {
        super('Game');
    }

    render() {
        this.miniMapView.render(this.dungeon);
        this.mainView.render(this.dungeon);
        this.params = this.getDisplayParams();
        this.infoView.render(this.floor, this.params);
    }

    private getDisplayParams(): Map<string, number | string> {
        const displayParams = new Map<string, number | string>();
        const displayStats = this.player.getDisplayStats();
        
        for (const data of displayStats.values()) {
            displayParams.set(data.abbreviation, data.value);
        }
        
        return displayParams;
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

    async create() {
        const dun = new DungeonMap(15, 15);

        EventBus.on('go-to-next-floor', (dungeon: DungeonMap) => {
            dungeon.build();
            // dungeon.dump();

            // 敵をクリア
            dungeon.clearEnemies();

            const step = dungeon.getRandomPos({ withoutCorridor: true, withoutDoor: true, withoutPlayer: true });
            if (step.length >= 2) {
                // 階段の追加
                dungeon.addObject(step[0], step[1], MapMark.CIRCLE, newMapEvent('around-0', (dungeon: DungeonMap) => {
                    this.floor++;
                    EventBus.emit('go-to-next-floor', dungeon)
                    return true;
                }), 0x00FF00)
            }

            const traps = dungeon.getRandomPosList(10, false, { withoutPlayer: true, excludePositionList: [step] });
            for (const trap of traps) {
                // トラップの追加
                dungeon.addObject(trap[0], trap[1], MapMark.X_CROSS, newMapEvent('around-0', (_, object: MapObject) => {
                    console.log('trap!!' + object.x + ',' + object.y)
                    object.visible = true;
                    return true;
                }), 0xFF0000, 1, false, false);
            }

            // 敵の配置
            this.spawnEnemies(dungeon);

            EventBus.emit('update-view')
        })

        // Player初期化前にシステムを初期化
        await Player.initializeAllSystems();
        this.player = new Player();
        this.params = this.getDisplayParams();

        // テスト用: アイテムをプレイヤーに追加
        this.testItemSystem();

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
            keySpace: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        };

        this.keys.keyW?.on('down', () => {
            if (this.dungeon.goPlayer() > 0) {
                this.render()
            }
        })
        this.keys.keySpace?.on('down', () => {
            if (this.dungeon.attackPlayer()) {
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
        this.dungeon.setPlayerInstance(this.player);

        EventBus.on('update-view', () => {
            this.render();
        })

        EventBus.on('game-over', () => {
            this.scene.start('GameOver');
        })

        EventBus.emit('go-to-next-floor', this.dungeon);
        EventBus.emit('current-scene-ready', this);

        EventBus.emit('scene-actions', [
            { label: 'アイテム使用', onClick: () => EventBus.emit('message-log', 'アイテム使用機能は未実装です') },
            { label: 'ステータス', onClick: () => EventBus.emit('message-log', 'ステータス確認機能は未実装です') },
        ]);
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

    private testItemSystem(): void {
        console.log('=== Item System Test ===');
        
        // アイテム作成テスト
        const sword = Player.createItem('iron sword');
        const shield = Player.createItem('round shield');
        const ring = Player.createItem('silver ring');
        const potion = Player.createItem('potion');
        
        if (sword && shield && ring && potion) {
            console.log('✓ アイテム作成成功');
            console.log('- 鉄の剣:', sword.toString());
            console.log('- 丸い盾:', shield.toString());
            console.log('- 銀の指輪:', ring.toString());
            console.log('- 薬:', potion.toString());
            
            // インベントリ追加テスト
            const inventory = this.player.getInventory();
            inventory.addItem(sword);
            inventory.addItem(shield);
            inventory.addItem(ring);
            inventory.addItem(potion);
            
            console.log('✓ インベントリ追加成功');
            console.log(`インベントリ使用量: ${inventory.getUsedCapacity()}/${inventory.getCapacity()}`);
            
            // 装備テスト
            const oldWeapon = this.player.equipItem(sword);
            const oldArmor = this.player.equipItem(shield);
            const oldRing = this.player.equipItem(ring);
            
            console.log('✓ 装備成功');
            console.log('- 武器:', this.player.getEquippedWeapon()?.getLabel());
            console.log('- メイン防具:', this.player.getEquippedMainArmor()?.getLabel());
            console.log('- サブ防具1:', this.player.getEquippedSubArmor1()?.getLabel());
            
            // 装備ボーナス確認
            const bonuses = this.player.getEquipmentBonuses();
            console.log('✓ 装備ボーナス:');
            for (const [stat, bonus] of bonuses) {
                console.log(`- ${stat}: +${bonus}`);
            }
            
        } else {
            console.error('✗ アイテム作成失敗');
        }
        
        console.log('=== Test Complete ===');
    }

    private spawnEnemies(dungeon: DungeonMap): void {
        // フロアに応じた敵の数を決定
        const enemyCount = Math.min(3 + this.floor, 10);

        // 敵を配置する位置のリストを取得
        const enemyPositions = dungeon.getRandomPosList(
            enemyCount,
            false,
            { withoutCorridor: false, withoutPlayer: true }
        );

        // 各位置に敵を配置
        for (const pos of enemyPositions) {
            const enemy = Player.createRandomEnemy(this.floor, pos[0], pos[1]);
            if (enemy) {
                dungeon.addEnemy(enemy);
            }
        }

        console.log(`Spawned ${enemyPositions.length} enemies on floor ${this.floor}`);
    }

    changeScene() {
        this.scene.start('GameOver');
    }
}
