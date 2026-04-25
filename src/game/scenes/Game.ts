import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap } from '../../lib/MapGenerator';
import { MapObject, MapMark, newMapEvent } from '../../lib/MapObject';
import { MainView } from '../../lib/MainView';
import { MiniMapView } from '../../lib/MiniMapView';
import { InfoView } from '../../lib/InfoView';
import { EquipmentView } from '../../lib/EquipmentView';
import { Player } from '../../lib/Player';
import type { Item } from '../../lib/Item';

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
    equipmentView: EquipmentView;

    params: Map<string, number | string>;
    player: Player;

    private listMode: 'item' | 'equip' | null = null;

    constructor() {
        super('Game');
    }

    render() {
        this.miniMapView.render(this.dungeon);
        this.mainView.render(this.dungeon);
        this.params = this.getDisplayParams();
        this.infoView.render(this.floor, this.params);
        this.equipmentView.render({
            weapon: this.player.getEquippedWeapon(),
            mainArmor: this.player.getEquippedMainArmor(),
            subArmor1: this.player.getEquippedSubArmor1(),
            subArmor2: this.player.getEquippedSubArmor2(),
        });
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
        // シーン再開（リスタート）に備えて、このシーンが扱うイベントの旧リスナを一掃する
        // 古いシーンインスタンスのハンドラが残ると、scene.manager が null の dead scene で
        // scene.start が呼ばれて queueOp が失敗する
        EventBus.removeAllListeners('go-to-next-floor');
        EventBus.removeAllListeners('update-view');
        EventBus.removeAllListeners('game-over');
        EventBus.removeAllListeners('use-item');
        EventBus.removeAllListeners('equip-item');
        EventBus.removeAllListeners('close-item-list-request');

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
        this.infoView = new InfoView(this.add, this.game.canvas.width - 10 - 200, 220, 200, 180);
        this.equipmentView = new EquipmentView(this.add, this.game.canvas.width - 10 - 200, 405, 200, 130);

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
            this.closeList();
            this.scene.start('GameOver');
        })

        EventBus.on('use-item', (payload: { instanceId: string }) => {
            if (this.dungeon.useConsumableItem(payload.instanceId)) {
                const rest = this.player.getInventory().getConsumableItems();
                if (rest.length === 0) {
                    this.closeList();
                } else {
                    EventBus.emit('open-item-list', {
                        items: this.buildItemListPayload(rest),
                        mode: 'item',
                        actionLabel: '使用',
                    });
                }
                this.render();
            }
        });

        EventBus.on('equip-item', (payload: { instanceId: string }) => {
            const result = this.dungeon.changeEquipment(payload.instanceId);
            if (result.success) {
                const rest = this.player.getInventory().getEquippableItems();
                if (rest.length === 0) {
                    this.closeList();
                } else {
                    EventBus.emit('open-item-list', {
                        items: this.buildItemListPayload(rest),
                        mode: 'equip',
                        actionLabel: '装備',
                    });
                }
                this.render();
            }
        });

        EventBus.on('close-item-list-request', () => {
            this.closeList();
        });

        EventBus.emit('go-to-next-floor', this.dungeon);
        EventBus.emit('current-scene-ready', this);

        const sceneActions = [
            { label: 'アイテム使用', onClick: () => this.toggleList('item') },
            { label: '装備変更', onClick: () => this.toggleList('equip') },
            { label: 'ステータス', onClick: () => EventBus.emit('message-log', 'ステータス確認機能は未実装です') },
        ];
        EventBus.emit('scene-actions', sceneActions);

        // 数字キー 1〜0 をアクションボタンの左から順に割り当てる
        // アイテム一覧表示中は keyboard.enabled = false により自動的に無効化される
        const numberKeyCodes = [
            Phaser.Input.Keyboard.KeyCodes.ONE,
            Phaser.Input.Keyboard.KeyCodes.TWO,
            Phaser.Input.Keyboard.KeyCodes.THREE,
            Phaser.Input.Keyboard.KeyCodes.FOUR,
            Phaser.Input.Keyboard.KeyCodes.FIVE,
            Phaser.Input.Keyboard.KeyCodes.SIX,
            Phaser.Input.Keyboard.KeyCodes.SEVEN,
            Phaser.Input.Keyboard.KeyCodes.EIGHT,
            Phaser.Input.Keyboard.KeyCodes.NINE,
            Phaser.Input.Keyboard.KeyCodes.ZERO,
        ];
        numberKeyCodes.forEach((code, i) => {
            this.input.keyboard?.addKey(code)?.on('down', () => {
                const a = sceneActions[i];
                if (a) a.onClick();
            });
        });
    }

    private buildItemListPayload(items: Item[]): Array<{ id: string; label: string; description: string; isEquipped: boolean }> {
        const equippedIds = new Set(
            this.player.getAllEquippedItems()
                .filter((it): it is Item => it !== null)
                .map(it => it.getInstanceId())
        );
        return items.map(it => ({
            id: it.getInstanceId(),
            label: it.getLabel(),
            description: it.getDescription(),
            isEquipped: equippedIds.has(it.getInstanceId()),
        }));
    }

    private toggleList(mode: 'item' | 'equip'): void {
        if (this.listMode === mode) {
            this.closeList();
        } else {
            this.openList(mode);
        }
    }

    private openList(mode: 'item' | 'equip'): void {
        if (this.listMode !== null) this.closeList();
        const items = mode === 'item'
            ? this.player.getInventory().getConsumableItems()
            : this.player.getInventory().getEquippableItems();
        this.listMode = mode;
        if (this.input.keyboard) this.input.keyboard.enabled = false;
        EventBus.emit('open-item-list', {
            items: this.buildItemListPayload(items),
            mode,
            actionLabel: mode === 'item' ? '使用' : '装備',
        });
    }

    private closeList(): void {
        if (this.listMode === null) return;
        this.listMode = null;
        if (this.input.keyboard) {
            // enabled=false の間に取りこぼした keyup で Key.isDown が true 固定になるのを解消
            // （次回同じキー押下時に down が発火しない問題の対策）
            this.input.keyboard.resetKeys();
            this.input.keyboard.enabled = true;
        }
        EventBus.emit('close-item-list');
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
        const powerPotion = Player.createItem('power potion');
        
        if (sword && shield && ring && potion && powerPotion) {
            console.log('✓ アイテム作成成功');
            console.log('- 鉄の剣:', sword.toString());
            console.log('- 丸い盾:', shield.toString());
            console.log('- 銀の指輪:', ring.toString());
            console.log('- 薬:', potion.toString());
            console.log('- 力の薬:', powerPotion.toString());
            
            // インベントリ追加テスト
            const inventory = this.player.getInventory();
            inventory.addItem(sword);
            inventory.addItem(shield);
            inventory.addItem(ring);
            inventory.addItem(potion);
            inventory.addItem(powerPotion);
            
            console.log('✓ インベントリ追加成功');
            console.log(`インベントリ使用量: ${inventory.getUsedCapacity()}/${inventory.getCapacity()}`);
            
            // 装備テスト
            // const oldWeapon = this.player.equipItem(sword);
            // const oldArmor = this.player.equipItem(shield);
            // const oldRing = this.player.equipItem(ring);
            
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
