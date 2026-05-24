import { EventBus } from '../../EventBus';
import type { Game } from '../Game';

export type SceneAction = { label: string, onClick: () => void, disabled?: boolean };

/**
 * モーダルモード状態機械。
 *
 * デフォルト（地上）モードと、攻撃方向選択 / スキル方向選択 / 階段確認 /
 * トラップ確認 / 長居警告 / ミニマップズーム移動 などの一時モーダルモード
 * を切り替える。各 enter 系メソッドは画面下のシーンアクションボタン列
 * （EventBus 'scene-actions'）とモードラベル（EventBus 'set-mode-label'）
 * の発火を一手に引き受ける。
 *
 * 「モーダル中」判定（{@link isModalMode}）は `currentSceneActions !== defaultSceneActions`
 * で行う。Game 側のキー入力ハンドラはこの判定で操作をブロックする。
 */
export class SceneModeController {
    private defaultSceneActions: SceneAction[] = [];
    private currentSceneActions: SceneAction[] = [];
    private minimapMoveEnteredFromFullMap = false;

    constructor(private game: Game) {}

    get isModalMode(): boolean {
        return this.currentSceneActions !== this.defaultSceneActions;
    }

    /** 現在のアクション一覧（数字キーショートカット用） */
    get current(): SceneAction[] {
        return this.currentSceneActions;
    }

    /** デフォルトのシーンアクション一覧を登録し、デフォルトモードに遷移する。 */
    initDefaultActions(actions: SceneAction[]): void {
        this.defaultSceneActions = actions;
        this.enterDefaultMode();
    }

    /** デフォルト（地上）モードへ復帰する。モードラベルもクリアする。 */
    enterDefaultMode(): void {
        this.setSceneActions(this.defaultSceneActions);
        this.setModeLabel('');
    }

    setSceneActions(actions: SceneAction[]): void {
        this.currentSceneActions = actions;
        EventBus.emit('scene-actions', actions);
    }

    setModeLabel(label: string): void {
        EventBus.emit('set-mode-label', label);
    }

    /**
     * 攻撃方向選択モード。3 セル（左/中央/右）から選択で onExecute(x, y) を呼ぶ。
     * cell[0] < 0 のセルは「無効」とみなしボタンを disabled にする。
     */
    enterAttackDirectionMode(
        centerCell: [integer, integer],
        rightCell: [integer, integer],
        leftCell: [integer, integer],
        onExecute: (x: integer, y: integer) => void,
    ): void {
        const actions: SceneAction[] = [
            {
                label: '左',
                disabled: leftCell[0] < 0,
                onClick: () => {
                    this.enterDefaultMode();
                    onExecute(leftCell[0], leftCell[1]);
                },
            },
            {
                label: '中央',
                disabled: centerCell[0] < 0,
                onClick: () => {
                    this.enterDefaultMode();
                    onExecute(centerCell[0], centerCell[1]);
                },
            },
            {
                label: '右',
                disabled: rightCell[0] < 0,
                onClick: () => {
                    this.enterDefaultMode();
                    onExecute(rightCell[0], rightCell[1]);
                },
            },
            {
                label: 'キャンセル',
                onClick: () => this.enterDefaultMode(),
            },
        ];
        this.setSceneActions(actions);
        this.setModeLabel('攻撃方向選択中');
    }

    /**
     * target: front スキル用の方向選択モード。候補は呼び出し側で
     * getFrontCandidates(dungeon) 等から組み立てて渡す。
     */
    enterSkillTargetSelectMode(
        candidates: Array<{ valid: boolean; cell: { x: integer; y: integer } }>,
        onExecute: (cell: { x: integer; y: integer }) => void,
    ): void {
        const actions: SceneAction[] = [
            {
                label: '左',
                disabled: !candidates[0].valid,
                onClick: () => {
                    this.enterDefaultMode();
                    onExecute(candidates[0].cell);
                },
            },
            {
                label: '中央',
                disabled: !candidates[1].valid,
                onClick: () => {
                    this.enterDefaultMode();
                    onExecute(candidates[1].cell);
                },
            },
            {
                label: '右',
                disabled: !candidates[2].valid,
                onClick: () => {
                    this.enterDefaultMode();
                    onExecute(candidates[2].cell);
                },
            },
            {
                label: 'キャンセル',
                onClick: () => this.enterDefaultMode(),
            },
        ];
        this.setSceneActions(actions);
        this.setModeLabel('スキル方向選択中');
    }

    /**
     * 階段確認モード。「進む」/「やめる」の 2 ボタン。
     * 「進む」で onAdvance() を呼ぶ。ゴール到達判定や案内メッセージは呼び出し側で。
     */
    enterStairConfirmMode(onAdvance: () => void): void {
        const actions: SceneAction[] = [
            {
                label: '進む',
                onClick: () => {
                    this.enterDefaultMode();
                    onAdvance();
                },
            },
            {
                label: 'やめる',
                onClick: () => this.enterDefaultMode(),
            },
        ];
        this.setSceneActions(actions);
    }

    /**
     * トラップ確認モード。「起動」で onActivate()、「やめる」で何もせず復帰。
     * トラップ説明のメッセージ出力は呼び出し側で行う。
     */
    enterTrapConfirmMode(onActivate: () => void): void {
        const actions: SceneAction[] = [
            {
                label: '起動',
                onClick: () => {
                    this.enterDefaultMode();
                    onActivate();
                },
            },
            {
                label: 'やめる',
                onClick: () => this.enterDefaultMode(),
            },
        ];
        this.setSceneActions(actions);
    }

    /** 長居警告モード。「確認」のみのモーダル。 */
    enterLongStayWarningMode(): void {
        const actions: SceneAction[] = [
            {
                label: '確認',
                onClick: () => this.enterDefaultMode(),
            },
        ];
        this.setSceneActions(actions);
    }

    toggleMiniMapMode(): void {
        const isFullMap = this.game.miniMapView.toggleMapMode();
        localStorage.setItem('frame_dungeon_minimap_full', String(isFullMap));
        this.game.renderMinimap();
    }

    enterMinimapMoveMode(initialOffsetX = 0, initialOffsetY = 0, fromFullMap = false): void {
        this.minimapMoveEnteredFromFullMap = fromFullMap;
        this.game.miniMapView.enterMoveMode(initialOffsetX, initialOffsetY);
        this.setSceneActions([{
            label: 'キャンセル',
            onClick: () => this.exitMinimapMoveMode(),
        }]);
        this.setModeLabel('ミニマップズーム移動中');
    }

    exitMinimapMoveMode(): void {
        this.game.miniMapView.exitMoveMode();
        if (this.minimapMoveEnteredFromFullMap) {
            this.minimapMoveEnteredFromFullMap = false;
            this.game.miniMapView.toggleMapMode();
            localStorage.setItem('frame_dungeon_minimap_full', 'true');
        }
        this.enterDefaultMode();
        this.game.renderMinimap();
    }
}
