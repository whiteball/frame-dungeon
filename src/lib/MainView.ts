
import { DungeonMap } from './MapGenerator';
import { MapDirection } from './map/MapDirection';

export class MainView {
  private graph: Phaser.GameObjects.Graphics;

  private polygonList: (Phaser.Geom.Polygon | null)[][][];
  private centerList: (Phaser.Geom.Circle | null)[][];
  private floorInner1List: (Phaser.Geom.Polygon | null)[][];
  private floorInner2List: (Phaser.Geom.Polygon | null)[][];
  private frame: (Phaser.Geom.Rectangle | null);
  private ceil: (Phaser.Geom.Rectangle | null);
  private floor: (Phaser.Geom.Rectangle | null);
  private range: integer = 4;
  private rangeSide: integer = 3;

  private width: integer;
  private height: integer;
  private angle: integer;

  private blockSize: integer;

  private flashColor: number | null = null;

  /**
   * メインビューを初期化する
   * @param factory Phaserのゲームオブジェクトファクトリー
   * @param x 描画開始X座標
   * @param y 描画開始Y座標
   * @param width ビューの幅
   * @param height ビューの高さ
   * @param angle 視野角（デフォルト: 70度）
   * @param blockSize ブロックサイズ（デフォルト: 0で自動計算）
   */
  constructor(factory: Phaser.GameObjects.GameObjectFactory, x: integer, y: integer, width: integer, height: integer, angle = 70, blockSize = 0) {
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
    this.angle = angle;
    this.blockSize = blockSize === 0 ? Math.floor(width / 2 / (0.75 - Math.tan(angle / 2) / 2)) : blockSize;

    this.prepareDrawPoints();
  }

  /**
   * 3D透視投影のための描画ポイントを事前計算する
   * 距離と角度に基づいて、各ブロックの描画用ポリゴンと中心点を計算する
   */
  flash(color: number): void {
    this.flashColor = color;
  }

  private prepareDrawPoints() {
    const polygonList: typeof this.polygonList = [];
    const centerList: typeof this.centerList = [];
    const floorInner1List: typeof this.floorInner1List = [];
    const floorInner2List: typeof this.floorInner2List = [];
    const PHI_RATIO = 2 / (1 + Math.sqrt(5));

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

      const computeInnerFloor = (r: number): (Phaser.Geom.Polygon | null)[] => {
        const line: (Phaser.Geom.Polygon | null)[] = [];
        const z_nr = targetDistanceMiddle - BLOCK_BASE_SIZE * r / 2;
        const z_fr = targetDistanceMiddle + BLOCK_BASE_SIZE * r / 2;
        const innerNearY = AB / z_nr;
        const innerFarY = AB / z_fr;
        const innerNear0 = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * r / 2) / z_nr;
        const innerFar0 = CAMERA_SCREEN_DISTANCE * (BLOCK_BASE_SIZE * r / 2) / z_fr;
        line[0] = new Phaser.Geom.Polygon([
          CENTER_X + innerNear0, CENTER_Y + innerNearY,
          CENTER_X + innerFar0, CENTER_Y + innerFarY,
          CENTER_X - innerFar0, CENTER_Y + innerFarY,
          CENTER_X - innerNear0, CENTER_Y + innerNearY,
        ]);
        for (let j = 1; j <= RANGE_SIDE; j++) {
          const order = 2 * j - 1;
          const x_inside = CAMERA_SCREEN_DISTANCE * BLOCK_BASE_SIZE * (j - r / 2);
          const x_outside = CAMERA_SCREEN_DISTANCE * BLOCK_BASE_SIZE * (j + r / 2);
          line[order] = new Phaser.Geom.Polygon([
            CENTER_X + x_outside / z_fr, CENTER_Y + innerFarY,
            CENTER_X + x_inside / z_fr, CENTER_Y + innerFarY,
            CENTER_X + x_inside / z_nr, CENTER_Y + innerNearY,
            CENTER_X + x_outside / z_nr, CENTER_Y + innerNearY,
          ]);
          line[order + 1] = new Phaser.Geom.Polygon([
            CENTER_X - x_outside / z_fr, CENTER_Y + innerFarY,
            CENTER_X - x_inside / z_fr, CENTER_Y + innerFarY,
            CENTER_X - x_inside / z_nr, CENTER_Y + innerNearY,
            CENTER_X - x_outside / z_nr, CENTER_Y + innerNearY,
          ]);
        }
        return line;
      };
      floorInner1List.push(computeInnerFloor(PHI_RATIO));
      floorInner2List.push(computeInnerFloor(PHI_RATIO * PHI_RATIO));
    }

    this.polygonList = polygonList;
    this.centerList = centerList;
    this.floorInner1List = floorInner1List;
    this.floorInner2List = floorInner2List;
    this.frame = frame;
    this.ceil = new Phaser.Geom.Rectangle(frame.left, frame.top, frame.width, frame.height / 2 - AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE))
    this.floor = new Phaser.Geom.Rectangle(frame.left, frame.top + frame.height / 2 + AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE), frame.width, frame.height / 2 - AB / (CAMERA_SCREEN_DISTANCE + SCREEN_DISTANCE + BLOCK_BASE_SIZE * RANGE))
  }

  /**
   * ダンジョンマップを3D透視投影でレンダリングする
   * プレイヤーの位置と向きに基づいて、見える範囲の壁とオブジェクトを描画する
   * @param dun レンダリングするダンジョンマップ
   */
  render(dun: DungeonMap) {
    const graph = this.graph;
    graph.clear();

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
    graph.lineStyle(1, 0x0, 1);
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

    const DOOR_COLOR = 0xA0522D;
    const VP_X = this.width / 2, VP_Y = this.height / 2;
    const drawDoor = (pol: Phaser.Geom.Polygon) => {
      const pts = pol.points;
      // 半透明ベース（全面）
      graph.fillStyle(DOOR_COLOR, 0.5);
      graph.fillPoints(pts, true);
      const sorted = [...pts].sort((a, b) => a.y - b.y);
      const [tl, tr] = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
      const [bl, br] = sorted.slice(2).sort((a, b) => a.x - b.x);
      const bp = (u: number, v: number) => ({
        x: (1 - u) * (1 - v) * bl.x + u * (1 - v) * br.x + (1 - u) * v * tl.x + u * v * tr.x,
        y: (1 - u) * (1 - v) * bl.y + u * (1 - v) * br.y + (1 - u) * v * tl.y + u * v * tr.y,
      });
      const isLateralWall = Math.abs(tl.y - tr.y) > 0.1;
      // 透視図の正確な補間：側壁では調和平均ベースの式を使う
      const perspOff = (u: number, A: number, B: number) => A * B / ((1 - u) * B + u * A);
      const bpPersp = (u: number, v: number) => {
        if (!isLateralWall) return bp(u, v);
        const xOff = perspOff(u, tl.x - VP_X, tr.x - VP_X);
        const ytOff = perspOff(u, tl.y - VP_Y, tr.y - VP_Y);
        const ybOff = perspOff(u, bl.y - VP_Y, br.y - VP_Y);
        return { x: VP_X + xOff, y: VP_Y + (1 - v) * ybOff + v * ytOff };
      };
      const wl = 0.15, wr = 0.85, wb = 0.5, wt = 0.78;
      // 不透明フレームで半透明ベースを上書き（のぞき窓以外）
      graph.fillStyle(DOOR_COLOR, 1.0);
      graph.fillPoints([bpPersp(0, 0), bpPersp(1, 0), bpPersp(1, wb), bpPersp(0, wb)], true);
      graph.fillPoints([bpPersp(0, wt), bpPersp(1, wt), bpPersp(1, 1), bpPersp(0, 1)], true);
      graph.fillPoints([bpPersp(0, wb), bpPersp(wl, wb), bpPersp(wl, wt), bpPersp(0, wt)], true);
      graph.fillPoints([bpPersp(wr, wb), bpPersp(1, wb), bpPersp(1, wt), bpPersp(wr, wt)], true);
      // 窓の輪郭線
      graph.lineStyle(1, 0x888888, 1.0);
      graph.strokePoints([bpPersp(wl, wb), bpPersp(wr, wb), bpPersp(wr, wt), bpPersp(wl, wt)], true);
      // 中央垂直仕切り線（観音開き）—— 透視図ベースの正確な中点
      const botPt = bpPersp(0.5, 0), topPt = bpPersp(0.5, 1);
      graph.beginPath().moveTo(botPt.x, botPt.y).lineTo(topPt.x, topPt.y).strokePath();
      // 取っ手（仕切り線の両側・窓の下）
      graph.fillStyle(0x202020, 1.0);
      graph.fillPoints([bpPersp(0.36, 0.34), bpPersp(0.47, 0.34), bpPersp(0.47, 0.42), bpPersp(0.36, 0.42)], true);
      graph.fillPoints([bpPersp(0.53, 0.34), bpPersp(0.64, 0.34), bpPersp(0.64, 0.42), bpPersp(0.53, 0.42)], true);
    };

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
              drawDoor(pol);
            } else {
              graph.fillStyle(0xFFFFFF);
              graph.fillPoints(pol.points, true);
            }
          }
        }
        if ((blockList[i][order][0] & 1) && this.polygonList[RANGE - i][order][1]) {
          const pol = this.polygonList[RANGE - i][order][1];
          if (pol) {
            graph.strokePoints(pol.points, true)
            if (blockList[i][order][0] & (1 << 4)) {
              drawDoor(pol);
            } else {
              graph.fillStyle(0xFFFFFF);
              graph.fillPoints(pol.points, true);
            }
          }
        }
        for (const object of dun.getObject(blockList[i][order][1], blockList[i][order][2])) {
          if (!object.visible) {
            continue;
          }

          const pol = this.polygonList[RANGE - i][order][2];
          if (pol) {
            graph.lineStyle(1, 0x0, 0.5);
            graph.strokePoints(pol.points, true);
            graph.strokePoints([pol.points[0], pol.points[2]], true);
            graph.strokePoints([pol.points[1], pol.points[3]], true);
            graph.lineStyle(1, 0x0, 1);
            graph.fillStyle(object.color, 0.3);
            graph.fillPoints(pol.points, true);
            const inner1 = this.floorInner1List[RANGE - i][order];
            if (inner1) {
              graph.fillStyle(object.color, 0.6);
              graph.fillPoints(inner1.points, true);
            }
            const inner2 = this.floorInner2List[RANGE - i][order];
            if (inner2) {
              graph.fillStyle(object.color, 1);
              graph.fillPoints(inner2.points, true);
            }
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
              drawDoor(pol);
            } else {
              graph.fillStyle(0xFFFFFF);
              graph.fillPoints(pol.points, true);
            }
          }
        }
        if ((blockList[i][order + 1][0] & 4) && this.polygonList[RANGE - i][order + 1][1]) {
          const pol = this.polygonList[RANGE - i][order + 1][1];
          if (pol) {
            graph.strokePoints(pol.points, true)
            if (blockList[i][order + 1][0] & (4 << 4)) {
              drawDoor(pol);
            } else {
              graph.fillStyle(0xFFFFFF);
              graph.fillPoints(pol.points, true);
            }
          }
        }
        for (const object of dun.getObject(blockList[i][order + 1][1], blockList[i][order + 1][2])) {
          if (!object.visible) {
            continue;
          }

          const pol = this.polygonList[RANGE - i][order + 1][2];
          if (pol) {
            graph.lineStyle(1, 0x0, 0.5);
            graph.strokePoints(pol.points, true);
            graph.strokePoints([pol.points[0], pol.points[2]], true);
            graph.strokePoints([pol.points[1], pol.points[3]], true);
            graph.lineStyle(1, 0x0, 1);
            graph.fillStyle(object.color, 0.3);
            graph.fillPoints(pol.points, true);
            const inner1 = this.floorInner1List[RANGE - i][order + 1];
            if (inner1) {
              graph.fillStyle(object.color, 0.6);
              graph.fillPoints(inner1.points, true);
            }
            const inner2 = this.floorInner2List[RANGE - i][order + 1];
            if (inner2) {
              graph.fillStyle(object.color, 1);
              graph.fillPoints(inner2.points, true);
            }
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
            drawDoor(pol);
          } else {
            graph.fillStyle(0xFFFFFF);
            graph.fillPoints(pol.points, true);
          }
        }
      }
      if ((blockList[i][0][0] & 4) && this.polygonList[RANGE - i][0][1]) {
        const pol = this.polygonList[RANGE - i][0][1];
        if (pol) {
          graph.strokePoints(pol.points, true)
          if (blockList[i][0][0] & (4 << 4)) {
            drawDoor(pol);
          } else {
            graph.fillStyle(0xFFFFFF);
            graph.fillPoints(pol.points, true);
          }
        }
      }
      if ((blockList[i][0][0] & 8) && this.polygonList[RANGE - i][0][3]) {
        const pol = this.polygonList[RANGE - i][0][3];
        if (pol) {
          graph.strokePoints(pol.points, true)
          if (blockList[i][0][0] & (8 << 4)) {
            drawDoor(pol);
          } else {
            graph.fillStyle(0xFFFFFF);
            graph.fillPoints(pol.points, true);
          }
        }
      }
      for (const object of dun.getObject(blockList[i][0][1], blockList[i][0][2])) {
        if (!object.visible) {
          continue;
        }

        const pol = this.polygonList[RANGE - i][0][2];
        if (pol) {
          graph.lineStyle(1, 0x0, 0.5);
          graph.strokePoints(pol.points, true);
          graph.strokePoints([pol.points[0], pol.points[2]], true);
          graph.strokePoints([pol.points[1], pol.points[3]], true);
          graph.lineStyle(1, 0x0, 1);
          graph.fillStyle(object.color, 0.3);
          graph.fillPoints(pol.points, true);
          const inner1 = this.floorInner1List[RANGE - i][0];
          if (inner1) {
            graph.fillStyle(object.color, 0.6);
            graph.fillPoints(inner1.points, true);
          }
          const inner2 = this.floorInner2List[RANGE - i][0];
          if (inner2) {
            graph.fillStyle(object.color, 1);
            graph.fillPoints(inner2.points, true);
          }
          const center = this.centerList[RANGE - i][0];
          if (object.sphere && center) {
            drawSphere(center, object.alpha);
          }
        }
      }
    }

    // フラッシュエフェクト
    if (this.flashColor !== null) {
      graph.fillStyle(this.flashColor, 0.4);
      graph.fillRectShape(frame);
      this.flashColor = null;
    }

    // 枠線の描画
    graph.lineStyle(4, 0, 1);
    graph.strokeRectShape(frame);
    graph.lineStyle(2, 0xFFFFFF, 1);
    graph.strokeRectShape(frame);
  }
}
