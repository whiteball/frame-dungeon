import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap } from '../../lib/MapGenerator';
import { MapObject, MapMark, newMapEvent } from '../../lib/MapObject';
import type { ObjectEvent } from '../../lib/MapObject';
import { MainView } from '../../lib/MainView';
import { MiniMapView } from '../../lib/MiniMapView';
import { InfoView } from '../../lib/InfoView';
import { EquipmentView } from '../../lib/EquipmentView';
import { Player } from '../../lib/Player';
import type { Item } from '../../lib/Item';
import { ItemsLoader } from '../../lib/ItemsLoader';
import type { ItemDefinition } from '../../lib/ItemsLoader';

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

    private listMode: 'item' | 'equip' | 'drop' | null = null;
    private pendingPickup: { mapObject: MapObject, itemDef: ItemDefinition } | null = null;

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
            let displayValue: number | string;
            const bonusStr = data.bonus > 0 ? `(+${data.bonus})` : `(${data.bonus})`;
            if (data.hasFluctuation && data.maxValue !== null) {
                const maxPart = data.bonus !== 0 ? `${data.maxValue}${bonusStr}` : `${data.maxValue}`;
                displayValue = `${data.currentValue}/${maxPart}`;
            } else if (data.bonus !== 0) {
                displayValue = `${data.currentValue}${bonusStr}`;
            } else {
                displayValue = data.currentValue;
            }
            displayParams.set(data.abbreviation, displayValue);
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
        EventBus.removeAllListeners('open-drop-list-for-pickup');
        EventBus.removeAllListeners('drop-item');

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
                    EventBus.emit('message-log', `${this.floor}階に移動した`, dungeon.getTurnCount());
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

            // アイテムの配置
            const itemDefs = ItemsLoader.getInstance().getItems();
            if (itemDefs.length > 0) {
                const roomCount = dungeon.getRoomCount();
                const itemCount = Math.max(0, Phaser.Math.Between(roomCount - 3, roomCount + 3));
                const itemExcludeList: integer[][] = [];
                if (step.length >= 2) {
                    itemExcludeList.push(step);
                }
                itemExcludeList.push(...traps);
                const itemPositions = dungeon.getRandomPosList(itemCount, false, {
                    withoutCorridor: true,
                    withoutPlayer: true,
                    excludePositionList: itemExcludeList,
                });
                for (const pos of itemPositions) {
                    const itemDef = itemDefs[Phaser.Math.Between(0, itemDefs.length - 1)];
                    this.addItemMapObject(pos[0], pos[1], itemDef);
                }
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

        this.keys.keyW?.on('down', () => this.executeAction(() => this.dungeon.goPlayer() > 0))
        this.keys.keySpace?.on('down', () => this.executeAction(() => this.dungeon.attackPlayer()))
        this.keys.keyA?.on('down', () => this.executeAction(() => this.dungeon.turnLeftPlayer()))
        this.keys.keyS?.on('down', () => this.executeAction(() => this.dungeon.turnBackPlayer()))
        this.keys.keyD?.on('down', () => this.executeAction(() => this.dungeon.turnRightPlayer()))
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

        EventBus.on('open-drop-list-for-pickup', (payload: { mapObject: MapObject, itemDef: ItemDefinition }) => {
            this.pendingPickup = payload;
            this.openDropList();
        });

        EventBus.on('drop-item', (payload: { instanceId: string }) => {
            const inventory = this.player.getInventory();
            const droppedItem = inventory.getItemById(payload.instanceId);
            if (!droppedItem) return;
            const droppedDef = droppedItem.getDefinition();
            const pos = this.dungeon.getPlayerPos();
            inventory.removeItemById(payload.instanceId);
            const pending = this.pendingPickup;
            if (pending) {
                const pickedItem = Player.createItem(pending.itemDef.name);
                if (pickedItem) {
                    inventory.addItem(pickedItem);
                    EventBus.emit('message-log', `${pending.itemDef.label}を入手した`, this.dungeon.getTurnCount());
                }
                this.dungeon.removeMapObject(pending.mapObject);
            }
            this.addItemMapObject(pos.x, pos.y, droppedDef);
            EventBus.emit('message-log', `${droppedDef.label}を置いた`, this.dungeon.getTurnCount());
            this.closeList();
            // 置く/入れ換えはターン非消費（dispatchObjectEvent を呼ばない）。
            // 呼んでしまうと置いた直後の around-0 で自動拾得が走り、置いたアイテムを即回収してしまう
            this.render();
        });

        EventBus.emit('go-to-next-floor', this.dungeon);
        EventBus.emit('current-scene-ready', this);

        const sceneActions = [
            { label: 'アイテム使用', onClick: () => this.toggleList('item') },
            { label: '装備変更', onClick: () => this.toggleList('equip') },
            { label: 'ステータス', onClick: () => EventBus.emit('message-log', 'ステータス確認機能は未実装です', this.dungeon.getTurnCount()) },
            { label: '足下', onClick: () => this.onUnderfoot() },
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

    private addItemMapObject(x: integer, y: integer, itemDef: ItemDefinition): void {
        const label = itemDef.label;
        const onPickup: ObjectEvent = () => {
            const newItem = Player.createItem(itemDef.name);
            if (newItem && this.player.getInventory().addItem(newItem)) {
                EventBus.emit('message-log', `${label}を入手した`, this.dungeon.getTurnCount());
                return false;
            }
            EventBus.emit('message-log', `${label}の上に乗った`, this.dungeon.getTurnCount());
            return true;
        };
        const onSelf: ObjectEvent = (_dungeon, object) => {
            const newItem = Player.createItem(itemDef.name);
            if (newItem && this.player.getInventory().addItem(newItem)) {
                EventBus.emit('message-log', `${label}を入手した`, this.dungeon.getTurnCount());
                return false;
            }
            EventBus.emit('open-drop-list-for-pickup', { mapObject: object, itemDef });
            return true;
        };
        const events = newMapEvent('around-0', onPickup);
        newMapEvent('around-0-self', onSelf, events);
        this.dungeon.addObject(x, y, MapMark.CROSS, events, 0x00FFFF);
    }

    private buildItemListPayload(items: Item[]): Array<{ id: string; label: string; description: string; isEquipped: boolean; type: string; effectJson: string }> {
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
            type: it.getType(),
            effectJson: JSON.stringify(it.getDefinition().effect),
        }));
    }

    private toggleList(mode: 'item' | 'equip'): void {
        if (this.listMode === mode) {
            this.closeList();
        } else {
            this.openList(mode);
        }
    }

    private onUnderfoot(): void {
        if (this.listMode === 'drop') {
            this.closeList();
            return;
        }
        if (this.listMode !== null) {
            this.closeList();
        }
        const dispatched = this.dungeon.dispatchSelfEvent();
        if (!dispatched) {
            // 足下に対応オブジェクトなし → 設置フロー（ターン非消費）
            this.openDropList();
            return;
        }
        // 足下アクションによる拾得・入替え・設置はすべてターン非消費
        this.render();
    }

    private openList(mode: 'item' | 'equip' | 'drop'): void {
        if (this.listMode !== null) this.closeList();
        let items: Item[];
        let actionLabel: string;
        if (mode === 'item') {
            items = this.player.getInventory().getConsumableItems();
            actionLabel = '使用';
        } else if (mode === 'equip') {
            items = this.player.getInventory().getEquippableItems();
            actionLabel = '装備';
        } else {
            const equippedIds = new Set(
                this.player.getAllEquippedItems()
                    .filter((it): it is Item => it !== null)
                    .map(it => it.getInstanceId())
            );
            items = this.player.getInventory().getItems()
                .filter(it => !equippedIds.has(it.getInstanceId()));
            actionLabel = '置く';
        }
        this.listMode = mode;
        if (this.input.keyboard) this.input.keyboard.enabled = false;
        EventBus.emit('open-item-list', {
            items: this.buildItemListPayload(items),
            mode,
            actionLabel,
        });
    }

    private openDropList(): void {
        this.openList('drop');
    }

    private closeList(): void {
        if (this.listMode === null) return;
        this.listMode = null;
        this.pendingPickup = null;
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

    private async executeAction(action: () => boolean): Promise<void> {
        const flashQueue: number[] = [];
        const flashListener = (color: number) => flashQueue.push(color);
        EventBus.on('attack-flash', flashListener);
        const result = action();
        EventBus.off('attack-flash', flashListener);

        if (result) {
            for (const color of flashQueue) {
                this.mainView.flash(color);
                this.render();
                await new Promise(resolve => setTimeout(resolve, 120));
            }
            this.render();
        }
    }

    changeScene() {
        this.scene.start('GameOver');
    }
}
