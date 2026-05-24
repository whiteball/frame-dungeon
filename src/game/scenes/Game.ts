import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap } from '../../lib/MapGenerator';
import { MapObject } from '../../lib/MapObject';
import { MainView } from '../../lib/MainView';
import { MiniMapView } from '../../lib/MiniMapView';
import { InfoView } from '../../lib/InfoView';
import { EquipmentView } from '../../lib/EquipmentView';
import { Player } from '../../lib/Player';
import type { Item } from '../../lib/Item';
import { formatItemTypeLabel, formatItemEffect } from '../../lib/ItemDescriptionFormatter';
import { TrapsLoader } from '../../lib/TrapsLoader';
import type { TrapDefinition } from '../../lib/TrapsLoader';
import { EffectsLoader } from '../../lib/EffectsLoader';
import { SkillsLoader } from '../../lib/SkillsLoader';
import { evaluateCost, canPayCost, formatCostSummary } from '../../lib/skills/SkillExecutor';
import { getFrontCandidates, formatTargetSummary } from '../../lib/skills/TargetResolver';
import { makeStatFluctuatedMessage } from '../../lib/util/text';
import { StatsLoader } from '../../lib/StatsLoader';
import { MapDirection, getDirectionOffset, rotateDirection } from '../../lib/map/MapDirection';
import { ItemObject, TreasureObject } from '../../lib/map/MapObjects';
import { setupDebugCommands } from './game/GameDebugCommands';
import { populateFloor } from './game/FloorPopulator';
import { SceneModeController } from './game/SceneModeController';
import type { SceneAction } from './game/SceneModeController';
import { buildDisplayParams, buildStatusText, buildResultText } from './game/StatusReportBuilder';
import { BaseLoader } from '../../lib/BaseLoader';
import { SaveManager } from '../../lib/SaveManager';
import { YamlCrossValidator } from '../../lib/YamlCrossValidator';
import type { SaveData } from '../../lib/SaveManager';
import type { DungeonRestoreCallbacks } from '../../lib/MapGenerator';

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
        keyEsc: Phaser.Input.Keyboard.Key | undefined,
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
    private mode = new SceneModeController(this);
    private viewRange = 3;
    private enableFog = true;
    private revealAll = false;
    private swapQEandAD = false;
    private swapSandShiftS = false;
    private debugCommands = false;
    private pendingSaveData: SaveData | null = null;

    constructor() {
        super('Game');
    }

    init(data: { viewRange?: number; enableFog?: boolean; showAllEnemies?: boolean; swapQEandAD?: boolean; swapSandShiftS?: boolean; debugCommands?: boolean; saveData?: SaveData }) {
        this.viewRange = data.viewRange ?? 3;
        this.enableFog = data.enableFog ?? true;
        this.revealAll = data.showAllEnemies ?? false;
        this.swapQEandAD = data.swapQEandAD ?? false;
        this.swapSandShiftS = data.swapSandShiftS ?? false;
        this.debugCommands = data.debugCommands ?? false;
        this.pendingSaveData = data.saveData ?? null;
    }

    private getOpenDoors(): Set<string> {
        const open = new Set<string>();
        const pos = this.dungeon.getPlayerPos();
        for (let dir = 0; dir < 4; dir++) {
            const val = this.dungeon.getAt(pos.x, pos.y);
            if (!(val & (1 << dir)) || !(val & (16 << dir))) continue;
            const [dx, dy] = getDirectionOffset(dir as MapDirection);
            const nx = pos.x + dx, ny = pos.y + dy;
            if (this.dungeon.getEnemy(nx, ny)) {
                open.add(`${pos.x},${pos.y},${dir}`);
            }
        }
        return open;
    }

    render() {
        this.miniMapView.render(this.dungeon, this.revealAll);
        this.mainView.render(this.dungeon, this.getOpenDoors());
        this.params = buildDisplayParams(this.player);
        this.infoView.render(this.floor, this.params);
        this.equipmentView.render({
            weapon: this.player.getEquippedWeapon(),
            mainArmor: this.player.getEquippedMainArmor(),
            subArmor1: this.player.getEquippedSubArmor1(),
            subArmor2: this.player.getEquippedSubArmor2(),
        });
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
        EventBus.removeAllListeners('export-save');
        EventBus.removeAllListeners('close-save-dialog');
        EventBus.removeAllListeners('long-stay-warning');

        this.floor = 1;
        const dun = new DungeonMap(15, 15, this.viewRange, this.enableFog);

        EventBus.on('long-stay-warning', (stage: number, message: string, turn: number) => {
            EventBus.emit('message-log', message, turn);
            if (stage === 3) {
                this.mode.enterDefaultMode();
                this.floor++;
                EventBus.emit('go-to-next-floor', this.dungeon);
            } else {
                this.mode.enterLongStayWarningMode();
            }
        });

        EventBus.on('go-to-next-floor', (dungeon: DungeonMap) => {
            populateFloor({
                dungeon,
                floor: this.floor,
                callbacks: this.buildDungeonRestoreCallbacks(),
            });
            EventBus.emit('update-view');
        });

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
        this.params = buildDisplayParams(this.player);

        this.mainView = new MainView(this.add, 10, 10, 760, 520);
        const miniMapX = this.game.canvas.width - 10 - 200;
        const miniMapY = 10;
        const miniMapSize = 200;
        const savedMinimapMode = localStorage.getItem('frame_dungeon_minimap_full') === 'true';
        this.miniMapView = new MiniMapView(this.add, miniMapX, miniMapY, miniMapSize, miniMapSize, savedMinimapMode);
        const miniMapZone = this.add.zone(miniMapX + miniMapSize / 2, miniMapY + miniMapSize / 2, miniMapSize, miniMapSize).setInteractive();
        miniMapZone.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
            if (pointer.rightButtonDown()) {
                if (this.miniMapView.isMoveMode()) {
                    this.mode.exitMinimapMoveMode();
                } else if (!this.mode.isModalMode) {
                    if (this.miniMapView.getFullMapMode()) {
                        // 全体マップモード: クリック座標からタイル座標を計算してズーム移動モードへ
                        const relX = pointer.x - miniMapX;
                        const relY = pointer.y - miniMapY;
                        const maxLength = Math.max(this.dungeon.getWidth(), this.dungeon.getHeight());
                        const blockSize = miniMapSize / maxLength;
                        const tileX = Math.max(1, Math.min(this.dungeon.getWidth() - 2, Math.floor(relX / blockSize) + 1));
                        const tileY = Math.max(1, Math.min(this.dungeon.getHeight() - 2, Math.floor(relY / blockSize) + 1));
                        const playerPos = this.dungeon.getPlayerPos();
                        this.miniMapView.toggleMapMode();
                        localStorage.setItem('frame_dungeon_minimap_full', 'false');
                        this.mode.enterMinimapMoveMode(tileX - playerPos.x, tileY - playerPos.y, true);
                        this.miniMapView.render(this.dungeon, this.revealAll);
                    } else {
                        this.mode.enterMinimapMoveMode();
                    }
                }
                return;
            }
            if (this.mode.isModalMode) return;
            this.mode.toggleMiniMapMode();
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
            keyEsc: this.input.keyboard?.addKey(Phaser.Input.Keyboard.KeyCodes.ESC),
        };

        this.keys.keyW?.on('down', () => {
            if (this.miniMapView.isMoveMode()) {
                this.miniMapView.scroll(0, -1, this.dungeon);
                this.miniMapView.render(this.dungeon, this.revealAll);
                return;
            }
            if (this.mode.isModalMode) return;
            if (this.handlePlayerActionDirective()) return;
            this.executeAction(() => this.dungeon.goPlayer() > 0);
        })
        this.keys.keySpace?.on('down', (event: KeyboardEvent) => {
            if (this.mode.isModalMode) return;
            if (this.handlePlayerActionDirective()) return;
            this.tryAttackOrShowDirections(event.shiftKey);
        })
        this.keys.keyA?.on('down', () => {
            if (this.miniMapView.isMoveMode()) {
                this.miniMapView.scroll(-1, 0, this.dungeon);
                this.miniMapView.render(this.dungeon, this.revealAll);
                return;
            }
            if (this.mode.isModalMode) return;
            if (this.swapQEandAD) {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goLeftPlayer() > 0);
            } else {
                this.executeAction(() => this.dungeon.turnLeftPlayer());
            }
        })
        this.keys.keyS?.on('down', (event: KeyboardEvent) => {
            if (this.miniMapView.isMoveMode()) {
                this.miniMapView.scroll(0, 1, this.dungeon);
                this.miniMapView.render(this.dungeon, this.revealAll);
                return;
            }
            if (this.mode.isModalMode) return;
            const doStrafeBack = this.swapSandShiftS ? !event.shiftKey : event.shiftKey;
            if (doStrafeBack) {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goBackPlayer() > 0);
            } else {
                this.executeAction(() => this.dungeon.turnBackPlayer());
            }
        })
        this.keys.keyD?.on('down', () => {
            if (this.miniMapView.isMoveMode()) {
                this.miniMapView.scroll(1, 0, this.dungeon);
                this.miniMapView.render(this.dungeon, this.revealAll);
                return;
            }
            if (this.mode.isModalMode) return;
            if (this.swapQEandAD) {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goRightPlayer() > 0);
            } else {
                this.executeAction(() => this.dungeon.turnRightPlayer());
            }
        })
        this.keys.keyE?.on('down', () => {
            if (this.mode.isModalMode) return;
            if (this.swapQEandAD) {
                this.executeAction(() => this.dungeon.turnRightPlayer());
            } else {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goRightPlayer() > 0);
            }
        })
        this.keys.keyQ?.on('down', () => {
            if (this.mode.isModalMode) return;
            if (this.swapQEandAD) {
                this.executeAction(() => this.dungeon.turnLeftPlayer());
            } else {
                if (this.handlePlayerActionDirective()) return;
                this.executeAction(() => this.dungeon.goLeftPlayer() > 0);
            }
        })
        this.keys.keyM?.on('down', (event: KeyboardEvent) => {
            if (event.shiftKey) {
                if (this.miniMapView.isMoveMode()) {
                    this.mode.exitMinimapMoveMode();
                } else if (!this.mode.isModalMode && !this.miniMapView.getFullMapMode()) {
                    this.mode.enterMinimapMoveMode();
                }
                return;
            }
            if (this.mode.isModalMode) return;
            this.mode.toggleMiniMapMode();
        })

        this.keys.keyC?.on('down', () => {
            if (this.mode.isModalMode) return;
            if (this.handlePlayerActionDirective()) return;
            this.trySearch();
        })

        this.keys.keyEsc?.on('down', () => {
            if (this.miniMapView.isMoveMode()) {
                this.mode.exitMinimapMoveMode();
            }
        })

        this.dungeon = dun;
        this.dungeon.setPlayerInstance(this.player);

        EventBus.on('update-view', () => {
            this.render();
        })

        EventBus.on('game-over', () => {
            this.closeList();
            this.scene.start('GameOver', { resultText: this.composeResultText() });
        })

        EventBus.on('game-clear', () => {
            this.closeList();
            this.scene.start('GameClear', { resultText: this.composeResultText() });
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
            this.mode.enterDefaultMode();
        });

        EventBus.on('export-save', async ({ memo }: { memo: string }) => {
            try {
                const saveData = await this.buildSaveData(memo);
                SaveManager.downloadSaveFile(saveData);
                EventBus.emit('message-log', 'セーブデータをエクスポートしました', this.dungeon.getTurnCount());
            } catch (e: unknown) {
                const msg = e instanceof Error ? e.message : String(e);
                EventBus.emit('message-log', `エクスポートに失敗しました: ${msg}`, this.dungeon.getTurnCount());
            }
        });

        EventBus.on('close-save-dialog', () => {
            if (this.input.keyboard) {
                this.input.keyboard.resetKeys();
                this.input.keyboard.enabled = true;
            }
            this.mode.enterDefaultMode();
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

        if (this.debugCommands) {
            setupDebugCommands(this);
        }

        this.mode.initDefaultActions([
            { label: 'スキル', onClick: () => this.toggleList('skill') },
            { label: 'アイテム使用', onClick: () => this.toggleList('item') },
            { label: '装備変更', onClick: () => this.toggleList('equip') },
            { label: 'ステータス', onClick: () => this.openStatus() },
            { label: '足下', onClick: () => this.onUnderfoot() },
            { label: 'セーブ', onClick: () => this.openSaveDialog() },
        ]);

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
                const a = this.mode.current[i];
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
                        `${damage}のダメージ！(残り${statsLoader.getAbbreviation(target)}: ${this.player.getStat(target)}/${this.player.getEffectiveMaxStat(target)})`,
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

    private buildItemListPayload(items: Item[]): Array<{ id: string; label: string; description: string; isEquipped: boolean; typeLabel: string; effectSummary: string }> {
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
            typeLabel: formatItemTypeLabel(it.getType()),
            effectSummary: formatItemEffect(it.getEffectSpecs()),
        }));
    }

    private openStatus(): void {
        EventBus.emit('open-status', buildStatusText({
            floor: this.floor,
            dungeon: this.dungeon,
            player: this.player,
        }));
    }

    private composeResultText(): string {
        return buildResultText({
            floor: this.floor,
            dungeon: this.dungeon,
            player: this.player,
            settings: {
                viewRange: this.viewRange,
                enableFog: this.enableFog,
                revealAll: this.revealAll,
                debugCommands: this.debugCommands,
            },
        });
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
            const triggerValue = def.trigger ?? 'active';
            if (triggerValue !== 'active') {
                // パッシブ全種（on_attack / on_turn / on_damage / passive）は手動発動不可
                const passiveLabel = this.getPassiveTargetSummary(triggerValue, compiled);
                const passiveReason = this.getPassiveDisabledReason(triggerValue);
                result.push({
                    id: name,
                    label: def.label,
                    description: def.description,
                    costSummary: triggerValue === 'passive' ? '' : formatCostSummary(evaluateCost(this.player, compiled)),
                    targetSummary: passiveLabel,
                    disabled: true,
                    disabledReason: passiveReason,
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
                targetSummary: def.target ? formatTargetSummary(def.target) : '',
                disabled,
                disabledReason,
            });
        }
        return result;
    }

    private getPassiveTargetSummary(trigger: string, compiled: ReturnType<typeof SkillsLoader.prototype.getCompiledSkill>): string {
        switch (trigger) {
            case 'on_attack': return '攻撃時';
            case 'on_turn': return 'ターン経過';
            case 'on_damage': return '被ダメージ';
            case 'passive': {
                // add_stats のサマリを生成（"攻+5 / HPmax+10" 形式）
                if (!compiled || compiled.addStats.size === 0) return '常時';
                const baseVars = this.player.getFormulaVars();
                const parts: string[] = [];
                for (const [stat, expr] of compiled.addStats) {
                    try {
                        const isMax = stat.endsWith('_max');
                        const baseKey = isMax ? stat.slice(0, -'_max'.length) : stat;
                        baseVars[stat] = isMax ? this.player.getMaxStat(baseKey) : this.player.getStat(baseKey);
                        const raw = expr.evaluate(baseVars);
                        if (typeof raw === 'number' && Number.isFinite(raw)) {
                            const v = Math.floor(raw);
                            const sign = v >= 0 ? '+' : '';
                            parts.push(`${stat}${sign}${v}`);
                        }
                    } catch {
                        parts.push(`${stat}=?`);
                    }
                }
                return parts.length ? `常時 (${parts.join(', ')})` : '常時';
            }
            default: return 'パッシブ';
        }
    }

    private getPassiveDisabledReason(trigger: string): string {
        switch (trigger) {
            case 'on_attack': return '攻撃時に自動発動';
            case 'on_turn': return 'ターン経過で自動発動';
            case 'on_damage': return '被ダメージで自動発動';
            case 'passive': return '常時発動';
            default: return 'パッシブスキル';
        }
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

    /** ミニマップ表示更新（モードコントローラから呼ばれる）。 */
    renderMinimap(): void {
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

        const invalidPos: [number, number] = [-1, -1];
        this.mode.enterAttackDirectionMode(
            hasCenterEnemy ? centerCell : invalidPos,
            hasRightEnemy ? rightCell : invalidPos,
            hasLeftEnemy ? leftCell : invalidPos,
            (x, y) => this.executeAction(() => this.dungeon.attackEnemyAt(x, y)),
        );
    }

    /**
     * target: front スキルの方向選択モードに移行する。
     * 左/中央/右/キャンセル の 4 ボタンを表示し、選択でスキル発動、
     * キャンセルでコスト未消費でデフォルトモードに復帰する。
     */
    private enterSkillTargetSelectMode(skillName: string): void {
        const candidates = getFrontCandidates(this.dungeon);
        this.mode.enterSkillTargetSelectMode(candidates, (cell) => {
            this.executeAction(() => this.dungeon.useSkill(skillName, cell));
        });
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
                onClick: () => this.mode.enterDefaultMode(),
            },
        ];

        this.mode.setSceneActions(actions);
        this.mode.setModeLabel('調査方向選択中');
    }

    private executeSearch(directionLabel: string, targetX: integer, targetY: integer): void {
        const turnCount = this.dungeon.getTurnCount();
        EventBus.emit('message-log', `${directionLabel}を調べた。`, turnCount);

        const objects = this.dungeon.getObject(targetX, targetY);
        const treasure = objects.find(o => o instanceof TreasureObject) as TreasureObject | undefined;
        if (treasure) {
            this.openTreasure(treasure, targetX, targetY);
            this.render();
            this.mode.enterDefaultMode();
            return;
        }

        this.dungeon.searchAt(targetX, targetY);
        this.render();
        this.mode.enterDefaultMode();
    }

    /**
     * 宝箱を開封する。
     * 1. メッセージログを出力
     * 2. trapRate でトラップ発動判定し、trapPool 非空ならランダム1つ選んで applyTrapEffects
     * 3. TreasureObject を削除し、抽選アイテムを ItemObject として同セルに配置
     * 4. dispatchObjectEvent でターン進行
     */
    private openTreasure(treasure: TreasureObject, x: integer, y: integer): void {
        const turn = this.dungeon.getTurnCount();
        EventBus.emit('message-log', `宝箱を開けた！`, turn);

        if (Math.random() < treasure.trapRate && treasure.trapPool.length > 0) {
            const trapName = treasure.trapPool[Phaser.Math.Between(0, treasure.trapPool.length - 1)];
            const trapDef = TrapsLoader.getInstance().getTrap(trapName);
            if (trapDef) {
                this.applyTrapEffects(trapDef);
            }
        }

        this.dungeon.removeMapObject(treasure);
        const itemObj = new ItemObject(treasure.item);
        itemObj.x = x;
        itemObj.y = y;
        this.dungeon.placeObject(itemObj);
        EventBus.emit('message-log', `${treasure.item.getLabelWithModifiers()}が出てきた`, turn);

        this.dungeon.dispatchObjectEvent();
    }

    private enterStairMode(dungeon: DungeonMap): void {
        const goalFloor = BaseLoader.getInstance().getGoalFloor();
        if (this.floor >= goalFloor) {
            EventBus.emit('message-log', `${this.floor}階の階段を登り切った！クリア！`, dungeon.getTurnCount());
            EventBus.emit('game-clear');
            return;
        }
        EventBus.emit('message-log', `${this.floor + 1}階への階段だ`, dungeon.getTurnCount());
        this.mode.enterStairConfirmMode(() => {
            this.floor++;
            EventBus.emit('message-log', `${this.floor}階に移動した`, dungeon.getTurnCount());
            EventBus.emit('go-to-next-floor', dungeon);
        });
    }

    private enterTrapConfirmMode(trapDef: TrapDefinition, trapObject: MapObject): void {
        const turn = this.dungeon.getTurnCount();
        EventBus.emit('message-log', `トラップ：${trapDef.label}`, turn);
        EventBus.emit('message-log', `説明：${trapDef.description}`, turn);
        EventBus.emit('message-log', `このトラップを起動しますか？`, turn);
        this.mode.enterTrapConfirmMode(() => {
            trapObject.visible = true;
            this.executeAction(() => {
                this.applyTrapEffects(trapDef);
                this.dungeon.dispatchObjectEvent();
                return true;
            });
        });
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
        this.mode.setSceneActions([]);
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
