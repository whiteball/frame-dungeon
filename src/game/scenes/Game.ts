import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap } from '../../lib/MapGenerator';
import { MapObject } from '../../lib/MapObject';
import { MainView } from '../../lib/MainView';
import { MiniMapView } from '../../lib/MiniMapView';
import { InfoView } from '../../lib/InfoView';
import { EquipmentView } from '../../lib/EquipmentView';
import { Player } from '../../lib/Player';
import type { Enemy } from '../../lib/Enemy';
import type { Item } from '../../lib/Item';
import { ItemsLoader } from '../../lib/ItemsLoader';
import { TrapsLoader } from '../../lib/TrapsLoader';
import type { TrapDefinition } from '../../lib/TrapsLoader';
import { EffectsLoader } from '../../lib/EffectsLoader';
import { SkillsLoader } from '../../lib/SkillsLoader';
import { evaluateCost, canPayCost, formatCostSummary } from '../../lib/skills/SkillExecutor';
import { getFrontCandidates, formatTargetSummary } from '../../lib/skills/TargetResolver';
import { makeStatFluctuatedMessage } from '../../lib/util/text';
import { StatsLoader } from '../../lib/StatsLoader';
import { getDirectionOffset, rotateDirection } from '../../lib/map/MapDirection';
import { ItemObject } from '../../lib/map/MapObjects';
import { buildStairsObject, buildTrapObject } from './mapObjectFactory';
import { BaseLoader } from '../../lib/BaseLoader';
import type { ResolvedFloorConfig } from '../../lib/BaseLoader';
import { SaveManager } from '../../lib/SaveManager';
import { YamlCrossValidator } from '../../lib/YamlCrossValidator';
import type { SaveData } from '../../lib/SaveManager';
import type { DungeonRestoreCallbacks } from '../../lib/MapGenerator';

type SceneAction = { label: string, onClick: () => void, disabled?: boolean };

export class Game extends Scene {
    keys: {
        keyW: Phaser.Input.Keyboard.Key | undefined,
        keyS: Phaser.Input.Keyboard.Key | undefined,
        keyA: Phaser.Input.Keyboard.Key | undefined,
        keyD: Phaser.Input.Keyboard.Key | undefined,
        keyE: Phaser.Input.Keyboard.Key | undefined,
        keyQ: Phaser.Input.Keyboard.Key | undefined,
        keyM: Phaser.Input.Keyboard.Key | undefined,
        keyC: Phaser.Input.Keyboard.Key | undefined,
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

    private listMode: 'item' | 'equip' | 'drop' | 'skill' | null = null;
    private pendingPickup: { mapObject: MapObject, item: Item } | null = null;
    private defaultSceneActions: SceneAction[] = [];
    private currentSceneActions: SceneAction[] = [];
    private get isModalMode(): boolean {
        return this.currentSceneActions !== this.defaultSceneActions;
    }
    private viewRange = 3;
    private enableFog = true;
    private revealAll = false;
    private swapQEandAD = false;
    private swapSandShiftS = false;
    private pendingSaveData: SaveData | null = null;

    constructor() {
        super('Game');
    }

    init(data: { viewRange?: number; enableFog?: boolean; showAllEnemies?: boolean; swapQEandAD?: boolean; swapSandShiftS?: boolean; saveData?: SaveData }) {
        this.viewRange = data.viewRange ?? 3;
        this.enableFog = data.enableFog ?? true;
        this.revealAll = data.showAllEnemies ?? false;
        this.swapQEandAD = data.swapQEandAD ?? false;
        this.swapSandShiftS = data.swapSandShiftS ?? false;
        this.pendingSaveData = data.saveData ?? null;
    }

    render() {
        this.miniMapView.render(this.dungeon, this.revealAll);
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

        const statusEffects = this.player.getActiveStatusEffects();
        if (statusEffects.length > 0) {
            displayParams.set('状態', statusEffects.map(e => e.label).join('、'));
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
        EventBus.removeAllListeners('game-clear');
        EventBus.removeAllListeners('use-item');
        EventBus.removeAllListeners('use-skill');
        EventBus.removeAllListeners('equip-item');
        EventBus.removeAllListeners('close-item-list-request');
        EventBus.removeAllListeners('open-drop-list-for-pickup');
        EventBus.removeAllListeners('drop-item');
        EventBus.removeAllListeners('save-to-slot');
        EventBus.removeAllListeners('close-save-dialog');

        this.floor = 1;
        const dun = new DungeonMap(15, 15, this.viewRange, this.enableFog);

        EventBus.on('go-to-next-floor', (dungeon: DungeonMap) => {
            // フロア設定を取得してマップをリサイズ
            const floorConfig = BaseLoader.getInstance().getFloorConfig(this.floor);
            dungeon.setCurrentFloor(this.floor);
            dungeon.resize(floorConfig.width, floorConfig.height);
            dungeon.build();
            dungeon.resetFloorTurnCount();
            // dungeon.dump();

            // 敵をクリア
            dungeon.clearEnemies();

            const excludePositionList: integer[][] = [];
            const step = dungeon.getRandomPos({ withoutCorridor: true, withoutDoor: true, withoutPlayer: true });
            if (step.length >= 2) {
                // 階段の追加
                const stairsObj = buildStairsObject((d) => this.enterStairMode(d));
                stairsObj.x = step[0];
                stairsObj.y = step[1];
                dungeon.placeObject(stairsObj);
                excludePositionList.push(step);
            }

            // トラップ配置（base.yml の設定に従う）
            const trapCount = Phaser.Math.Between(floorConfig.trapMin, floorConfig.trapMax);
            const traps = dungeon.getRandomPosList(trapCount, false, { withoutPlayer: true, excludePositionList: [step] });
            for (const trapPos of traps) {
                if (floorConfig.trapPool.length === 0) break;
                const trapName = floorConfig.trapPool[Phaser.Math.Between(0, floorConfig.trapPool.length - 1)];
                const trapDef = TrapsLoader.getInstance().getTrap(trapName)!;
                const trapObj = buildTrapObject(
                    trapDef,
                    (def) => this.applyTrapEffects(def),
                    (def, obj) => this.enterTrapConfirmMode(def, obj),
                );
                trapObj.x = trapPos[0];
                trapObj.y = trapPos[1];
                this.dungeon.placeObject(trapObj);
                excludePositionList.push(trapPos);
            }

            // アイテムの配置
            const itemDefs = ItemsLoader.getInstance().getItems();
            if (itemDefs.length > 0) {
                const roomCount = dungeon.getRoomCount();
                const itemCount = Math.max(0, Phaser.Math.Between(roomCount - 3, roomCount + 3));
                const itemPositions = dungeon.getRandomPosList(itemCount, false, {
                    withoutCorridor: true,
                    withoutPlayer: true,
                    excludePositionList,
                });
                for (const pos of itemPositions) {
                    const itemDef = itemDefs[Phaser.Math.Between(0, itemDefs.length - 1)];
                    const item = Player.createItem(itemDef.name, { rollModifiers: true, floor: this.floor });
                    if (!item) continue;
                    const itemObj = new ItemObject(item);
                    itemObj.x = pos[0];
                    itemObj.y = pos[1];
                    this.dungeon.placeObject(itemObj);
                    excludePositionList.push(pos);
                }
            }

            // 敵の配置
            this.spawnEnemies(dungeon, floorConfig, excludePositionList);

            EventBus.emit('update-view')
        })

        // Player初期化前にシステムを初期化
        await Player.initializeAllSystems();

        const { errors, infos } = YamlCrossValidator.validate();
        for (const info of infos) console.info(`[YAML INFO] ${info}`);
        if (errors.length > 0) {
            EventBus.emit('yaml-cross-validation-errors', errors);
            this.scene.start('MainMenu');
            return;
        }

        this.player = new Player();
        this.params = this.getDisplayParams();

        this.mainView = new MainView(this.add, 10, 10, 760, 520);
        const miniMapX = this.game.canvas.width - 10 - 200;
        const miniMapY = 10;
        const miniMapSize = 200;
        const savedMinimapMode = localStorage.getItem('frame_dungeon_minimap_full') === 'true';
        this.miniMapView = new MiniMapView(this.add, miniMapX, miniMapY, miniMapSize, miniMapSize, savedMinimapMode);
        const miniMapZone = this.add.zone(miniMapX + miniMapSize / 2, miniMapY + miniMapSize / 2, miniMapSize, miniMapSize).setInteractive();
        miniMapZone.on('pointerdown', () => {
            if (this.isModalMode) return;
            this.toggleMiniMapMode();
        });
        this.infoView = new InfoView(this.add, this.game.canvas.width - 10 - 200, 220, 200, 180);
        this.equipmentView = new EquipmentView(this.add, this.game.canvas.width - 10 - 200, 405, 200, 130);

        this.keys = {
            keyW: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.W),
            keyA: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.A),
            keyS: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.S),
            keyD: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.D),
            keyE: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.E),
            keyQ: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.Q),
            keyM: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.M),
            keyC: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.C),
            keySpace: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE),
        };

        this.keys.keyW?.on('down', () => {
            if (this.isModalMode) return;
            if (this.handlePlayerActionDirective()) return;
            this.executeAction(() => this.dungeon.goPlayer() > 0);
        })
        this.keys.keySpace?.on('down', (event: KeyboardEvent) => {
            if (this.isModalMode) return;
            if (this.handlePlayerActionDirective()) return;
            this.tryAttackOrShowDirections(event.shiftKey);
        })
        this.keys.keyA?.on('down', () => {
            if (this.isModalMode) return;
            if (this.swapQEandAD) {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goLeftPlayer() > 0);
            } else {
                this.executeAction(() => this.dungeon.turnLeftPlayer());
            }
        })
        this.keys.keyS?.on('down', (event: KeyboardEvent) => {
            if (this.isModalMode) return;
            const doStrafeBack = this.swapSandShiftS ? !event.shiftKey : event.shiftKey;
            if (doStrafeBack) {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goBackPlayer() > 0);
            } else {
                this.executeAction(() => this.dungeon.turnBackPlayer());
            }
        })
        this.keys.keyD?.on('down', () => {
            if (this.isModalMode) return;
            if (this.swapQEandAD) {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goRightPlayer() > 0);
            } else {
                this.executeAction(() => this.dungeon.turnRightPlayer());
            }
        })
        this.keys.keyE?.on('down', () => {
            if (this.isModalMode) return;
            if (this.swapQEandAD) {
                this.executeAction(() => this.dungeon.turnRightPlayer());
            } else {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goRightPlayer() > 0);
            }
        })
        this.keys.keyQ?.on('down', () => {
            if (this.isModalMode) return;
            if (this.swapQEandAD) {
                this.executeAction(() => this.dungeon.turnLeftPlayer());
            } else {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goLeftPlayer() > 0);
            }
        })
        this.keys.keyM?.on('down', () => {
            if (this.isModalMode) return;
            this.toggleMiniMapMode();
        })

        this.keys.keyC?.on('down', () => {
            if (this.isModalMode) return;
            if (this.handlePlayerActionDirective()) return;
            this.trySearch();
        })

        this.dungeon = dun;
        this.dungeon.setPlayerInstance(this.player);

        EventBus.on('update-view', () => {
            this.render();
        })

        EventBus.on('game-over', () => {
            this.closeList();
            this.scene.start('GameOver');
        })

        EventBus.on('game-clear', () => {
            this.closeList();
            this.scene.start('GameClear');
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

        EventBus.on('use-skill', (payload: { skillName: string }) => {
            const def = SkillsLoader.getInstance().getSkill(payload.skillName);
            if (!def) return;

            if (def.target === 'front') {
                // リストを閉じて方向選択モードに移行
                this.closeList();
                this.enterSkillTargetSelectMode(payload.skillName);
                return;
            }

            // それ以外（self / around / room / map）は即発動
            if (this.dungeon.useSkill(payload.skillName)) {
                // スキル発動成功時は一覧を再描画して開いたままにする
                // （アイテム使用と同じ思想。スキルは消費しないため常に同じ一覧）
                const learned = this.player.getLearnedSkillNames();
                EventBus.emit('open-item-list', {
                    items: this.buildSkillListPayload(learned),
                    mode: 'skill',
                    actionLabel: '発動',
                });
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

        EventBus.on('open-drop-list-for-pickup', (payload: { mapObject: MapObject, item: Item }) => {
            this.pendingPickup = payload;
            this.openDropList();
        });

        EventBus.on('drop-item', (payload: { instanceId: string }) => {
            const inventory = this.player.getInventory();
            const droppedItem = inventory.getItemById(payload.instanceId);
            if (!droppedItem) return;
            const pos = this.dungeon.getPlayerPos();
            inventory.removeItemById(payload.instanceId);
            const pending = this.pendingPickup;
            if (pending) {
                if (inventory.addItem(pending.item)) {
                    EventBus.emit('message-log', `${pending.item.getLabelWithModifiers()}を入手した`, this.dungeon.getTurnCount());
                }
                this.dungeon.removeMapObject(pending.mapObject);
            }
            const droppedObj = new ItemObject(droppedItem);
            droppedObj.x = pos.x;
            droppedObj.y = pos.y;
            this.dungeon.placeObject(droppedObj);
            EventBus.emit('message-log', `${droppedItem.getLabelWithModifiers()}を置いた`, this.dungeon.getTurnCount());
            this.closeList();
            // 置く/入れ換えはターン非消費（dispatchObjectEvent を呼ばない）。
            // 呼んでしまうと置いた直後の around-0 で自動拾得が走り、置いたアイテムを即回収してしまう
            this.render();
        });

        EventBus.on('save-to-slot', async ({ slot, memo }: { slot: number; memo: string }) => {
            try {
                const saveData = await this.buildSaveData(memo);
                SaveManager.saveToSlot(slot, saveData);
                EventBus.emit('close-save-dialog');
                EventBus.emit('message-log', `スロット${slot}にセーブしました`, this.dungeon.getTurnCount());
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                EventBus.emit('message-log', `セーブに失敗しました: ${msg}`, this.dungeon.getTurnCount());
                EventBus.emit('close-save-dialog');
            }
            this.setSceneActions(this.defaultSceneActions);
        });

        EventBus.on('close-save-dialog', () => {
            if (this.input.keyboard) {
                this.input.keyboard.resetKeys();
                this.input.keyboard.enabled = true;
            }
            this.setSceneActions(this.defaultSceneActions);
        });

        if (this.pendingSaveData) {
            const sd = this.pendingSaveData;
            this.floor = sd.floor;
            this.player.deserialize(sd.player);
            this.dungeon.deserialize(sd.dungeon, this.buildDungeonRestoreCallbacks());
            this.dungeon.setCurrentFloor(this.floor);
            this.dungeon.setPlayerInstance(this.player);
            EventBus.emit('update-view');
            this.pendingSaveData = null;
        } else {
            EventBus.emit('go-to-next-floor', this.dungeon);
        }
        EventBus.emit('current-scene-ready', this);

        this.setupDebugCommands();

        this.defaultSceneActions = [
            { label: 'スキル', onClick: () => this.toggleList('skill') },
            { label: 'アイテム使用', onClick: () => this.toggleList('item') },
            { label: '装備変更', onClick: () => this.toggleList('equip') },
            { label: 'ステータス', onClick: () => this.openStatus() },
            { label: '足下', onClick: () => this.onUnderfoot() },
            { label: 'セーブ', onClick: () => this.openSaveDialog() },
        ];
        this.setSceneActions(this.defaultSceneActions);

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
                const a = this.currentSceneActions[i];
                if (a && !a.disabled) a.onClick();
            });
        });
    }

    /**
     * トラップの effect 配列を順次適用する。damage で死亡した場合は早期 return
     */
    private applyTrapEffects(trapDef: TrapDefinition): void {
        const turn = this.dungeon.getTurnCount();
        EventBus.emit('message-log', `${trapDef.label}を踏んだ！`, turn);

        for (const effect of trapDef.effect) {
            if (effect.type === 'stat' && typeof effect.target === 'string' && typeof effect.value === 'number') {
                const target = effect.target;
                const value = effect.value;
                const before = this.player.getStat(target);
                this.player.addStat(target, value);
                const delta = this.player.getStat(target) - before;
                const statsLoader = StatsLoader.getInstance();

                if (statsLoader.isFluctuationAllowed(target) && value < 0) {
                    // 変動する値ならダメージ表記
                    const damage = -delta;
                    EventBus.emit('attack-flash', 0xFF2222);
                    EventBus.emit('message-log',
                        `${damage}のダメージ！(残り${statsLoader.getAbbreviation(target)}: ${this.player.getStat(target)}/${this.player.getMaxStat(target)})`,
                        turn);
                    const cleared = this.player.notifyDamageTaken();
                    for (const c of cleared) {
                        EventBus.emit('message-log', `${c.label}が解けた`, turn);
                    }
                } else if (delta !== 0) {
                    // それ以外は汎用的な変動ログ
                    const statName = statsLoader.getAbbreviation(target) || target;
                    EventBus.emit('message-log', makeStatFluctuatedMessage(statName, delta), turn);
                }
                const deadVars = {
                    ...this.player.getFormulaVars(),
                    currentFloor: this.floor,
                    maxFloor: BaseLoader.getInstance().getGoalFloor(),
                };
                if (BaseLoader.getInstance().isDead(deadVars)) {
                    EventBus.emit('game-over');
                    return;
                }
            } else if (effect.type === 'addEffect' && typeof effect.value === 'string') {
                const effName = effect.value;
                const result = this.player.applyStatusEffect(effName);
                const def = EffectsLoader.getInstance().getEffect(effName);
                const label = def?.label ?? effName;
                if (result === 'applied') {
                    EventBus.emit('message-log', `${label}状態になった！`, turn);
                } else if (result === 'resisted') {
                    EventBus.emit('message-log', `${label}を耐性で防いだ！`, turn);
                }
            } else if (effect.type === 'unequip') {
                // トラップによる強制装備解除は cannot_unequip を無視する（ローグライク慣例）
                const slots: Array<'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2'> =
                    ['weapon', 'main_armor', 'sub_armor1', 'sub_armor2'];
                for (const slot of slots) {
                    const removed = this.player.unequipItem(slot);
                    if (removed) {
                        EventBus.emit('message-log', `${removed.getLabelWithModifiers()}が外れた`, turn);
                    }
                }
            }
        }
    }

    private buildItemListPayload(items: Item[]): Array<{ id: string; label: string; description: string; isEquipped: boolean; type: string; effectJson: string }> {
        const equippedIds = new Set(
            this.player.getAllEquippedItems()
                .filter((it): it is Item => it !== null)
                .map(it => it.getInstanceId())
        );
        return items.map(it => ({
            id: it.getInstanceId(),
            label: it.getLabelWithModifiers(),
            description: it.getDescription(),
            isEquipped: equippedIds.has(it.getInstanceId()),
            type: it.getType(),
            effectJson: JSON.stringify(it.getDefinition().effect),
        }));
    }

    private openStatus(): void {
        const lines: string[] = [];

        lines.push(`現在の階層：${this.floor}`);
        lines.push(`総経過ターン数：${this.dungeon.getTurnCount()}`);
        lines.push(`現在の階層のターン数：${this.dungeon.getFloorTurnCount()}`);
        lines.push(`レベル：${this.player.level}`);
        lines.push(`次のレベルまでの経験値：${this.player.expToNextLevel() - this.player.exp}`);
        lines.push('');

        const displayParams = this.getDisplayParams();
        for (const [key, value] of displayParams) {
            lines.push(`${key}：${value}`);
        }
        if (!displayParams.has('状態')) {
            lines.push('状態：なし');
        }
        lines.push('');

        lines.push(`武器：${this.player.getEquippedWeapon()?.getLabelWithModifiers() ?? 'なし'}`);
        lines.push(`メイン防具：${this.player.getEquippedMainArmor()?.getLabelWithModifiers() ?? 'なし'}`);
        lines.push(`サブ防具１：${this.player.getEquippedSubArmor1()?.getLabelWithModifiers() ?? 'なし'}`);
        lines.push(`サブ防具２：${this.player.getEquippedSubArmor2()?.getLabelWithModifiers() ?? 'なし'}`);
        lines.push('');

        lines.push('アイテム：');
        const items = this.player.getInventory().getItems();
        if (items.length > 0) {
            for (const item of items) {
                lines.push(item.getLabelWithModifiers());
            }
        } else {
            lines.push('なし');
        }

        EventBus.emit('open-status', lines.join('\n'));
    }

    private toggleList(mode: 'item' | 'equip' | 'skill'): void {
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

    private openList(mode: 'item' | 'equip' | 'drop' | 'skill'): void {
        if (this.listMode !== null) this.closeList();

        if (mode === 'skill') {
            const learned = this.player.getLearnedSkillNames();
            this.listMode = 'skill';
            if (this.input.keyboard) this.input.keyboard.enabled = false;
            EventBus.emit('open-item-list', {
                items: this.buildSkillListPayload(learned),
                mode: 'skill',
                actionLabel: '発動',
            });
            return;
        }

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

    private buildSkillListPayload(skillNames: string[]): Array<{
        id: string; label: string; description: string;
        costSummary?: string; targetSummary?: string;
        disabled?: boolean; disabledReason?: string;
    }> {
        const stunned = this.player.getPlayerActionDirective() === 'skip';
        const loader = SkillsLoader.getInstance();
        const result: Array<{
            id: string; label: string; description: string;
            costSummary?: string; targetSummary?: string;
            disabled?: boolean; disabledReason?: string;
        }> = [];
        for (const name of skillNames) {
            const compiled = loader.getCompiledSkill(name);
            if (!compiled) continue;
            const def = compiled.definition;
            if ((def.trigger ?? 'active') === 'on_attack') {
                result.push({
                    id: name,
                    label: def.label,
                    description: def.description,
                    costSummary: '',
                    targetSummary: 'パッシブ',
                    disabled: true,
                    disabledReason: 'パッシブスキル',
                });
                continue;
            }
            const deltas = evaluateCost(this.player, compiled);
            const canPay = canPayCost(this.player, deltas);
            const disabled = stunned || !canPay;
            const disabledReason = stunned ? '動けない' : (canPay ? '' : 'コスト不足');
            result.push({
                id: name,
                label: def.label,
                description: def.description,
                costSummary: formatCostSummary(deltas),
                targetSummary: formatTargetSummary(def.target),
                disabled,
                disabledReason,
            });
        }
        return result;
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

    /**
     * DevTools コンソールから利用するデバッグ用関数を `window` に公開する。
     * 全関数は `（debug）` プレフィックス付きでメッセージログに発行する。
     */
    private setupDebugCommands(): void {
        const w = window as unknown as Record<string, unknown>;

        // window.listMapItems() - 現在フロアの床アイテム一覧
        w.listMapItems = () => {
            const turn = this.dungeon.getTurnCount();
            const result: Array<{ x: number; y: number; name: string; label: string; modifiers: Record<string, number> }> = [];
            for (const obj of this.dungeon.getObjects().values()) {
                if (obj instanceof ItemObject) {
                    const modifiers = Object.fromEntries(obj.item.getModifiers());
                    result.push({
                        x: obj.x,
                        y: obj.y,
                        name: obj.item.getName(),
                        label: obj.item.getLabelWithModifiers(),
                        modifiers,
                    });
                }
            }
            console.log(`[listMapItems] 床アイテム ${result.length} 個 (floor=${this.floor}):`);
            console.table(result);
            EventBus.emit('message-log', `（debug）床アイテム ${result.length} 個（詳細はコンソール参照）`, turn);
            return result;
        };

        // window.addItem('iron sword', 1) - 名前指定でアイテムをインベントリに追加（modifier 抽選なし）
        w.addItem = (name: string, count: number = 1): number => {
            const turn = this.dungeon.getTurnCount();
            const inventory = this.player.getInventory();
            let added = 0;
            for (let i = 0; i < count; i++) {
                const item = Player.createItem(name);
                if (!item) {
                    EventBus.emit('message-log', `（debug）${name} は未定義アイテム`, turn);
                    break;
                }
                if (!inventory.addItem(item)) {
                    EventBus.emit('message-log', `（debug）インベントリ満杯のため追加中断`, turn);
                    break;
                }
                added++;
            }
            if (added > 0) {
                EventBus.emit('message-log', `（debug）${name} を ${added} 個追加`, turn);
                this.render();
            }
            return added;
        };

        // window.addTestItems() - 動作確認用の代表アイテムを一括追加
        w.addTestItems = (): string[] => {
            const turn = this.dungeon.getTurnCount();
            const names = ['iron sword', 'round shield', 'silver ring', 'potion', 'power potion', 'mana potion'];
            const inventory = this.player.getInventory();
            const added: string[] = [];
            for (const name of names) {
                const item = Player.createItem(name);
                if (!item) continue;
                if (!inventory.addItem(item)) break;
                added.push(name);
            }
            EventBus.emit('message-log', `（debug）テストアイテム ${added.length} 個を追加`, turn);
            this.render();
            return added;
        };

        // window.addItemModifier('weapon', 'power_reinforced', 2) - 装備中アイテムに modifier 付与
        w.addItemModifier = (slot: 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2', name: string, count: number = 1): boolean => {
            const target = this.player.getItemInSlot(slot);
            const turn = this.dungeon.getTurnCount();
            if (!target) {
                EventBus.emit('message-log', `（debug）${slot} に装備中のアイテムがありません`, turn);
                return false;
            }
            const ok = target.setModifierCount(name, count);
            if (ok) {
                EventBus.emit('message-log', `（debug）${target.getLabelWithModifiers()} に ${name} を付与`, turn);
                this.render();
            } else {
                EventBus.emit('message-log', `（debug）${name} は未定義 or 対象 type 不一致`, turn);
            }
            return ok;
        };

        // window.removeItemModifier('weapon', 'cursed') - modifier 除去
        w.removeItemModifier = (slot: 'weapon' | 'main_armor' | 'sub_armor1' | 'sub_armor2', name: string): boolean => {
            const target = this.player.getItemInSlot(slot);
            const turn = this.dungeon.getTurnCount();
            if (!target) {
                EventBus.emit('message-log', `（debug）${slot} に装備中のアイテムがありません`, turn);
                return false;
            }
            const ok = target.removeModifier(name);
            if (ok) {
                EventBus.emit('message-log', `（debug）${target.getLabelWithModifiers()} から ${name} を除去`, turn);
                this.render();
            } else {
                EventBus.emit('message-log', `（debug）${target.getLabel()} は ${name} を持っていません`, turn);
            }
            return ok;
        };

        // window.applyStatusEffect('poison') - プレイヤーに状態異常を付与
        w.applyStatusEffect = (name: string): string => {
            const result = this.player.applyStatusEffect(name);
            if (result === 'applied') {
                EventBus.emit('message-log', `（debug）${name} を付与`, this.dungeon.getTurnCount());
                this.render();
            } else if (result === 'resisted') {
                EventBus.emit('message-log', `（debug）${name} を耐性で防いだ`, this.dungeon.getTurnCount());
            } else {
                EventBus.emit('message-log', `（debug）${name} は未定義 effect`, this.dungeon.getTurnCount());
            }
            return result;
        };

        // window.applyStatusEffectToEnemy('poison') - 敵に状態異常付与
        // instanceId 未指定なら視界内で最も近い生存敵を選択
        w.applyStatusEffectToEnemy = (name: string, instanceId?: string): string => {
            const turn = this.dungeon.getTurnCount();
            const enemies = this.dungeon.getEnemies().filter(e => e.isAlive());
            let target: Enemy | null = (instanceId ? enemies.find(e => e.getInstanceId() === instanceId) : undefined) ?? null;
            if (!target) {
                const { x: px, y: py } = this.dungeon.getPlayerPos();
                let best: Enemy | null = null;
                let bestDist = Infinity;
                for (const e of enemies) {
                    if (!this.dungeon.hasLineOfSight(e.x, e.y, px, py)) continue;
                    const d = Math.max(Math.abs(e.x - px), Math.abs(e.y - py));
                    if (d < bestDist) { best = e; bestDist = d; }
                }
                target = best;
            }
            if (!target) {
                EventBus.emit('message-log', `（debug）対象の敵が見つかりません`, turn);
                return 'no-target';
            }
            const result = target.applyStatusEffect(name);
            if (result === 'applied') {
                EventBus.emit('message-log', `（debug）${target.getLabel()}に${name}を付与`, turn);
                this.render();
            } else if (result === 'resisted') {
                EventBus.emit('message-log', `（debug）${target.getLabel()}は${name}を耐性で防いだ`, turn);
            } else {
                EventBus.emit('message-log', `（debug）${name} は未定義 effect`, turn);
            }
            return result;
        };

        // window.learnSkill('double_attack') - スキル習得
        w.learnSkill = (name: string): boolean => {
            const ok = this.player.learnSkill(name);
            EventBus.emit('message-log',
                ok ? `（debug）スキル「${name}」を習得` : `（debug）スキル「${name}」習得失敗（未定義 or 既習得）`,
                this.dungeon.getTurnCount());
            return ok;
        };

        // window.forgetSkill('double_attack') - スキル習得取り消し
        w.forgetSkill = (name: string): boolean => {
            const ok = this.player.forgetSkill(name);
            EventBus.emit('message-log',
                ok ? `（debug）スキル「${name}」を忘却` : `（debug）スキル「${name}」は未習得`,
                this.dungeon.getTurnCount());
            return ok;
        };

        // window.listSkills() - 習得済みスキル一覧
        w.listSkills = (): string[] => this.player.getLearnedSkillNames();

        // window.addExp(50) - 経験値加算（mastery 抽選含む）
        w.addExp = (n: number) => {
            const result = this.player.addExp(n);
            EventBus.emit('message-log', `（debug）経験値+${n}`, this.dungeon.getTurnCount());
            const skillsLoader = SkillsLoader.getInstance();
            for (const lv of result.levels) {
                EventBus.emit('message-log', `レベルアップ！Lv${lv.level}`, this.dungeon.getTurnCount());
                for (const skillName of lv.learnedSkills) {
                    const label = skillsLoader.getSkill(skillName)?.label ?? skillName;
                    EventBus.emit('message-log', `スキル「${label}」を習得した！`, this.dungeon.getTurnCount());
                }
            }
            this.render();
            return result;
        };

        // window.levelUpN(3) - 経験値を介さず直接 n 回 levelUp（mastery 抽選確認用）
        w.levelUpN = (n: number = 1): string[] => {
            const allLearned: string[] = [];
            for (let i = 0; i < n; i++) {
                const learned = this.player.levelUp();
                allLearned.push(...learned);
                EventBus.emit('message-log', `（debug）レベルアップ！Lv${this.player.level}`, this.dungeon.getTurnCount());
                for (const skillName of learned) {
                    const label = SkillsLoader.getInstance().getSkill(skillName)?.label ?? skillName;
                    EventBus.emit('message-log', `スキル「${label}」を習得した！`, this.dungeon.getTurnCount());
                }
            }
            this.render();
            return allLearned;
        };

        // window.findPath(1,1,2,7,false) - 経路探索結果をコンソール出力
        w.findPath = (
            startX: integer,
            startY: integer,
            endX: integer,
            endY: integer,
            room: boolean,
            blacked: [number, number][] = []
        ) => {
            const result = this.dungeon.findPath(startX, startY, endX, endY, {scope: room ? 'room' : 'full', blockedPositions: blacked});
            console.debug(result);
        };
    }

    private spawnEnemies(dungeon: DungeonMap, config: ResolvedFloorConfig, excludePositions: integer[][] = []): void {
        // 固定敵を先に配置
        for (const { name, count } of config.fixedEnemies) {
            const positions = dungeon.getRandomPosList(count, false, {
                withoutPlayer: true,
                excludePositionList: excludePositions,
            });
            for (const pos of positions) {
                const enemy = Player.createEnemyByName(name, pos[0], pos[1]);
                if (enemy) dungeon.addEnemy(enemy);
                excludePositions.push(pos);
            }
        }

        // 残りスロットをランダムプールから配置
        const fixedTotal = config.fixedEnemies.reduce((sum, e) => sum + e.count, 0);
        const randomCount = Math.max(0, config.enemyCount - fixedTotal);
        if (randomCount > 0 && config.randomEnemyPool.length > 0) {
            const positions = dungeon.getRandomPosList(randomCount, false, {
                withoutPlayer: true,
                excludePositionList: excludePositions,
            });
            for (const pos of positions) {
                const name = config.randomEnemyPool[Math.floor(Math.random() * config.randomEnemyPool.length)];
                const enemy = Player.createEnemyByName(name, pos[0], pos[1]);
                if (enemy) dungeon.addEnemy(enemy);
            }
        }

        console.log(`Spawned enemies on floor ${this.floor} (fixed: ${fixedTotal}, random: ${randomCount})`);
    }

    private setSceneActions(actions: SceneAction[]): void {
        this.currentSceneActions = actions;
        EventBus.emit('scene-actions', actions);
    }

    private toggleMiniMapMode(): void {
        const isFullMap = this.miniMapView.toggleMapMode();
        localStorage.setItem('frame_dungeon_minimap_full', String(isFullMap));
        this.miniMapView.render(this.dungeon, this.revealAll);
    }

    /**
     * Space 押下時の処理。前方斜めに敵がいれば3択ボタンを提示し、
     * いなければ従来通り正面を即時攻撃する。
     */
    private tryAttackOrShowDirections(autoAttack: boolean = false): void {
        const { x, y, direction } = this.dungeon.getPlayerPos();
        const [fdx, fdy] = getDirectionOffset(direction);
        const [rdx, rdy] = getDirectionOffset(rotateDirection(direction, 1));
        const centerCell: [integer, integer] = [x + fdx, y + fdy];
        const rightCell: [integer, integer] = [centerCell[0] + rdx, centerCell[1] + rdy];
        const leftCell: [integer, integer] = [centerCell[0] - rdx, centerCell[1] - rdy];

        const hasRightEnemy = !!this.dungeon.getEnemy(rightCell[0], rightCell[1]) && this.dungeon.canAttack(x, y, rightCell[0], rightCell[1]);
        const hasLeftEnemy = !!this.dungeon.getEnemy(leftCell[0], leftCell[1]) && this.dungeon.canAttack(x, y, leftCell[0], leftCell[1]);

        if (!hasRightEnemy && !hasLeftEnemy) {
            this.executeAction(() => this.dungeon.attackPlayer());
            return;
        }

        const hasCenterEnemy = !!this.dungeon.getEnemy(centerCell[0], centerCell[1]) && this.dungeon.canAttack(x, y, centerCell[0], centerCell[1]);

        if (autoAttack) {
            if (hasCenterEnemy) {
                this.executeAction(() => this.dungeon.attackEnemyAt(centerCell[0], centerCell[1]));
                return;
            }
            if (hasRightEnemy) {
                this.executeAction(() => this.dungeon.attackEnemyAt(rightCell[0], rightCell[1]));
                return;
            }
            if (hasLeftEnemy) {
                this.executeAction(() => this.dungeon.attackEnemyAt(leftCell[0], leftCell[1]));
                return;
            }
        }

        const invalidPos:[number, number] = [-1, -1];
        this.enterAttackDirectionMode(
            hasCenterEnemy ? centerCell : invalidPos,
            hasRightEnemy ? rightCell : invalidPos,
            hasLeftEnemy ? leftCell : invalidPos,
        );
    }

    private enterAttackDirectionMode(
        centerCell: [integer, integer],
        rightCell: [integer, integer],
        leftCell: [integer, integer],
    ): void {
        const actions: SceneAction[] = [
            {
                label: '左',
                disabled: leftCell[0] < 0,
                onClick: () => this.executeAttackDirection(leftCell[0], leftCell[1]),
            },
            {
                label: '中央',
                disabled: centerCell[0] < 0,
                onClick: () => this.executeAttackDirection(centerCell[0], centerCell[1]),
            },
            {
                label: '右',
                disabled: rightCell[0] < 0,
                onClick: () => this.executeAttackDirection(rightCell[0], rightCell[1]),
            },
            {
                label: 'キャンセル',
                onClick: () => this.exitAttackDirectionMode(),
            },
        ];

        this.setSceneActions(actions);
    }

    private executeAttackDirection(targetX: integer, targetY: integer): void {
        this.exitAttackDirectionMode();
        this.executeAction(() => this.dungeon.attackEnemyAt(targetX, targetY));
    }

    private exitAttackDirectionMode(): void {
        this.setSceneActions(this.defaultSceneActions);
    }

    /**
     * target: front スキルの方向選択モードに移行する。
     * 左/中央/右/キャンセル の 4 ボタンを表示し、選択でスキル発動、
     * キャンセルでコスト未消費・defaultSceneActions に復帰する。
     */
    private enterSkillTargetSelectMode(skillName: string): void {
        const candidates = getFrontCandidates(this.dungeon);
        const actions: SceneAction[] = [
            {
                label: '左',
                disabled: !candidates[0].valid,
                onClick: () => this.executeSkillWithFront(skillName, candidates[0].cell),
            },
            {
                label: '中央',
                disabled: !candidates[1].valid,
                onClick: () => this.executeSkillWithFront(skillName, candidates[1].cell),
            },
            {
                label: '右',
                disabled: !candidates[2].valid,
                onClick: () => this.executeSkillWithFront(skillName, candidates[2].cell),
            },
            {
                label: 'キャンセル',
                onClick: () => this.exitSkillTargetSelectMode(),
            },
        ];
        this.setSceneActions(actions);
    }

    private executeSkillWithFront(skillName: string, cell: { x: integer; y: integer }): void {
        this.exitSkillTargetSelectMode();
        this.executeAction(() => this.dungeon.useSkill(skillName, cell));
    }

    private exitSkillTargetSelectMode(): void {
        this.setSceneActions(this.defaultSceneActions);
    }

    private trySearch(): void {
        const { x, y, direction } = this.dungeon.getPlayerPos();
        const [fdx, fdy] = getDirectionOffset(direction);
        const [rdx, rdy] = getDirectionOffset(rotateDirection(direction, 1));
        const centerCell: [integer, integer] = [x + fdx, y + fdy];
        const rightCell: [integer, integer] = [centerCell[0] + rdx, centerCell[1] + rdy];
        const leftCell: [integer, integer] = [centerCell[0] - rdx, centerCell[1] - rdy];

        const actions: SceneAction[] = [
            {
                label: '左',
                onClick: () => this.executeSearch('左', leftCell[0], leftCell[1]),
            },
            {
                label: '中央',
                onClick: () => this.executeSearch('中央', centerCell[0], centerCell[1]),
            },
            {
                label: '右',
                onClick: () => this.executeSearch('右', rightCell[0], rightCell[1]),
            },
            {
                label: 'キャンセル',
                onClick: () => this.exitAttackDirectionMode(),
            },
        ];

        this.setSceneActions(actions);
    }

    private executeSearch(directionLabel: string, targetX: integer, targetY: integer): void {
        const turnCount = this.dungeon.getTurnCount();
        EventBus.emit('message-log', `${directionLabel}を調べた。`, turnCount);
        this.dungeon.searchAt(targetX, targetY);
        this.render();
        this.exitAttackDirectionMode();
    }

    private enterStairMode(dungeon: DungeonMap): void {
        const goalFloor = BaseLoader.getInstance().getGoalFloor();
        if (this.floor >= goalFloor) {
            EventBus.emit('message-log', `${this.floor}階の階段を登り切った！クリア！`, dungeon.getTurnCount());
            EventBus.emit('game-clear');
            return;
        }
        EventBus.emit('message-log', `${this.floor + 1}階への階段だ`, dungeon.getTurnCount());
        const actions: SceneAction[] = [
            {
                label: '進む',
                onClick: () => {
                    this.exitStairMode();
                    this.floor++;
                    EventBus.emit('message-log', `${this.floor}階に移動した`, dungeon.getTurnCount());
                    EventBus.emit('go-to-next-floor', dungeon);
                },
            },
            {
                label: 'やめる',
                onClick: () => this.exitStairMode(),
            },
        ];
        this.setSceneActions(actions);
    }

    private exitStairMode(): void {
        this.setSceneActions(this.defaultSceneActions);
    }

    private enterTrapConfirmMode(trapDef: TrapDefinition, trapObject: MapObject): void {
        const turn = this.dungeon.getTurnCount();
        EventBus.emit('message-log', `トラップ：${trapDef.label}`, turn);
        EventBus.emit('message-log', `説明：${trapDef.description}`, turn);
        EventBus.emit('message-log', `このトラップを起動しますか？`, turn);
        const actions: SceneAction[] = [
            {
                label: '起動',
                onClick: () => {
                    this.exitTrapConfirmMode();
                    trapObject.visible = true;
                    this.executeAction(() => {
                        this.applyTrapEffects(trapDef);
                        this.dungeon.dispatchObjectEvent();
                        return true;
                    });
                },
            },
            {
                label: 'やめる',
                onClick: () => this.exitTrapConfirmMode(),
            },
        ];
        this.setSceneActions(actions);
    }

    private exitTrapConfirmMode(): void {
        this.setSceneActions(this.defaultSceneActions);
    }

    /**
     * プレイヤー行動ディレクティブ（onAction の状態異常効果）を処理する
     * skip ディレクティブの場合は空アクションでターン消費し true を返す
     * @returns ディレクティブにより通常アクションをスキップした場合 true
     */
    private handlePlayerActionDirective(): boolean {
        const directive = this.player?.getPlayerActionDirective();
        if (directive === 'skip') {
            EventBus.emit('message-log', '動けない！', this.dungeon.getTurnCount());
            this.executeAction(() => { this.dungeon.dispatchObjectEvent(); return true; });
            return true;
        }
        return false;
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

    private openSaveDialog(): void {
        this.setSceneActions([]);
        if (this.input.keyboard) this.input.keyboard.enabled = false;
        EventBus.emit('open-save-dialog', {
            floor: this.floor,
            gameName: BaseLoader.getInstance().getName(),
        });
    }

    private async buildSaveData(memo: string): Promise<SaveData> {
        const yamlDigest = await SaveManager.calculateDigest();
        return {
            meta: {
                savedAt: new Date().toISOString(),
                memo,
                gameName: BaseLoader.getInstance().getName(),
                yamlDigest,
            },
            floor: this.floor,
            player: this.player.serialize(),
            dungeon: this.dungeon.serialize(),
        };
    }

    private buildDungeonRestoreCallbacks(): DungeonRestoreCallbacks {
        return {
            onEnterStair: (dungeon: DungeonMap) => this.enterStairMode(dungeon),
            applyTrapEffects: (def: TrapDefinition) => this.applyTrapEffects(def),
            enterTrapConfirmMode: (def: TrapDefinition, obj: MapObject) => this.enterTrapConfirmMode(def, obj),
        };
    }

    changeScene() {
        this.scene.start('GameOver');
    }
}
