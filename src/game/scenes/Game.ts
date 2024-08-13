import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap } from '../../lib/MapGenerator';

export class Game extends Scene
{
    camera: Phaser.Cameras.Scene2D.Camera;
    background: Phaser.GameObjects.Image;
    gameText: Phaser.GameObjects.Text;
    keys: {
        keyW: Phaser.Input.Keyboard.Key | undefined,
        keyS: Phaser.Input.Keyboard.Key | undefined,
        keyA: Phaser.Input.Keyboard.Key | undefined,
        keyD: Phaser.Input.Keyboard.Key | undefined,
        keyE: Phaser.Input.Keyboard.Key | undefined,
        keyQ: Phaser.Input.Keyboard.Key | undefined,
    };
    dungeon: DungeonMap;
    graph: Phaser.GameObjects.Graphics;

    constructor ()
    {
        super('Game');
    }

    redrawMiniMap ()
    {
        const dun = this.dungeon;
        const graph = this.graph;

        graph.lineStyle(2, 0xCCCCCC);
        graph.fillStyle(0x0);
        const WIDTH = 200, HEIGHT = 200, OFFSET_X = this.game.canvas.width - 10 - WIDTH , OFFSET_Y = 10;
        const rect = new Phaser.Geom.Rectangle(OFFSET_X, OFFSET_Y, WIDTH, HEIGHT);
        const blockWidth = (WIDTH / dun.getWidth()),blockHeight = (HEIGHT / dun.getHeight());
        graph.fillRectShape(rect);

        graph.fillStyle(0xCCCCCC);
        for (const block of dun.mapIterator()) {
            const baseX = (block.x - 1) * blockWidth + OFFSET_X, baseY = (block.y - 1) * blockHeight + OFFSET_Y
            graph.lineStyle(2, 0xCCCCCC);

            if ( ! block.enter || block.fog === 1) {
                graph.fillRect(baseX, baseY, blockWidth, blockHeight).strokeRect(baseX, baseY, blockWidth, blockHeight)
                continue;
            }

            if (block.wallState.wall[0]) {
                graph.lineBetween(baseX + blockWidth, baseY, baseX + blockWidth, baseY + blockHeight)
            }
            if (block.wallState.wall[1]) {
                graph.lineBetween(baseX, baseY + blockHeight, baseX + blockWidth, baseY + blockHeight)
            }
            if (block.wallState.wall[2]) {
                graph.lineBetween(baseX, baseY, baseX, baseY + blockHeight)
            }
            if (block.wallState.wall[3]) {
                graph.lineBetween(baseX, baseY, baseX + blockWidth, baseY)
            }
            
            graph.lineStyle(2, 0xCC0000);
            if (block.wallState.door[0]) {
                graph.lineBetween(baseX + blockWidth, baseY, baseX + blockWidth, baseY + blockHeight)
                graph.lineBetween(baseX + blockWidth - blockWidth / 6, baseY + blockHeight / 2, baseX + blockWidth, baseY + blockHeight / 2)
            }
            if (block.wallState.door[1]) {
                graph.lineBetween(baseX, baseY + blockHeight, baseX + blockWidth, baseY + blockHeight)
                graph.lineBetween(baseX + blockWidth / 2, baseY + blockHeight - blockHeight / 6, baseX + blockWidth / 2, baseY + blockHeight)
            }
            if (block.wallState.door[2]) {
                graph.lineBetween(baseX, baseY, baseX, baseY + blockHeight)
                graph.lineBetween(baseX, baseY + blockHeight / 2, baseX + blockWidth / 6, baseY + blockHeight / 2)
            }
            if (block.wallState.door[3]) {
                graph.lineBetween(baseX, baseY, baseX + blockWidth, baseY)
                graph.lineBetween(baseX + blockWidth / 2, baseY, baseX + blockWidth / 2, baseY + blockHeight / 6)
            }
        }

        graph.lineStyle(4, 0xFFFFFF);
        graph.strokeRectShape(rect);

        graph.lineStyle(1, 0xFFFFFF);
        graph.fillStyle(0xFFFFFF);
        const playerPos = dun.getPlayerPos();
        const baseX = (playerPos.x - 1) * blockWidth + OFFSET_X + blockWidth / 5, baseY = (playerPos.y - 1) * blockHeight + OFFSET_Y + blockHeight / 5;
        const playerWidth = blockWidth - blockWidth / 5 * 2, playerHeight = blockHeight - blockHeight / 5 * 2;
        let tri : Phaser.Geom.Triangle;
        switch (playerPos.direction) {
            case 0:
                tri = new Phaser.Geom.Triangle(baseX, baseY, baseX, baseY + playerHeight, baseX + playerWidth, baseY + playerHeight / 2);
                break;
            case 1:
                tri = new Phaser.Geom.Triangle(baseX, baseY, baseX + playerWidth, baseY, baseX + playerWidth / 2, baseY + playerHeight);
                break;
            case 2:
                tri = new Phaser.Geom.Triangle(baseX + playerWidth, baseY, baseX + playerWidth, baseY + playerHeight, baseX, baseY + playerHeight / 2);
                break;
            case 3:
            default:
                tri = new Phaser.Geom.Triangle(baseX, baseY + playerHeight, baseX + playerWidth, baseY + playerHeight, baseX + playerWidth / 2, baseY);
                break;
        }
        
        graph.strokeTriangleShape(tri)
        graph.fillTriangleShape(tri)

        this.redrawMainView()

    }

    redrawMainView()
    {
        const dun = this.dungeon;
        const graph = this.graph;

        graph.lineStyle(4, 0xFFFFFF);
        graph.fillStyle(0x0);

        const player = dun.getPlayerPos();
        const blockList: integer[][] = [];
        const RANGE = 4, RANGE_SIDE = 3;

        const rotateRight = (value: integer, shiftAmount: integer) => {
            const wall = value & 0xF, door = value & 0xF0;
            return (((wall >> shiftAmount) | (wall << (4 - shiftAmount))) & 0xF)
                | (((door >> shiftAmount) | (door << (4 - shiftAmount))) & 0xF0);
        }

        switch(player.direction) {
            case 0:
                for (let i = RANGE; i >= 0; i--) {
                    const buf = [rotateRight(dun.getAt(player.x + i, player.y), 1)];
                    for (let j = 1; j <= RANGE_SIDE; j++) {
                        buf.push(rotateRight(dun.getAt(player.x + i, player.y + j), 1));
                        buf.push(rotateRight(dun.getAt(player.x + i, player.y - j), 1));
                    }
                    blockList.push(buf);
                }
                break;
            case 1:
                for (let i = RANGE; i >= 0; i--) {
                    const buf = [rotateRight(dun.getAt(player.x, player.y + i), 2)];
                    for (let j = 1; j <= RANGE_SIDE; j++) {
                        buf.push(rotateRight(dun.getAt(player.x - j, player.y + i), 2));
                        buf.push(rotateRight(dun.getAt(player.x + j, player.y + i), 2));
                    }
                    blockList.push(buf);
                }
                break;
            case 2:
                for (let i = RANGE; i >= 0; i--) {
                    const buf = [rotateRight(dun.getAt(player.x - i, player.y), 3)];
                    for (let j = 1; j <= RANGE_SIDE; j++) {
                        buf.push(rotateRight(dun.getAt(player.x - i, player.y - j), 3));
                        buf.push(rotateRight(dun.getAt(player.x - i, player.y + j), 3));
                    }
                    blockList.push(buf);
                }
                break;
            case 3:
                for (let i = RANGE; i >= 0; i--) {
                    const buf = [dun.getAt(player.x, player.y - i)];
                    for (let j = 1; j <= RANGE_SIDE; j++) {
                        buf.push(dun.getAt(player.x + j, player.y - i));
                        buf.push(dun.getAt(player.x - j, player.y - i));
                    }
                    blockList.push(buf);
                }
                break;
        }


        const BLOCK_BASE_SIZE = 560, SCREEN_WIDTH = 760, SCREEN_HEIGHT = 520, OFFSET_X = 10, OFFSET_Y = 10, CENTER_X = SCREEN_WIDTH / 2 + OFFSET_X, CENTER_Y = SCREEN_HEIGHT / 2 + OFFSET_Y, ANGLE = 60 / 180 * Math.PI, SCREEN_DISTANCE = BLOCK_BASE_SIZE / 2, CAMERA_SCREEN_DISTANCE = SCREEN_WIDTH / 2 / Math.tan(ANGLE / 2), AB = CAMERA_SCREEN_DISTANCE * BLOCK_BASE_SIZE / 2;
        const frame = new Phaser.Geom.Rectangle(OFFSET_X, OFFSET_Y, SCREEN_WIDTH, SCREEN_HEIGHT);
        const frameCutForX = (x1: number, y1: number, x2: number, y2: number, ): number => {
            if (frame.contains(x1, y1)) {
                return x1;
            }

            const slope = (y1 - y2) / (x1 - x2);
            if (x1 - x2 < 0) {
                if (y1 - y2 < 0){
                    // 左上
                    if ((slope * (frame.left - x2) + y2) > frame.top) {
                        return frame.left;
                    } else {
                        return (1 / slope * (frame.top - y2) + x2);
                    }
                } else {
                    // 左下
                    if ((slope * (frame.left - x2) + y2) < frame.bottom) {
                        return frame.left;
                    } else {
                        return (1 / slope * (frame.bottom - y2) + x2);
                    }
                }
            } else {
                if (y1 - y2 < 0){
                    // 右上
                    if ((slope * (frame.right - x2) + y2) > frame.top) {
                        return frame.right;
                    } else {
                        return (1 / slope * (frame.top - y2) + x2);
                    }
                } else {
                    // 右下
                    if ((slope * (frame.right - x2) + y2) < frame.bottom) {
                        return frame.right;
                    } else {
                        return (1 / slope * (frame.bottom - y2) + x2);
                    }
                }
            }
        }
        const frameCutForY = (x1: number, y1: number, x2: number, y2: number, ): number => {
            if (frame.contains(x1, y1)) {
                return y1;
            }

            const slope = (y1 - y2) / (x1 - x2);
            if (x1 - x2 < 0) {
                if (y1 - y2 < 0){
                    // 左上
                    if ((slope * (frame.left - x2) + y2) > frame.top) {
                        return (slope * (frame.left - x2) + y2);
                    } else {
                        return frame.top;
                    }
                } else {
                    // 左下
                    if ((slope * (frame.left - x2) + y2) < frame.bottom) {
                        return (slope * (frame.left - x2) + y2);
                    } else {
                        return frame.bottom;
                    }
                }
            } else {
                if (y1 - y2 < 0){
                    // 右上
                    if ((slope * (frame.right - x2) + y2) > frame.top) {
                        return (slope * (frame.right - x2) + y2);
                    } else {
                        return frame.top;
                    }
                } else {
                    // 右下
                    if ((slope * (frame.right - x2) + y2) < frame.bottom) {
                        return (slope * (frame.right - x2) + y2);
                    } else {
                        return frame.bottom;
                    }
                }
            }
        }
        const preparePoints = (upOutsideX: number, upOutsideY: number, upInsideX: number, upInsideY: number, downInsideX: number, downInsideY: number, downOutsideX: number, downOutsideY: number): number[] => {
            if ( ! frame.contains(upInsideX, upInsideY)){
                return [];
            }
            const upOutsideYCalc = frameCutForY(upOutsideX, upOutsideY, upInsideX, upInsideY);
            if (upOutsideYCalc === frame.top) {
                return [
                    upOutsideX < upInsideX ? frame.left : frame.right,
                    frame.top,
                    frameCutForX(upOutsideX, upOutsideY, upInsideX, upInsideY),
                    upOutsideYCalc,
                    upInsideX, upInsideY,
                    downInsideX, downInsideY,
                    frameCutForX(downOutsideX, downOutsideY, downInsideX, downInsideY),
                    frameCutForY(downOutsideX, downOutsideY, downInsideX, downInsideY),
                    downOutsideX < downInsideX ? frame.left : frame.right,
                    frame.bottom,
                ]
            } else {
                return [
                    frameCutForX(upOutsideX, upOutsideY, upInsideX, upInsideY),
                    upOutsideYCalc,
                    upInsideX, upInsideY,
                    downInsideX, downInsideY,
                    frameCutForX(downOutsideX, downOutsideY, downInsideX, downInsideY),
                    frameCutForY(downOutsideX, downOutsideY, downInsideX, downInsideY),
                ]
            }
        }

        // 背景ベース
        graph.lineStyle(4, 0xFFFFFF);
        graph.strokeRectShape(frame);
        graph.fillStyle(0x0);
        graph.fillRectShape(frame);
        // 背景天井
        graph.fillStyle(0xCCCCCC);
        graph.fillRect(frame.left, frame.top, frame.width, frame.height / 2 - AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE));
        // 背景床
        graph.fillStyle(0x3F3F3F);
        graph.fillRect(frame.left, frame.top + frame.height / 2 + AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE), frame.width, frame.height / 2 - AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE));
        // ブロックベース
        graph.lineStyle(1, 0x0);
        graph.fillStyle(0xFFFFFF);
        for (let i = 0; i < blockList.length; i++) {
            // デバッグ用描画距離によって枠線を色分け
            // graph.lineStyle(2, [0x0000FF,0x00FFFF,0x00FF00,0xFFFF00,0xFF0000,0xFF00FF][i%6]);
            const targetDistance = (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * (RANGE - i)),
                targetDistanceNear = (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * (RANGE - i - 1));
            const far = AB / targetDistance,
                near = AB / targetDistanceNear;
            for (let j = RANGE_SIDE; j >= 1; j--) {
                const order = 2 * j - 1;
                const farInside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j - 1 + 0.5)) / targetDistance,
                    nearInside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j - 1 + 0.5)) / targetDistanceNear,
                    farOutside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j + 0.5)) / targetDistance,
                    nearOutside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j + 0.5)) / targetDistanceNear;
                // 右側
                if (blockList[i][order] & 8) {
                    const pointList: number[] = preparePoints(CENTER_X + farOutside, CENTER_Y - far, CENTER_X + farInside, CENTER_Y - far, CENTER_X + farInside, CENTER_Y + far, CENTER_X + farOutside, CENTER_Y + far)
                    if (pointList.length > 0) {
                        const pol = new Phaser.Geom.Polygon(pointList);
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order] & (8 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
                if (blockList[i][order] & 1) {
                    const pointList: number[] = preparePoints(CENTER_X + nearOutside, CENTER_Y - near, CENTER_X + farOutside, CENTER_Y - far, CENTER_X + farOutside, CENTER_Y + far, CENTER_X + nearOutside, CENTER_Y + near)
                    if (pointList.length > 0) {
                        const pol = new Phaser.Geom.Polygon(pointList);
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order] & (1 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
                if (blockList[i][order] & 2) {
                    const pointList: number[] = preparePoints(CENTER_X + nearOutside, CENTER_Y - near, CENTER_X + nearInside, CENTER_Y - near, CENTER_X + nearInside, CENTER_Y + near, CENTER_X + nearOutside, CENTER_Y + near)
                    if (pointList.length > 0) {
                        const pol = new Phaser.Geom.Polygon(pointList);
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order] & (2 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }

                // 左側
                if (blockList[i][order + 1] & 8) {
                    const pointList: number[] = preparePoints(CENTER_X - farOutside, CENTER_Y - far, CENTER_X - farInside, CENTER_Y - far, CENTER_X - farInside, CENTER_Y + far, CENTER_X - farOutside, CENTER_Y + far)
                    if (pointList.length > 0) {
                        const pol = new Phaser.Geom.Polygon(pointList);
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order + 1] & (8 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
                if (blockList[i][order + 1] & 4) {
                    const pointList: number[] = preparePoints(CENTER_X - nearOutside, CENTER_Y - near, CENTER_X - farOutside, CENTER_Y - far, CENTER_X - farOutside, CENTER_Y + far, CENTER_X - nearOutside, CENTER_Y + near)
                    if (pointList.length > 0) {
                        const pol = new Phaser.Geom.Polygon(pointList);
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order + 1] & (4 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
                if (blockList[i][order + 1] & 2) {
                    const pointList: number[] = preparePoints(CENTER_X - nearOutside, CENTER_Y - near, CENTER_X - nearInside, CENTER_Y - near, CENTER_X - nearInside, CENTER_Y + near, CENTER_X - nearOutside, CENTER_Y + near)
                    if (pointList.length > 0) {
                        const pol = new Phaser.Geom.Polygon(pointList);
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order + 1] & (2 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
            }
            

            // 真ん中
            if (blockList[i][0] & 1) {
                const pointList: number[] = preparePoints(CENTER_X + near, CENTER_Y - near, CENTER_X + far, CENTER_Y - far, CENTER_X + far, CENTER_Y + far, CENTER_X + near, CENTER_Y + near);
                if (pointList.length > 0) {
                    const pol = new Phaser.Geom.Polygon(pointList);
                    graph.strokePoints(pol.points, true)
                    if (blockList[i][0] & (1 << 4)) {
                        graph.fillStyle(0xFFFFFF, 0.5);
                    } else {
                        graph.fillStyle(0xFFFFFF);
                    }
                    graph.fillPoints(pol.points, true)
                }
            }
            if (blockList[i][0] & 4) {
                const pointList: number[] = preparePoints(CENTER_X - near, CENTER_Y - near, CENTER_X - far, CENTER_Y - far, CENTER_X - far, CENTER_Y + far, CENTER_X - near, CENTER_Y + near);
                if (pointList.length > 0) {
                    const pol = new Phaser.Geom.Polygon(pointList);
                    graph.strokePoints(pol.points, true)
                    if (blockList[i][0] & (4 << 4)) {
                        graph.fillStyle(0xFFFFFF, 0.5);
                    } else {
                        graph.fillStyle(0xFFFFFF);
                    }
                    graph.fillPoints(pol.points, true)
                }
            }
            if (blockList[i][0] & 8) {
                const pointList: number[] = [CENTER_X + far, CENTER_Y + far, CENTER_X + far, CENTER_Y - far, CENTER_X - far, CENTER_Y - far, CENTER_X - far, CENTER_Y + far, ];
                if (pointList.length > 0) {
                    const pol = new Phaser.Geom.Polygon(pointList);
                    graph.strokePoints(pol.points, true)
                    if (blockList[i][0] & (8 << 4)) {
                        graph.fillStyle(0xFFFFFF, 0.5);
                    } else {
                        graph.fillStyle(0xFFFFFF);
                    }
                    graph.fillPoints(pol.points, true)
                }
            }
        }
    }

    create ()
    {
        const dun = new DungeonMap(15, 15);
        dun.build();
        dun.dump();

        const graph = this.add.graphics({
            lineStyle: { width: 2, color: 0xCCCCCC, alpha: 1 },
            fillStyle: { color: 0x0, alpha: 1 }
        });
        this.graph = graph;

        // this.camera = this.cameras.main;
        // this.camera.setBackgroundColor(0x00ff00);

        // this.background = this.add.image(512, 384, 'background');
        // this.background.setAlpha(0.5);

        // this.gameText = this.add.text(512, 384, 'Make something fun!\nand share it with us:\nsupport@phaser.io', {
        //     fontFamily: 'Arial Black', fontSize: 38, color: '#ffffff',
        //     stroke: '#000000', strokeThickness: 8,
        //     align: 'center'
        // }).setOrigin(0.5).setDepth(100);

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
                this.redrawMiniMap()
            }
        })
        this.keys.keyA?.on('down', () => {
            if (this.dungeon.turnLeftPlayer()) {
                this.redrawMiniMap()
            }
        })
        this.keys.keyS?.on('down', () => {
            if (this.dungeon.turnBackPlayer()) {
                this.redrawMiniMap()
            }
        })
        this.keys.keyD?.on('down', () => {
            if (this.dungeon.turnRightPlayer()) {
                this.redrawMiniMap()
            }
        })
        // this.keys.keyE?.on('down', () => {
        //     if (this.dungeon.turnRightPlayer()) {
        //         this.redrawMiniMap()
        //     }
        // })
        // this.keys.keyQ?.on('down', () => {
        //     if (this.dungeon.turnLeftPlayer()) {
        //         this.redrawMiniMap()
        //     }
        // })


        EventBus.emit('current-scene-ready', this);

        this.dungeon = dun;

        this.redrawMiniMap()
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

    changeScene ()
    {
        this.scene.start('GameOver');
    }
}
