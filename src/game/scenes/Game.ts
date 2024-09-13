import { EventBus } from '../EventBus';
import { Scene } from 'phaser';
import { DungeonMap, MapDirection, MapObject } from '../../lib/MapGenerator';

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
    floor: integer = 1;

    polygonList: (Phaser.Geom.Polygon | null)[][][];
    mainViewFrame: (Phaser.Geom.Rectangle | null);
    mainViewCeil: (Phaser.Geom.Rectangle | null);
    mainViewFloor: (Phaser.Geom.Rectangle | null);
    mainViewRange:integer = 4;
    mainViewRangeSide: integer = 3;

    constructor ()
    {
        super('Game');
    }

    redrawAll ()
    {
        this.redrawMiniMap();
        this.redrawMainView();
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

        // マス描画
        graph.fillStyle(0xCCCCCC);
        for (const block of dun.mapIterator()) {
            const baseX = (block.x - 1) * blockWidth + OFFSET_X, baseY = (block.y - 1) * blockHeight + OFFSET_Y
            graph.lineStyle(2, 0xCCCCCC);

            if ( ! block.enter || block.fog === 1) {
                graph.fillRect(baseX, baseY, blockWidth, blockHeight).strokeRect(baseX, baseY, blockWidth, blockHeight)
                continue;
            }

            if (block.wallState.wall[MapDirection.EAST]) {
                graph.lineBetween(baseX + blockWidth, baseY, baseX + blockWidth, baseY + blockHeight)
            }
            if (block.wallState.wall[MapDirection.SOUTH]) {
                graph.lineBetween(baseX, baseY + blockHeight, baseX + blockWidth, baseY + blockHeight)
            }
            if (block.wallState.wall[MapDirection.WEST]) {
                graph.lineBetween(baseX, baseY, baseX, baseY + blockHeight)
            }
            if (block.wallState.wall[MapDirection.NORTH]) {
                graph.lineBetween(baseX, baseY, baseX + blockWidth, baseY)
            }
            
            graph.lineStyle(2, 0xCC0000);
            if (block.wallState.door[MapDirection.EAST]) {
                graph.lineBetween(baseX + blockWidth, baseY, baseX + blockWidth, baseY + blockHeight)
                graph.lineBetween(baseX + blockWidth - blockWidth / 6, baseY + blockHeight / 2, baseX + blockWidth, baseY + blockHeight / 2)
            }
            if (block.wallState.door[MapDirection.SOUTH]) {
                graph.lineBetween(baseX, baseY + blockHeight, baseX + blockWidth, baseY + blockHeight)
                graph.lineBetween(baseX + blockWidth / 2, baseY + blockHeight - blockHeight / 6, baseX + blockWidth / 2, baseY + blockHeight)
            }
            if (block.wallState.door[MapDirection.WEST]) {
                graph.lineBetween(baseX, baseY, baseX, baseY + blockHeight)
                graph.lineBetween(baseX, baseY + blockHeight / 2, baseX + blockWidth / 6, baseY + blockHeight / 2)
            }
            if (block.wallState.door[MapDirection.NORTH]) {
                graph.lineBetween(baseX, baseY, baseX + blockWidth, baseY)
                graph.lineBetween(baseX + blockWidth / 2, baseY, baseX + blockWidth / 2, baseY + blockHeight / 6)
            }

            for (const object of dun.getObject(block.x, block.y)) {
                switch(object.mark) {
                    case 'o':
                    default:
                        graph.fillStyle(object.color, object.alpha);
                        graph.lineStyle(1, 0xFFFFFF);
                        graph.fillCircle(baseX + blockWidth / 2, baseY + blockWidth / 2, blockWidth / 3);
                        graph.strokeCircle(baseX + blockWidth / 2, baseY + blockWidth / 2, blockWidth / 3);
                        graph.fillStyle(0xCCCCCC);
                        break;
                }
            }
        }

        graph.lineStyle(4, 0xFFFFFF);
        graph.strokeRectShape(rect);

        // プレイヤー描画
        graph.lineStyle(1, 0xFFFFFF);
        graph.fillStyle(0xFFFFFF);
        const playerPos = dun.getPlayerPos();
        const baseX = (playerPos.x - 1) * blockWidth + OFFSET_X + blockWidth / 5, baseY = (playerPos.y - 1) * blockHeight + OFFSET_Y + blockHeight / 5;
        const playerWidth = blockWidth - blockWidth / 5 * 2, playerHeight = blockHeight - blockHeight / 5 * 2;
        let tri : Phaser.Geom.Triangle;
        switch (playerPos.direction) {
            case MapDirection.EAST:
                tri = new Phaser.Geom.Triangle(baseX, baseY, baseX, baseY + playerHeight, baseX + playerWidth, baseY + playerHeight / 2);
                break;
            case MapDirection.SOUTH:
                tri = new Phaser.Geom.Triangle(baseX, baseY, baseX + playerWidth, baseY, baseX + playerWidth / 2, baseY + playerHeight);
                break;
            case MapDirection.WEST:
                tri = new Phaser.Geom.Triangle(baseX + playerWidth, baseY, baseX + playerWidth, baseY + playerHeight, baseX, baseY + playerHeight / 2);
                break;
            case MapDirection.NORTH:
            default:
                tri = new Phaser.Geom.Triangle(baseX, baseY + playerHeight, baseX + playerWidth, baseY + playerHeight, baseX + playerWidth / 2, baseY);
                break;
        }
        
        graph.strokeTriangleShape(tri)
        graph.fillTriangleShape(tri)
    }

    prepareDrawPoints ()
    {
        const polygonList: typeof this.polygonList = [];

        const RANGE = this.mainViewRange, RANGE_SIDE = this.mainViewRangeSide;
        const BLOCK_BASE_SIZE = 560, SCREEN_WIDTH = 760, SCREEN_HEIGHT = 520, OFFSET_X = 10, OFFSET_Y = 10,  ANGLE = 60 / 180 * Math.PI;
        const CENTER_X = SCREEN_WIDTH / 2 + OFFSET_X, CENTER_Y = SCREEN_HEIGHT / 2 + OFFSET_Y, SCREEN_DISTANCE = BLOCK_BASE_SIZE / 2, CAMERA_SCREEN_DISTANCE = SCREEN_WIDTH / 2 / Math.tan(ANGLE / 2), AB = CAMERA_SCREEN_DISTANCE * BLOCK_BASE_SIZE / 2;

        const frame = new Phaser.Geom.Rectangle(OFFSET_X, OFFSET_Y, SCREEN_WIDTH, SCREEN_HEIGHT);
        const frameCutForX = (x1: number, y1: number, x2: number, y2: number, ): number => {
            if (frame.contains(x1, y1)) {
                return x1;
            }

            const slope = (y1 - y2) / (x1 - x2);
            if (x1 - x2 < 0) {
                if (y1 - y2 < 0) {
                    // 左上
                    if ((slope * (frame.left - x2) + y2) > frame.top) {
                        return frame.left;
                    } else {
                        return (1 / slope * (frame.top - y2) + x2);
                    }
                } else if (y1 - y2 > 0) {
                    // 左下
                    if ((slope * (frame.left - x2) + y2) < frame.bottom) {
                        return frame.left;
                    } else {
                        return (1 / slope * (frame.bottom - y2) + x2);
                    }
                } else {
                    return frame.left
                }
            } else {
                if (y1 - y2 < 0) {
                    // 右上
                    if ((slope * (frame.right - x2) + y2) > frame.top) {
                        return frame.right;
                    } else {
                        return (1 / slope * (frame.top - y2) + x2);
                    }
                } else if (y1 - y2 > 0) {
                    // 右下
                    if ((slope * (frame.right - x2) + y2) < frame.bottom) {
                        return frame.right;
                    } else {
                        return (1 / slope * (frame.bottom - y2) + x2);
                    }
                } else {
                    return frame.right
                }
            }
        }
        const frameCutForY = (x1: number, y1: number, x2: number, y2: number, ): number => {
            if (frame.contains(x1, y1)) {
                return y1;
            }

            const slope = (y1 - y2) / (x1 - x2);
            if (x1 - x2 < 0) {
                if (y1 - y2 < 0) {
                    // 左上
                    if ((slope * (frame.left - x2) + y2) > frame.top) {
                        return (slope * (frame.left - x2) + y2);
                    } else {
                        return frame.top;
                    }
                } else if (y1 - y2 > 0) {
                    // 左下
                    if ((slope * (frame.left - x2) + y2) < frame.bottom) {
                        return (slope * (frame.left - x2) + y2);
                    } else {
                        return frame.bottom;
                    }
                } else {
                    if (y2 < frame.top) {
                        return frame.top;
                    } else if (y2 > frame.bottom) {
                        return frame.bottom;
                    }
                    return y2;
                }
            } else {
                if (y1 - y2 < 0) {
                    // 右上
                    if ((slope * (frame.right - x2) + y2) > frame.top) {
                        return (slope * (frame.right - x2) + y2);
                    } else {
                        return frame.top;
                    }
                } else if (y1 - y2 > 0) {
                    // 右下
                    if ((slope * (frame.right - x2) + y2) < frame.bottom) {
                        return (slope * (frame.right - x2) + y2);
                    } else {
                        return frame.bottom;
                    }
                } else {
                    if (y2 < frame.top) {
                        return frame.top;
                    } else if (y2 > frame.bottom) {
                        return frame.bottom;
                    }
                    return y2;
                }
            }
        }
        const preparePoints = (upOutsideX: number, upOutsideY: number, upInsideX: number, upInsideY: number, downInsideX: number, downInsideY: number, downOutsideX: number, downOutsideY: number): number[] => {
            if ( ! frame.contains(upInsideX, upInsideY)){
                return [];
            }

            const upOutsideYCalc = frameCutForY(upOutsideX, upOutsideY, upInsideX, upInsideY),
            downOutsideXCalc = frameCutForX(downOutsideX, downOutsideY, downInsideX, downInsideY), downOutsideYCalc = frameCutForY(downOutsideX, downOutsideY, downInsideX, downInsideY);
            const result = [
                frameCutForX(upOutsideX, upOutsideY, upInsideX, upInsideY),
                upOutsideYCalc,
                upInsideX, upInsideY,
                frameCutForX(downInsideX, downInsideY, upInsideX, upInsideY),
                frameCutForY(downInsideX, downInsideY, upInsideX, upInsideY),
                downOutsideXCalc,
                downOutsideYCalc,
            ];
            if (upOutsideYCalc === frame.top) {
                result.unshift(upOutsideX < upInsideX ? frame.left : frame.right, frame.top);
            }
            if (downOutsideYCalc === frame.bottom) {
                result.push(downOutsideX < downInsideX ? frame.left : frame.right, frame.bottom);
            } else if (downOutsideXCalc === frame.right || downOutsideXCalc === frame.left) {
                result.push(downOutsideXCalc, frameCutForY(downOutsideX, downOutsideY, upOutsideX, upOutsideY));
            }

            return result;
        }

        for (let i = 0; i <= RANGE; i++) {
            const targetDistance = (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * (i)),
                targetDistanceNear = (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * (i - 1));
            const far = AB / targetDistance,
                near = AB / targetDistanceNear;
            const polygonListLine: (Phaser.Geom.Polygon | null) [][] = [];
            let pointList: number[] = [];
            for (let j = RANGE_SIDE; j >= 1; j--) {
                const order = 2 * j - 1;
                const farInside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j - 1 + 0.5)) / targetDistance,
                    nearInside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j - 1 + 0.5)) / targetDistanceNear,
                    farOutside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j + 0.5)) / targetDistance,
                    nearOutside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j + 0.5)) / targetDistanceNear;
                // 右側
                polygonListLine[order] = [];
                pointList = preparePoints(CENTER_X + farOutside, CENTER_Y - far, CENTER_X + farInside, CENTER_Y - far, CENTER_X + farInside, CENTER_Y + far, CENTER_X + farOutside, CENTER_Y + far)
                polygonListLine[order].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
                pointList = preparePoints(CENTER_X + nearOutside, CENTER_Y - near, CENTER_X + farOutside, CENTER_Y - far, CENTER_X + farOutside, CENTER_Y + far, CENTER_X + nearOutside, CENTER_Y + near)
                polygonListLine[order].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
                pointList = preparePoints(CENTER_X + farOutside, CENTER_Y + far, CENTER_X + farInside, CENTER_Y + far, CENTER_X + nearInside, CENTER_Y + near, CENTER_X + nearOutside, CENTER_Y + near)
                polygonListLine[order].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);

                // 左側
                polygonListLine[order + 1] = [];
                pointList = preparePoints(CENTER_X - farOutside, CENTER_Y - far, CENTER_X - farInside, CENTER_Y - far, CENTER_X - farInside, CENTER_Y + far, CENTER_X - farOutside, CENTER_Y + far)
                polygonListLine[order + 1].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
                pointList = preparePoints(CENTER_X - nearOutside, CENTER_Y - near, CENTER_X - farOutside, CENTER_Y - far, CENTER_X - farOutside, CENTER_Y + far, CENTER_X - nearOutside, CENTER_Y + near)
                polygonListLine[order + 1].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
                pointList = preparePoints(CENTER_X - farOutside, CENTER_Y + far, CENTER_X - farInside, CENTER_Y + far, CENTER_X - nearInside, CENTER_Y + near, CENTER_X - nearOutside, CENTER_Y + near)
                polygonListLine[order + 1].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
            }
            

            // 真ん中
            polygonListLine[0] = [];
            pointList = preparePoints(CENTER_X + near, CENTER_Y - near, CENTER_X + far, CENTER_Y - far, CENTER_X + far, CENTER_Y + far, CENTER_X + near, CENTER_Y + near);
            polygonListLine[0].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
            pointList = preparePoints(CENTER_X - near, CENTER_Y - near, CENTER_X - far, CENTER_Y - far, CENTER_X - far, CENTER_Y + far, CENTER_X - near, CENTER_Y + near);
            polygonListLine[0].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
            pointList = preparePoints(CENTER_X + near, CENTER_Y + near, CENTER_X + far, CENTER_Y + far, CENTER_X - far, CENTER_Y + far, CENTER_X - near, CENTER_Y + near)
            polygonListLine[0].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
            pointList = [CENTER_X + far, CENTER_Y + far, CENTER_X + far, CENTER_Y - far, CENTER_X - far, CENTER_Y - far, CENTER_X - far, CENTER_Y + far, ];
            polygonListLine[0].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);

            polygonList.push(polygonListLine);
        }

        this.polygonList = polygonList;
        this.mainViewFrame = frame;
        this.mainViewCeil = new Phaser.Geom.Rectangle(frame.left, frame.top, frame.width, frame.height / 2 - AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE))
        this.mainViewFloor = new Phaser.Geom.Rectangle(frame.left, frame.top + frame.height / 2 + AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE), frame.width, frame.height / 2 - AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE))
    }

    redrawMainView()
    {
        const dun = this.dungeon;
        const graph = this.graph;

        graph.lineStyle(4, 0xFFFFFF);
        graph.fillStyle(0x0);

        const player = dun.getPlayerPos();
        const blockList: integer[][][] = [];
        const RANGE = this.mainViewRange, RANGE_SIDE = this.mainViewRangeSide;

        const rotateRight = (value: integer, shiftAmount: integer) => {
            const wall = value & 0xF, door = value & 0xF0;
            return (((wall >> shiftAmount) | (wall << (4 - shiftAmount))) & 0xF)
                | (((door >> shiftAmount) | (door << (4 - shiftAmount))) & 0xF0);
        }

        switch(player.direction) {
            case MapDirection.EAST:
                for (let i = RANGE; i >= 0; i--) {
                    const buf = [[rotateRight(dun.getAt(player.x + i, player.y), 1), player.x + i, player.y]];
                    for (let j = 1; j <= RANGE_SIDE; j++) {
                        buf.push([rotateRight(dun.getAt(player.x + i, player.y + j), 1), player.x + i, player.y + j]);
                        buf.push([rotateRight(dun.getAt(player.x + i, player.y - j), 1), player.x + i, player.y - j]);
                    }
                    blockList.push(buf);
                }
                break;
            case MapDirection.SOUTH:
                for (let i = RANGE; i >= 0; i--) {
                    const buf = [[rotateRight(dun.getAt(player.x, player.y + i), 2), player.x, player.y + i]];
                    for (let j = 1; j <= RANGE_SIDE; j++) {
                        buf.push([rotateRight(dun.getAt(player.x - j, player.y + i), 2), player.x - j, player.y + i]);
                        buf.push([rotateRight(dun.getAt(player.x + j, player.y + i), 2), player.x + j, player.y + i]);
                    }
                    blockList.push(buf);
                }
                break;
            case MapDirection.WEST:
                for (let i = RANGE; i >= 0; i--) {
                    const buf = [[rotateRight(dun.getAt(player.x - i, player.y), 3), player.x - i, player.y]];
                    for (let j = 1; j <= RANGE_SIDE; j++) {
                        buf.push([rotateRight(dun.getAt(player.x - i, player.y - j), 3), player.x - i, player.y - j]);
                        buf.push([rotateRight(dun.getAt(player.x - i, player.y + j), 3), player.x - i, player.y + j]);
                    }
                    blockList.push(buf);
                }
                break;
            case MapDirection.NORTH:
                for (let i = RANGE; i >= 0; i--) {
                    const buf = [[dun.getAt(player.x, player.y - i), player.x, player.y - i]];
                    for (let j = 1; j <= RANGE_SIDE; j++) {
                        buf.push([dun.getAt(player.x + j, player.y - i), player.x + j, player.y - i]);
                        buf.push([dun.getAt(player.x - j, player.y - i), player.x - j, player.y - i]);
                    }
                    blockList.push(buf);
                }
                break;
        }

        const frame = this.mainViewFrame;
        const ceil = this.mainViewCeil;
        const floor = this.mainViewFloor;
        if ( ! frame || ! ceil || ! floor) {
            return;
        }

        // 背景ベース
        graph.lineStyle(4, 0xFFFFFF);
        graph.strokeRectShape(frame);
        graph.fillStyle(0x0);
        graph.fillRectShape(frame);
        // 背景天井
        graph.fillStyle(0xCCCCCC);
        graph.fillRectShape(ceil);
        // 背景床
        graph.fillStyle(0x3F3F3F);
        graph.fillRectShape(floor);
        // ブロックベース
        graph.lineStyle(1, 0x0);
        graph.fillStyle(0xFFFFFF);
        for (let i = 0; i < blockList.length; i++) {
            // デバッグ用描画距離によって枠線を色分け
            // graph.lineStyle(2, [0x0000FF,0x00FFFF,0x00FF00,0xFFFF00,0xFF0000,0xFF00FF][i%6]);
            for (let j = RANGE_SIDE; j >= 1; j--) {
                const order = 2 * j - 1;
                // graph.lineStyle(2, [0x0000FF,0x00FF00,0xFF0000][j%3]);
                // 右側
                if ((blockList[i][order][0] & 8) && this.polygonList[RANGE - i][order][0]) {
                    const pol = this.polygonList[RANGE - i][order][0];
                    if (pol) {
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order][0] & (8 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
                if ((blockList[i][order][0] & 1) && this.polygonList[RANGE - i][order][1]) {
                    const pol = this.polygonList[RANGE - i][order][1];
                    if (pol) {
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order][0] & (1 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
                for (const object of dun.getObject(blockList[i][order][1], blockList[i][order][2])) {
                    const pol = this.polygonList[RANGE - i][order][2];
                    if (pol) {
                        graph.fillStyle(object.color, object.alpha);
                        graph.fillPoints(pol.points, true)
                    }
                }

                // 左側
                if ((blockList[i][order + 1][0] & 8) && this.polygonList[RANGE - i][order + 1][0]) {
                    const pol = this.polygonList[RANGE - i][order + 1][0];
                    if (pol) {
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order + 1][0] & (8 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
                if ((blockList[i][order + 1][0] & 4) && this.polygonList[RANGE - i][order + 1][1]) {
                    const pol = this.polygonList[RANGE - i][order + 1][1];
                    if (pol) {
                        graph.strokePoints(pol.points, true)
                        if (blockList[i][order + 1][0] & (4 << 4)) {
                            graph.fillStyle(0xFFFFFF, 0.5);
                        } else {
                            graph.fillStyle(0xFFFFFF);
                        }
                        graph.fillPoints(pol.points, true)
                    }
                }
                for (const object of dun.getObject(blockList[i][order + 1][1], blockList[i][order + 1][2])) {
                    const pol = this.polygonList[RANGE - i][order + 1][2];
                    if (pol) {
                        graph.fillStyle(object.color, object.alpha);
                        graph.fillPoints(pol.points, true)
                    }
                }
            }
            

            // 真ん中
            // graph.lineStyle(2, 0);
            if ((blockList[i][0][0] & 1) && this.polygonList[RANGE - i][0][0]) {
                const pol = this.polygonList[RANGE - i][0][0];
                if (pol) {
                    graph.strokePoints(pol.points, true)
                    if (blockList[i][0][0] & (1 << 4)) {
                        graph.fillStyle(0xFFFFFF, 0.5);
                    } else {
                        graph.fillStyle(0xFFFFFF);
                    }
                    graph.fillPoints(pol.points, true)
                }
            }
            if ((blockList[i][0][0] & 4) && this.polygonList[RANGE - i][0][1]) {
                const pol = this.polygonList[RANGE - i][0][1];
                if (pol) {
                    graph.strokePoints(pol.points, true)
                    if (blockList[i][0][0] & (4 << 4)) {
                        graph.fillStyle(0xFFFFFF, 0.5);
                    } else {
                        graph.fillStyle(0xFFFFFF);
                    }
                    graph.fillPoints(pol.points, true)
                }
            }
            if ((blockList[i][0][0] & 8) && this.polygonList[RANGE - i][0][3]) {
                const pol = this.polygonList[RANGE - i][0][3];
                if (pol) {
                    graph.strokePoints(pol.points, true)
                    if (blockList[i][0][0] & (8 << 4)) {
                        graph.fillStyle(0xFFFFFF, 0.5);
                    } else {
                        graph.fillStyle(0xFFFFFF);
                    }
                    graph.fillPoints(pol.points, true)
                }
            }
            for (const object of dun.getObject(blockList[i][0][1], blockList[i][0][2])) {
                const pol = this.polygonList[RANGE - i][0][2];
                if (pol) {
                    graph.fillStyle(object.color, object.alpha);
                    graph.fillPoints(pol.points, true)
                }
            }
        }
    }

    create ()
    {
        const dun = new DungeonMap(15, 15);
        const init = () => {
            dun.build();
            // dun.dump();
            const step = dun.getRandomPos(true, true);
            if (step.length >= 2) {
                dun.addObject(step[0], step[1], 'o', (dungeon: DungeonMap, object: MapObject) => {
                    const player = dungeon.getPlayerPos()
                    if (player.x === object.x && player.y === object.y) {
                        this.floor++;
                        console.log('go to ' + this.floor);
                        dungeon.init();
                        init();
                    }
                }, 0x00FF00)
            }
        }
        init();

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


        EventBus.emit('current-scene-ready', this);

        this.dungeon = dun;

        this.prepareDrawPoints()

        this.redrawAll()
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
