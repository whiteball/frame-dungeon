import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap } from '../../lib/MapGenerator';
import { MapObject } from '../../lib/MapObject';
import { MainView } from '../../lib/MainView';
import { MiniMapView } from '../../lib/MiniMapView';
import { InfoView } from '../../lib/InfoView';
import { EquipmentView } from '../../lib/EquipmentView';
import { Player, type PlayerCreationChoices } from '../../lib/Player';
import { GameDataLoader } from '../../lib/GameDataLoader';
import { StatsLoader } from '../../lib/StatsLoader';
import { SkillsLoader } from '../../lib/SkillsLoader';
import { ItemsLoader } from '../../lib/ItemsLoader';
import type { CharacterPreset, SkillGroup } from '../../lib/BaseLoader';
import type { TrapDefinition } from '../../lib/TrapsLoader';
import { getFrontCandidates } from '../../lib/skills/TargetResolver';
import { MapDirection, getDirectionOffset, rotateDirection } from '../../lib/map/MapDirection';
import { executePlayerForce } from '../../lib/map/ForcedActionExecutor';
import type { ActionCategory } from '../../lib/effects/StatusActionResolver';
import { setupDebugCommands } from './game/GameDebugCommands';
import { populateFloor } from './game/FloorPopulator';
import { SceneModeController } from './game/SceneModeController';
import { buildDisplayParams, buildStatusText, buildResultText } from './game/StatusReportBuilder';
import { ItemListController } from './game/ItemListController';
import { MapInteractionHandler } from './game/MapInteractionHandler';
import { SaveLoadController } from './game/SaveLoadController';
import { BaseLoader } from '../../lib/BaseLoader';
import { YamlCrossValidator } from '../../lib/YamlCrossValidator';
import type { SaveData } from '../../lib/SaveManager';
import type { DungeonRestoreCallbacks } from '../../lib/MapGenerator';

/** 禁止系（not_*）で行動を弾いたときの既定メッセージ（effects.yml で引数指定があればそちら優先）。 */
const DEFAULT_FORBID_MESSAGE: Record<ActionCategory, string> = {
    move: '動けない！',
    attack: '攻撃できない！',
    skill: 'スキルが使えない！',
    item: 'アイテムが使えない！',
    equip: '装備を変えられない！',
    investigate: '調べられない！',
};

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

    mode = new SceneModeController(this);
    private list = new ItemListController(this);
    private interaction = new MapInteractionHandler(this);
    private saveLoad = new SaveLoadController(this);
    private viewRange = 3;
    private enableFog = true;
    private revealAll = false;
    private swapQEandAD = false;
    private swapSandShiftS = false;
    private debugCommands = false;
    private closeListAfterAction = false;
    private pendingSaveData: SaveData | null = null;

    constructor() {
        super('Game');
    }

    init(data: { viewRange?: number; enableFog?: boolean; showAllEnemies?: boolean; swapQEandAD?: boolean; swapSandShiftS?: boolean; debugCommands?: boolean; closeListAfterAction?: boolean; saveData?: SaveData }) {
        this.viewRange = data.viewRange ?? 3;
        this.enableFog = data.enableFog ?? true;
        this.revealAll = data.showAllEnemies ?? false;
        this.swapQEandAD = data.swapQEandAD ?? false;
        this.swapSandShiftS = data.swapSandShiftS ?? false;
        this.debugCommands = data.debugCommands ?? false;
        this.closeListAfterAction = data.closeListAfterAction ?? false;
        this.pendingSaveData = data.saveData ?? null;
    }

    /** 設定「アイテム/スキルリストを毎回閉じる」が有効か（ItemListController から参照）。 */
    getCloseListAfterAction(): boolean {
        return this.closeListAfterAction;
    }

    /**
     * キャラメイク（プリセット選択）ダイアログを開き、選択結果を待つ。
     * Vue 側へ表示用に整形したプリセット一覧を送り、`character-creation-confirmed`(index)
     * または `character-creation-cancelled` の発火で解決する（リスナは解決時に自己掃除）。
     * @returns 選択プリセットから組み立てた {@link PlayerCreationChoices}、キャンセル時は null
     */
    private runCharacterCreation(): Promise<PlayerCreationChoices | null> {
        const base = BaseLoader.getInstance();
        const presets = base.getCharacterPresets();
        const skillGroups = base.getSkillGroups();
        const prompt = base.getCharacterCreationPrompt() ?? 'キャラクターを選択してください';

        return new Promise((resolve) => {
            const cleanup = () => {
                EventBus.removeListener('character-creation-confirmed', onConfirm);
                EventBus.removeListener('character-creation-cancelled', onCancel);
            };
            // payload: プリセット index（プリセット無しのデータでは null）と、
            // 全スキルグループで選んだスキル名（フラット化済み）。
            const onConfirm = (payload: { presetIndex: number | null; skills: string[] }) => {
                cleanup();
                const preset = payload.presetIndex !== null ? presets[payload.presetIndex] : undefined;
                // プリセットが定義されているのに不正 index が来たら中止扱い
                if (presets.length > 0 && !preset) { resolve(null); return; }
                const addSkills = [...(preset?.skills ?? []), ...payload.skills];
                resolve({
                    statOverrides: preset ? { ...preset.stats } : undefined,
                    addSkills,
                    addItems: preset ? preset.items.map(i => ({ ...i })) : undefined,
                });
            };
            const onCancel = () => {
                cleanup();
                resolve(null);
            };
            EventBus.on('character-creation-confirmed', onConfirm);
            EventBus.on('character-creation-cancelled', onCancel);
            EventBus.emit('open-character-creation', {
                prompt,
                presets: presets.map(p => this.buildPresetDisplay(p)),
                skillGroups: skillGroups.map(g => this.buildSkillGroupDisplay(g)),
            });
        });
    }

    /**
     * スキルグループを Vue ダイアログ表示用に整形する（loader 参照は scene 側に閉じる）。
     * 各選択肢はスキルの name（emit 用）・label・description（skills.yml）を保持する。
     */
    private buildSkillGroupDisplay(group: SkillGroup): {
        label: string;
        description: string;
        pick: number;
        options: { name: string; label: string; description: string }[];
    } {
        const skillsLoader = SkillsLoader.getInstance();
        const options = group.options.map(name => {
            const def = skillsLoader.getSkill(name);
            return {
                name,
                label: def?.label ?? name,
                description: def?.description ?? '',
            };
        });
        return { label: group.label, description: group.description, pick: group.pick, options };
    }

    /**
     * プリセットを Vue ダイアログ表示用に整形する（loader 参照は scene 側に閉じる既存方針）。
     * stat はキー単位の上書き値、skill/item はラベルで表示する。
     */
    private buildPresetDisplay(preset: CharacterPreset): {
        label: string;
        description: string;
        statLines: { label: string; value: number }[];
        skillLabels: string[];
        itemLabels: string[];
    } {
        const statsLoader = StatsLoader.getInstance();
        const skillsLoader = SkillsLoader.getInstance();
        const itemsLoader = ItemsLoader.getInstance();
        const statLines = Object.entries(preset.stats).map(([name, value]) => ({
            label: statsLoader.getAbbreviation(name) || name,
            value,
        }));
        const skillLabels = preset.skills.map(name => skillsLoader.getSkill(name)?.label ?? name);
        const itemLabels = preset.items.map(({ name, count }) => {
            const label = itemsLoader.getItem(name)?.label ?? name;
            return count > 1 ? `${label} ×${count}` : label;
        });
        return { label: preset.label, description: preset.description, statLines, skillLabels, itemLabels };
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
        this.infoView.render(BaseLoader.getInstance().formatFloorLabel(this.floor), this.params);
        this.equipmentView.render({
            weapon: this.player.getEquippedWeapon(),
            mainArmor: this.player.getEquippedMainArmor(),
            subArmor1: this.player.getEquippedSubArmor1(),
            subArmor2: this.player.getEquippedSubArmor2(),
        });
    }

    async create() {
        // シーン再開（リスタート）に備えて、このシーンが扱うイベントの旧リスナを一掃する
        // 古いシーンインスタンスのハンドラが残ると、scene.manager が null の dead scene で
        // scene.start が呼ばれて queueOp が失敗する
        EventBus.removeAllListeners('go-to-next-floor');
        EventBus.removeAllListeners('update-view');
        EventBus.removeAllListeners('game-over');
        EventBus.removeAllListeners('game-clear');
        EventBus.removeAllListeners('long-stay-warning');
        this.list.register();
        this.saveLoad.register();

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

        // Player初期化前に YAML 群を読み込む
        await GameDataLoader.loadAll();

        const { errors, infos } = YamlCrossValidator.validate();
        for (const info of infos) console.info(`[YAML INFO] ${info}`);
        if (errors.length > 0) {
            EventBus.emit('yaml-cross-validation-errors', errors);
            this.scene.start('MainMenu');
            return;
        }

        // 新規ゲーム（ロードでない）かつキャラメイク定義があればプリセット選択を挟む。
        // ロード時は deserialize が全上書きするためスキップ（後方互換）。
        let creationChoices: PlayerCreationChoices | undefined;
        const base = BaseLoader.getInstance();
        if (!this.pendingSaveData && base.hasCharacterCreation()) {
            const choice = await this.runCharacterCreation();
            if (choice === null) {
                // キャンセル: ゲーム開始を中止してタイトルへ戻る
                this.scene.start('MainMenu');
                return;
            }
            creationChoices = choice;
        }

        this.player = new Player(creationChoices);
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
            if (this.handlePlayerActionDirective('move')) return;
            this.executeAction(() => this.dungeon.goPlayer() > 0);
        })
        this.keys.keySpace?.on('down', (event: KeyboardEvent) => {
            if (this.mode.isModalMode) return;
            if (this.handlePlayerActionDirective('attack')) return;
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
                if (this.handlePlayerActionDirective('move')) return;
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
                if (this.handlePlayerActionDirective('move')) return;
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
                if (this.handlePlayerActionDirective('move')) return;
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
                if (this.handlePlayerActionDirective('move')) return;
                this.executeAction(() => this.dungeon.goRightPlayer() > 0);
            }
        })
        this.keys.keyQ?.on('down', () => {
            if (this.mode.isModalMode) return;
            if (this.swapQEandAD) {
                this.executeAction(() => this.dungeon.turnLeftPlayer());
            } else {
                if (this.handlePlayerActionDirective('move')) return;
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
            if (this.handlePlayerActionDirective('investigate')) return;
            this.interaction.trySearch();
        })

        this.keys.keyEsc?.on('down', () => {
            if (this.miniMapView.isMoveMode()) {
                this.mode.exitMinimapMoveMode();
            } else if (this.mode.isModalMode && this.mode.current.length > 0) {
                // 攻撃/投擲/スキル方向選択・階段/トラップ確認・イベント選択・長居警告などの
                // モーダルを Escape でキャンセルする。各モーダルのキャンセル動作は実装上すべて
                // enterDefaultMode() のみ（onExecute/onSelect 不呼び出し＝副作用なし）。
                // current.length === 0 のセーブダイアログ（キー入力もブロック中）は対象外。
                this.mode.enterDefaultMode();
            }
        })

        this.dungeon = dun;
        this.dungeon.setPlayerInstance(this.player);

        EventBus.on('update-view', () => {
            this.render();
        })

        EventBus.on('game-over', () => {
            this.list.closeList();
            this.scene.start('GameOver', { resultText: this.composeResultText() });
        })

        EventBus.on('game-clear', () => {
            this.list.closeList();
            this.scene.start('GameClear', { resultText: this.composeResultText() });
        })

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
            { label: 'スキル', onClick: () => this.list.toggleList('skill') },
            { label: 'アイテム', onClick: () => this.list.toggleList('inventory') },
            { label: 'ステータス', onClick: () => this.openStatus() },
            { label: '足下', onClick: () => this.list.onUnderfoot() },
            { label: 'セーブ', onClick: () => this.saveLoad.openSaveDialog() },
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

    /** ミニマップ表示更新（モードコントローラから呼ばれる）。 */
    renderMinimap(): void {
        this.miniMapView.render(this.dungeon, this.revealAll);
    }

    /**
     * Space 押下時の処理。前方斜めに敵がいれば3択ボタンを提示し、
     * 正面のみに敵がいれば即時攻撃、敵が一体もいなければ正面を調査する
     * （C キー→中央選択と同等。手軽な調査・1 ターンスキップ手段）。
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
        const hasCenterEnemy = !!this.dungeon.getEnemy(centerCell[0], centerCell[1]) && this.dungeon.canAttack(x, y, centerCell[0], centerCell[1]);

        if (!hasRightEnemy && !hasLeftEnemy) {
            if (hasCenterEnemy) {
                this.executeAction(() => this.dungeon.attackPlayer());
            } else {
                // 正面に攻撃対象がいなければ調査（C キー→中央選択と同等。1 ターン消費）
                this.interaction.searchFront();
            }
            return;
        }

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
     *
     * ItemListController から use-skill ハンドラ経由で呼ばれるため public。
     */
    enterSkillTargetSelectMode(skillName: string): void {
        const candidates = getFrontCandidates(this.dungeon);
        this.mode.enterSkillTargetSelectMode(candidates, (cell) => {
            this.executeAction(() => this.dungeon.useSkill(skillName, cell));
        });
    }

    /**
     * アイテム（巻物）からの target='front' スキル発動用の方向選択モードに移行する。
     * 確定時のみ useConsumableItem(instanceId, { skillTargetCell }) を呼び、
     * アイテム消費とスキル発動を一括で行う。キャンセル時は何も起こらない（アイテム非消費）。
     *
     * ItemListController から use-item ハンドラ経由で呼ばれるため public。
     */
    enterSkillFromItemTargetSelectMode(instanceId: string): void {
        const candidates = getFrontCandidates(this.dungeon);
        this.mode.enterSkillTargetSelectMode(candidates, (cell) => {
            this.executeAction(() => this.dungeon.useConsumableItem(instanceId, { skillTargetCell: cell }));
        });
    }

    /**
     * アイテム投擲の方向選択モードに移行する。
     * 攻撃と同じ 左/中央/右 の3セルを候補にし、確定で `throwItem` を実行する。
     * 壁方向でも投擲物は床に落ちるため、全方向を常に選択可能にする。
     *
     * ItemListController から throw-item ハンドラ経由で呼ばれるため public。
     */
    enterThrowTargetSelectMode(instanceId: string): void {
        const { x, y, direction } = this.dungeon.getPlayerPos();
        const [fdx, fdy] = getDirectionOffset(direction);
        const [rdx, rdy] = getDirectionOffset(rotateDirection(direction, 1));
        const centerCell: [integer, integer] = [x + fdx, y + fdy];
        const rightCell: [integer, integer] = [centerCell[0] + rdx, centerCell[1] + rdy];
        const leftCell: [integer, integer] = [centerCell[0] - rdx, centerCell[1] - rdy];
        this.mode.enterThrowDirectionMode(centerCell, rightCell, leftCell, (tx, ty) => {
            this.executeAction(() => this.dungeon.throwItem(instanceId, { x: tx, y: ty }));
        });
    }

    private enterStairMode(dungeon: DungeonMap): void {
        const base = BaseLoader.getInstance();
        const goalFloor = base.getGoalFloor();
        if (this.floor >= goalFloor) {
            EventBus.emit('message-log', base.getClearMessage(this.floor), dungeon.getTurnCount());
            EventBus.emit('game-clear');
            return;
        }
        EventBus.emit('message-log', `${base.formatFloorLabel(this.floor + 1)}への階段だ`, dungeon.getTurnCount());
        this.mode.enterStairConfirmMode(() => {
            this.floor++;
            EventBus.emit('message-log', `${base.formatFloorLabel(this.floor)}に移動した`, dungeon.getTurnCount());
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
                this.interaction.applyTrapEffects(trapDef);
                this.dungeon.dispatchObjectEvent();
                return true;
            });
        });
    }

    /**
     * プレイヤー行動ディレクティブ（onAction の状態異常効果）を処理する。
     * - 強制（force）：意図入力を捨て、強制行動を実行してターン消費（true）
     * - 禁止（forbid）：意図カテゴリが封じられていればメッセージのみ・ターン非消費（true）
     * - それ以外：通常行動を許可（false）。ターン消費されれば tick で actionIndex 前進
     * @param category 実行しようとしている行動カテゴリ
     * @returns 通常アクションを行わせない（強制実行 or 拒否）場合 true
     */
    private handlePlayerActionDirective(category: ActionCategory): boolean {
        if (!this.player) return false;
        const directive = this.player.getPlayerActionDirective();
        if (directive.force) {
            this.player.markStatusEffectsActionEligible();
            const force = directive.force;
            this.executeAction(() => { executePlayerForce(this.dungeon, force); return true; });
            return true;
        }
        if (directive.forbid.has(category)) {
            const msg = directive.forbid.get(category) ?? DEFAULT_FORBID_MESSAGE[category];
            EventBus.emit('message-log', msg, this.dungeon.getTurnCount());
            return true;
        }
        this.player.markStatusEffectsActionEligible();
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

    public buildDungeonRestoreCallbacks(): DungeonRestoreCallbacks {
        return {
            onEnterStair: (dungeon: DungeonMap) => this.enterStairMode(dungeon),
            applyTrapEffects: (def: TrapDefinition) => this.interaction.applyTrapEffects(def),
            enterTrapConfirmMode: (def: TrapDefinition, obj: MapObject) => this.enterTrapConfirmMode(def, obj),
        };
    }

    changeScene() {
        this.scene.start('GameOver');
    }
}
