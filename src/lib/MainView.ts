
import { DungeonMap, MapDirection } from './MapGenerator';

export class MainView {
  private graph: Phaser.GameObjects.Graphics;

  private polygonList: (Phaser.Geom.Polygon | null)[][][];
  private centerList: (Phaser.Geom.Circle | null)[][];
  private frame: (Phaser.Geom.Rectangle | null);
  private ceil: (Phaser.Geom.Rectangle | null);
  private floor: (Phaser.Geom.Rectangle | null);
  private range: integer = 4;
  private rangeSide: integer = 3;

  private width: integer;
  private height: integer;
  private angle: integer;

  private blockSize: integer;

  constructor(factory: Phaser.GameObjects.GameObjectFactory, x: integer, y: integer, width: integer, height: integer) {
    const mask = factory.graphics({ fillStyle: { color: 0xffffff, alpha: 0 } });
    mask.fillRect(x - 2, y - 2, width + 4, height + 4);

    this.graph = factory.graphics({
      lineStyle: { width: 4, color: 0xCCCCCC, alpha: 1 },
      fillStyle: { color: 0, alpha: 1 },
      x: x,
      y: y,
    }).setMask(mask.createGeometryMask());
    this.width = width;
    this.height = height;
    this.angle = 60;
    this.blockSize = 560;

    this.prepareDrawPoints();
  }

  private prepareDrawPoints() {
    const polygonList: typeof this.polygonList = [];
    const centerList: typeof this.centerList = [];

    const RANGE = this.range, RANGE_SIDE = this.rangeSide;
    const BLOCK_BASE_SIZE = this.blockSize, SCREEN_WIDTH = this.width, SCREEN_HEIGHT = this.height, ANGLE = this.angle / 180 * Math.PI;
    const CENTER_X = SCREEN_WIDTH / 2, CENTER_Y = SCREEN_HEIGHT / 2, SCREEN_DISTANCE = BLOCK_BASE_SIZE / 2, CAMERA_SCREEN_DISTANCE = SCREEN_WIDTH / 2 / Math.tan(ANGLE / 2), AB = CAMERA_SCREEN_DISTANCE * BLOCK_BASE_SIZE / 2;

    const frame = new Phaser.Geom.Rectangle(0, 0, SCREEN_WIDTH, SCREEN_HEIGHT);

    for (let i = 0; i <= RANGE; i++) {
      const targetDistance = (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * (i)),
        targetDistanceMiddle = (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * (i - 0.5)),
        targetDistanceNear = (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * (i - 1));
      const far = AB / targetDistance,
        middle = AB / targetDistanceMiddle,
        near = AB / targetDistanceNear;
      const polygonListLine: (Phaser.Geom.Polygon | null)[][] = [];
      const centerListLine: (Phaser.Geom.Circle | null)[] = [];
      let pointList: number[] = [];
      for (let j = RANGE_SIDE; j >= 1; j--) {
        const order = 2 * j - 1;
        const farInside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j - 1 + 0.5)) / targetDistance,
          nearInside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j - 1 + 0.5)) / targetDistanceNear,
          middleCenter = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * j) / targetDistanceMiddle,
          farOutside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j + 0.5)) / targetDistance,
          nearOutside = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * (j + 0.5)) / targetDistanceNear;
        // 右側
        polygonListLine[order] = [];
        pointList = [CENTER_X + farOutside, CENTER_Y - far, CENTER_X + farInside, CENTER_Y - far, CENTER_X + farInside, CENTER_Y + far, CENTER_X + farOutside, CENTER_Y + far];
        polygonListLine[order].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
        pointList = [CENTER_X + nearOutside, CENTER_Y - near, CENTER_X + farOutside, CENTER_Y - far, CENTER_X + farOutside, CENTER_Y + far, CENTER_X + nearOutside, CENTER_Y + near];
        polygonListLine[order].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
        pointList = [CENTER_X + farOutside, CENTER_Y + far, CENTER_X + farInside, CENTER_Y + far, CENTER_X + nearInside, CENTER_Y + near, CENTER_X + nearOutside, CENTER_Y + near];
        polygonListLine[order].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
        centerListLine[order] = new Phaser.Geom.Circle(CENTER_X + middleCenter, CENTER_Y, middle / 2);

        // 左側
        polygonListLine[order + 1] = [];
        pointList = [CENTER_X - farOutside, CENTER_Y - far, CENTER_X - farInside, CENTER_Y - far, CENTER_X - farInside, CENTER_Y + far, CENTER_X - farOutside, CENTER_Y + far];
        polygonListLine[order + 1].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
        pointList = [CENTER_X - nearOutside, CENTER_Y - near, CENTER_X - farOutside, CENTER_Y - far, CENTER_X - farOutside, CENTER_Y + far, CENTER_X - nearOutside, CENTER_Y + near];
        polygonListLine[order + 1].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
        pointList = [CENTER_X - farOutside, CENTER_Y + far, CENTER_X - farInside, CENTER_Y + far, CENTER_X - nearInside, CENTER_Y + near, CENTER_X - nearOutside, CENTER_Y + near];
        polygonListLine[order + 1].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
        centerListLine[order + 1] = new Phaser.Geom.Circle(CENTER_X - middleCenter, CENTER_Y, middle / 2);
      }

      // 真ん中
      polygonListLine[0] = [];
      pointList = [CENTER_X + near, CENTER_Y - near, CENTER_X + far, CENTER_Y - far, CENTER_X + far, CENTER_Y + far, CENTER_X + near, CENTER_Y + near];
      polygonListLine[0].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
      pointList = [CENTER_X - near, CENTER_Y - near, CENTER_X - far, CENTER_Y - far, CENTER_X - far, CENTER_Y + far, CENTER_X - near, CENTER_Y + near];
      polygonListLine[0].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
      pointList = [CENTER_X + near, CENTER_Y + near, CENTER_X + far, CENTER_Y + far, CENTER_X - far, CENTER_Y + far, CENTER_X - near, CENTER_Y + near];
      polygonListLine[0].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
      pointList = [CENTER_X + far, CENTER_Y + far, CENTER_X + far, CENTER_Y - far, CENTER_X - far, CENTER_Y - far, CENTER_X - far, CENTER_Y + far,];
      polygonListLine[0].push(pointList.length > 0 ? new Phaser.Geom.Polygon(pointList) : null);
      centerListLine[0] = new Phaser.Geom.Circle(CENTER_X, CENTER_Y, middle / 2);

      polygonList.push(polygonListLine);
      centerList.push(centerListLine);
    }

    this.polygonList = polygonList;
    this.centerList = centerList;
    this.frame = frame;
    this.ceil = new Phaser.Geom.Rectangle(frame.left, frame.top, frame.width, frame.height / 2 - AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE))
    this.floor = new Phaser.Geom.Rectangle(frame.left, frame.top + frame.height / 2 + AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE), frame.width, frame.height / 2 - AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE))
  }

  render(dun: DungeonMap) {
    const graph = this.graph;

    graph.lineStyle(4, 0xFFFFFF);
    graph.fillStyle(0x0);

    const player = dun.getPlayerPos();
    const blockList: integer[][][] = [];
    const RANGE = this.range, RANGE_SIDE = this.rangeSide;

    const rotateRight = (value: integer, shiftAmount: integer) => {
      const wall = value & 0xF, door = value & 0xF0;
      return (((wall >> shiftAmount) | (wall << (4 - shiftAmount))) & 0xF)
        | (((door >> shiftAmount) | (door << (4 - shiftAmount))) & 0xF0);
    }

    switch (player.direction) {
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

    const frame = this.frame;
    const ceil = this.ceil;
    const floor = this.floor;
    if (!frame || !ceil || !floor) {
      return;
    }

    // 背景ベース
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

    const drawSphere = (circle: Phaser.Geom.Circle, alpha: number) => {
      // 球の本体
      graph.strokeCircleShape(circle).fillCircleShape(circle);

      // 光の反射
      const offsetX = circle.x + circle.radius * 0.5, offsetY = circle.y - circle.radius * 0.5
      graph.translateCanvas(offsetX, offsetY).rotateCanvas(Math.PI / 4);
      graph.fillStyle(0xFFFFFF, alpha / 3).fillEllipse(0, 0, circle.radius / 2, circle.radius / 6)
      graph.rotateCanvas(-Math.PI / 4).translateCanvas(-offsetX, -offsetY)

      // 影
      graph.fillStyle(0, alpha / 5);
      graph.beginPath()
        .arc(circle.x, circle.y, circle.radius, Math.PI / 4 * 2, Math.PI / 4 * 4.5)
        .closePath().fill();
      graph.beginPath()
        .arc(circle.x, circle.y, circle.radius, Math.PI / 4 * 1.5, Math.PI / 4 * 4)
        .closePath().fill();
    }

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
            graph.strokePoints(pol.points, true)
            graph.fillStyle(object.color, object.alpha);
            graph.fillPoints(pol.points, true)
            const center = this.centerList[RANGE - i][order];
            if (object.sphere && center) {
              drawSphere(center, object.alpha);
            }
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
            graph.strokePoints(pol.points, true)
            graph.fillStyle(object.color, object.alpha);
            graph.fillPoints(pol.points, true)
            const center = this.centerList[RANGE - i][order + 1];
            if (object.sphere && center) {
              drawSphere(center, object.alpha);
            }
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
          graph.strokePoints(pol.points, true)
          graph.fillStyle(object.color, object.alpha);
          graph.fillPoints(pol.points, true)
          const center = this.centerList[RANGE - i][0];
          if (object.sphere && center) {
            drawSphere(center, object.alpha);
          }
        }
      }
    }

    // 枠線の描画
    graph.lineStyle(4, 0);
    graph.strokeRectShape(frame);
    graph.lineStyle(2, 0xFFFFFF);
    graph.strokeRectShape(frame);
  }
}
