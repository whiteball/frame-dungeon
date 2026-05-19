
import { DungeonMap } from './MapGenerator';
import { MapShape } from './MapObject';
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
   * @param openDoors 開放状態で描画する扉のセット（"x,y,dir" 形式）
   */
  render(dun: DungeonMap, openDoors?: Set<string>) {
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

    // 一点透視図の焦点距離と消失点（drawCube が closure で参照する）
    const CUBE_FOCAL = this.width / 2 / Math.tan(this.angle / 180 * Math.PI / 2);
    const CUBE_VP_X = this.width / 2, CUBE_VP_Y = this.height / 2;

    const drawCube = (circle: Phaser.Geom.Circle, color: number, alpha: number) => {
      // 一辺の長さ = 球の直径。前面の半辺 = radius
      const r = circle.radius;
      const dx = circle.x - CUBE_VP_X, dy = circle.y - CUBE_VP_Y;
      // 立方体中心から ±r の奥行による前面/背面のスケール（消失点に向けて収束）
      const fS = CUBE_FOCAL / Math.max(CUBE_FOCAL - r, 1);
      const bS = CUBE_FOCAL / (CUBE_FOCAL + r);
      // 前面中心と半辺
      const fx = CUBE_VP_X + dx * fS, fy = CUBE_VP_Y + dy * fS, fh = r * fS;
      // 背面中心と半辺
      const bx = CUBE_VP_X + dx * bS, by = CUBE_VP_Y + dy * bS, bh = r * bS;

      // 8頂点（F=前面, B=背面, T/B=上/下, L/R=左/右）
      const FTL = { x: fx - fh, y: fy - fh };
      const FTR = { x: fx + fh, y: fy - fh };
      const FBR = { x: fx + fh, y: fy + fh };
      const FBL = { x: fx - fh, y: fy + fh };
      const BTL = { x: bx - bh, y: by - bh };
      const BTR = { x: bx + bh, y: by - bh };
      const BBR = { x: bx + bh, y: by + bh };
      const BBL = { x: bx - bh, y: by + bh };

      // 表示する側面（消失点との位置関係で決定）
      // dx > 0: 立方体は消失点より右 → 世界座標で左側面が見える
      // dy > 0: 立方体は消失点より下 → 上面が見える
      const showLeft = dx > 0;
      const showRight = dx < 0;
      const showTop = dy > 0;
      const showBottom = dy < 0;

      // 光源は右上方向（球の反射位置 (x+0.5r, y-0.5r) と整合）。
      // 右面・上面が明るく、左面・下面が暗い
      graph.lineStyle(1, 0x0, 1);

      // 側面（前面より奥に位置するので先に描画）
      if (showLeft) {
        graph.fillStyle(color, alpha);
        graph.fillPoints([FTL, BTL, BBL, FBL], true);
        graph.fillStyle(0, alpha / 3);
        graph.fillPoints([FTL, BTL, BBL, FBL], true);
        graph.strokePoints([FTL, BTL, BBL, FBL], true);
      }
      if (showRight) {
        graph.fillStyle(color, alpha);
        graph.fillPoints([FTR, BTR, BBR, FBR], true);
        graph.fillStyle(0xFFFFFF, alpha / 3);
        graph.fillPoints([FTR, BTR, BBR, FBR], true);
        graph.strokePoints([FTR, BTR, BBR, FBR], true);
      }
      if (showTop) {
        graph.fillStyle(color, alpha);
        graph.fillPoints([FTL, FTR, BTR, BTL], true);
        graph.fillStyle(0xFFFFFF, alpha / 3);
        graph.fillPoints([FTL, FTR, BTR, BTL], true);
        graph.strokePoints([FTL, FTR, BTR, BTL], true);
      }
      if (showBottom) {
        graph.fillStyle(color, alpha);
        graph.fillPoints([FBL, FBR, BBR, BBL], true);
        graph.fillStyle(0, alpha / 3);
        graph.fillPoints([FBL, FBR, BBR, BBL], true);
        graph.strokePoints([FBL, FBR, BBR, BBL], true);
      }

      // 前面
      graph.fillStyle(color, alpha);
      graph.fillPoints([FTL, FTR, FBR, FBL], true);
      // 前面の光の反射（右上）— 球の楕円ハイライトに対応する短冊
      graph.fillStyle(0xFFFFFF, alpha / 3);
      graph.fillRect(fx + fh * 0.15, fy - fh * 0.75, fh * 0.55, fh * 0.35);
      // 前面の影（左下三角）— 球の左下シャドウ弧に対応
      graph.fillStyle(0, alpha / 5);
      graph.fillPoints([FBL, { x: fx, y: fy + fh }, { x: fx - fh, y: fy }], true);
      graph.strokePoints([FTL, FTR, FBR, FBL], true);
    }

    // 床接地オブジェクト（直方体・円柱・四角錐）共通のパラメータ計算。
    // 球と同じ底面サイズ（半幅 r、奥行半幅 r）で、高さは 2r/3（セル高さ 4r の 1/6、半高 r/3）。
    // 中心 y は床（球の中心より +2r）から半高 r/3 上、つまり球の中心より 5r/3 下にあり、床に接地する。
    const computeFloorObjectFrame = (circle: Phaser.Geom.Circle) => {
      const r = circle.radius;
      const halfW = r, halfH = r / 3;
      const dx = circle.x - CUBE_VP_X, dy = circle.y - CUBE_VP_Y;
      const objDy = dy + (2 * r - halfH);
      const fS = CUBE_FOCAL / Math.max(CUBE_FOCAL - halfW, 1);
      const bS = CUBE_FOCAL / (CUBE_FOCAL + halfW);
      const fx = CUBE_VP_X + dx * fS, bx = CUBE_VP_X + dx * bS;
      const fy_c = CUBE_VP_Y + objDy * fS, by_c = CUBE_VP_Y + objDy * bS;
      const fW = halfW * fS, fH = halfH * fS;
      const bW = halfW * bS, bH = halfH * bS;
      return { r, dx, fx, bx, fy_c, by_c, fW, fH, bW, bH };
    };

    const drawBox = (circle: Phaser.Geom.Circle, color: number, alpha: number) => {
      const { dx, fx, bx, fy_c, by_c, fW, fH, bW, bH } = computeFloorObjectFrame(circle);
      const FTL = { x: fx - fW, y: fy_c - fH }, FTR = { x: fx + fW, y: fy_c - fH };
      const FBR = { x: fx + fW, y: fy_c + fH }, FBL = { x: fx - fW, y: fy_c + fH };
      const BTL = { x: bx - bW, y: by_c - bH }, BTR = { x: bx + bW, y: by_c - bH };
      const BBR = { x: bx + bW, y: by_c + bH }, BBL = { x: bx - bW, y: by_c + bH };
      graph.lineStyle(1, 0x0, 1);
      if (dx > 0) {
        graph.fillStyle(color, alpha); graph.fillPoints([FTL, BTL, BBL, FBL], true);
        graph.fillStyle(0, alpha / 3); graph.fillPoints([FTL, BTL, BBL, FBL], true);
        graph.strokePoints([FTL, BTL, BBL, FBL], true);
      }
      if (dx < 0) {
        graph.fillStyle(color, alpha); graph.fillPoints([FTR, BTR, BBR, FBR], true);
        graph.fillStyle(0xFFFFFF, alpha / 3); graph.fillPoints([FTR, BTR, BBR, FBR], true);
        graph.strokePoints([FTR, BTR, BBR, FBR], true);
      }
      graph.fillStyle(color, alpha); graph.fillPoints([FTL, FTR, BTR, BTL], true);
      graph.fillStyle(0xFFFFFF, alpha / 3); graph.fillPoints([FTL, FTR, BTR, BTL], true);
      graph.strokePoints([FTL, FTR, BTR, BTL], true);
      graph.fillStyle(color, alpha); graph.fillPoints([FTL, FTR, FBR, FBL], true);
      graph.fillStyle(0xFFFFFF, alpha / 5);
      graph.fillRect(fx + fW * 0.1, fy_c - fH * 0.8, fW * 0.5, fH * 0.4);
      graph.fillStyle(0, alpha / 5);
      graph.fillPoints([FBL, { x: fx, y: fy_c + fH }, { x: fx - fW, y: fy_c }], true);
      graph.strokePoints([FTL, FTR, FBR, FBL], true);
    };

    const drawCylinder = (circle: Phaser.Geom.Circle, color: number, alpha: number) => {
      const { fx, bx, fy_c, by_c, fW, fH, bW, bH } = computeFloorObjectFrame(circle);
      // 上面・底面は z 方向の遠近で歪む台形に内接する楕円として描画する
      const topFace = new Phaser.Geom.Polygon([
        fx - fW, fy_c - fH, fx + fW, fy_c - fH,
        bx + bW, by_c - bH, bx - bW, by_c - bH,
      ]);
      const bottomFace = new Phaser.Geom.Polygon([
        fx - fW, fy_c + fH, fx + fW, fy_c + fH,
        bx + bW, by_c + bH, bx - bW, by_c + bH,
      ]);
      const topE = getEllipseFromInscribedQuad(topFace);
      const bottomE = getEllipseFromInscribedQuad(bottomFace);
      if (!topE || !bottomE) return;
      const topEx = getEllipseHorizontalExtremes(topE);
      const bottomEx = getEllipseHorizontalExtremes(bottomE);

      // 1. 底面（塗り + 輪郭）
      drawInscribedEllipse(bottomFace, color, alpha);
      strokeInscribedEllipse(bottomFace, 0x0, 1);

      // 2. 胴体（上面・底面楕円の左右接点を結ぶ4頂点）
      const body = [topEx.left, topEx.right, bottomEx.right, bottomEx.left];
      graph.fillStyle(color, alpha);
      graph.fillPoints(body, true);
      // 左右の辺のみ枠線（上下端は上面・底面の楕円輪郭が担う）
      graph.lineStyle(1, 0x0, 1);
      graph.beginPath().moveTo(topEx.left.x, topEx.left.y).lineTo(bottomEx.left.x, bottomEx.left.y).strokePath();
      graph.beginPath().moveTo(topEx.right.x, topEx.right.y).lineTo(bottomEx.right.x, bottomEx.right.y).strokePath();

      // 3. 上面（塗り + ハイライト + 輪郭）
      drawInscribedEllipse(topFace, 0xFFFFFF, alpha);
      drawInscribedEllipse(topFace, color, alpha / 3);
      strokeInscribedEllipse(topFace, 0x0, 1);
    };

    const drawPyramid = (circle: Phaser.Geom.Circle, color: number, alpha: number) => {
      const { dx, fx, bx, fy_c, by_c, fW, fH, bW, bH } = computeFloorObjectFrame(circle);
      const FBL = { x: fx - fW, y: fy_c + fH };
      const FBR = { x: fx + fW, y: fy_c + fH };
      const BBL = { x: bx - bW, y: by_c + bH };
      const BBR = { x: bx + bW, y: by_c + bH };
      // 頂点は底面中心の真上、床から高さ 2r/3（セル高さ 4r の 1/6）。
      // 球体中心の世界 y を 0、床を +2r とすると、頂点の世界 y = 2r - 2r/3 = 4r/3。
      const apex = { x: circle.x, y: circle.y + (4 / 3) * circle.radius };
      graph.lineStyle(1, 0x0, 1);
      // 頂点がカメラより下にあるため4側面すべての法線がやや上向きとなり常に見える。
      // 描画順は奥から手前：背面 → 視点と反対側の側面 → 視点側の側面 → 前面。
      const drawLeft = () => {
        graph.fillStyle(color, alpha); graph.fillPoints([FBL, BBL, apex], true);
        graph.fillStyle(0, alpha / 3); graph.fillPoints([FBL, BBL, apex], true);
        graph.strokePoints([FBL, BBL, apex], true);
      };
      const drawRight = () => {
        graph.fillStyle(color, alpha); graph.fillPoints([FBR, BBR, apex], true);
        graph.fillStyle(0xFFFFFF, alpha / 3); graph.fillPoints([FBR, BBR, apex], true);
        graph.strokePoints([FBR, BBR, apex], true);
      };
      // 背面三角（最奥）
      graph.fillStyle(color, alpha); graph.fillPoints([BBL, BBR, apex], true);
      graph.fillStyle(0, alpha / 4); graph.fillPoints([BBL, BBR, apex], true);
      graph.strokePoints([BBL, BBR, apex], true);
      // 左右側面（dx の符号で奥行順を入れ替え）
      if (dx >= 0) {
        drawRight();
        drawLeft();
      } else {
        drawLeft();
        drawRight();
      }
      // 前面三角（最手前）
      graph.fillStyle(color, alpha); graph.fillPoints([FBL, FBR, apex], true);
      graph.fillStyle(0xFFFFFF, alpha / 5);
      graph.fillPoints([{ x: (FBR.x + apex.x) / 2, y: (FBR.y + apex.y) / 2 }, FBR, apex], true);
      graph.strokePoints([FBL, FBR, apex], true);
    };

    const VP_X = this.width / 2, VP_Y = this.height / 2;

    // 一点透視で歪んだ四角形に対するインスクライブ楕円の幾何情報を求める。
    //
    // 対辺の中点を結ぶ2本のベクトルを共役半直径 a, b として、
    // 楕円 P(θ) = C + a·cosθ + b·sinθ の主軸を求める。
    // 平行四辺形なら全辺中点がそのまま楕円上に乗る。
    //
    // 主軸計算: M = [a b] (2x2行列) として、対称行列 M·Mᵀ の固有値が
    // 主半軸長の二乗、対応する固有ベクトル方向が主軸の向きとなる。
    type EllipseGeom = { cx: number, cy: number, a: number, b: number, angle: number };
    const getEllipseFromInscribedQuad = (poly: Phaser.Geom.Polygon): EllipseGeom | null => {
      const pts = poly.points;
      if (pts.length < 4) return null;
      let cx = 0, cy = 0;
      for (const p of pts) { cx += p.x; cy += p.y; }
      cx /= pts.length; cy /= pts.length;
      const mids: { x: number, y: number }[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p1 = pts[i], p2 = pts[(i + 1) % pts.length];
        mids.push({ x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 });
      }
      const ax = (mids[2].x - mids[0].x) / 2;
      const ay = (mids[2].y - mids[0].y) / 2;
      const bx = (mids[3].x - mids[1].x) / 2;
      const by = (mids[3].y - mids[1].y) / 2;
      const A = ax * ax + bx * bx;
      const B = ax * ay + bx * by;
      const C = ay * ay + by * by;
      const disc = Math.sqrt(Math.max(0, (A - C) * (A - C) + 4 * B * B));
      const lambda1 = (A + C + disc) / 2;
      const lambda2 = (A + C - disc) / 2;
      const angle = Math.atan2(lambda1 - A, B);
      const a = Math.sqrt(Math.max(0, lambda1));
      const b = Math.sqrt(Math.max(0, lambda2));
      return { cx, cy, a, b, angle };
    };

    const drawInscribedEllipse = (poly: Phaser.Geom.Polygon, color: number, alpha: number) => {
      const e = getEllipseFromInscribedQuad(poly);
      if (!e) return;
      graph.fillStyle(color, alpha);
      graph.translateCanvas(e.cx, e.cy).rotateCanvas(e.angle);
      graph.fillEllipse(0, 0, 2 * e.a, 2 * e.b);
      graph.rotateCanvas(-e.angle).translateCanvas(-e.cx, -e.cy);
    };

    const strokeInscribedEllipse = (poly: Phaser.Geom.Polygon, color: number, alpha: number) => {
      const e = getEllipseFromInscribedQuad(poly);
      if (!e) return;
      graph.lineStyle(1, color, alpha);
      graph.translateCanvas(e.cx, e.cy).rotateCanvas(e.angle);
      graph.strokeEllipse(0, 0, 2 * e.a, 2 * e.b);
      graph.rotateCanvas(-e.angle).translateCanvas(-e.cx, -e.cy);
    };

    // 楕円上で x 座標が極値となる2点（視覚的な左右端）。
    // P(θ) = C + a·cosθ·u + b·sinθ·v（u, v は主軸・副軸の単位ベクトル）として
    // dP_x/dθ = 0 を解くと、d_x = ±√(a²cos²α + b²sin²α)（α は楕円の回転角）。
    // それに対応する y の補正は (a²-b²)·sinα·cosα / d_x。
    const getEllipseHorizontalExtremes = (e: EllipseGeom) => {
      const cosA = Math.cos(e.angle), sinA = Math.sin(e.angle);
      const dx = Math.sqrt(e.a * e.a * cosA * cosA + e.b * e.b * sinA * sinA);
      const dy = dx === 0 ? 0 : (e.a * e.a - e.b * e.b) * sinA * cosA / dx;
      return {
        left: { x: e.cx - dx, y: e.cy - dy },
        right: { x: e.cx + dx, y: e.cy + dy },
      };
    };

    // 床マーカー描画（同心四角 or 同心円）。3箇所で同一処理だったため共通化
    const drawFloorMark = (
      pol: Phaser.Geom.Polygon,
      inner1: Phaser.Geom.Polygon | null,
      inner2: Phaser.Geom.Polygon | null,
      color: number,
      asCircle: boolean,
    ) => {
      graph.lineStyle(1, 0x0, 0.5);
      graph.strokePoints(pol.points, true);
      if (!asCircle) {
        // 対角線（X 字）— 同心四角モードでのみ意味があるので円モードでは描かない
        graph.strokePoints([pol.points[0], pol.points[2]], true);
        graph.strokePoints([pol.points[1], pol.points[3]], true);
      }
      graph.lineStyle(1, 0x0, 1);
      // 一番外側はセルからはみ出すため、円モードでも polygon で塗る
      graph.fillStyle(color, 0.3);
      graph.fillPoints(pol.points, true);
      if (asCircle) {
        if (inner1) drawInscribedEllipse(inner1, color, 0.6);
        if (inner2) drawInscribedEllipse(inner2, color, 1);
      } else {
        if (inner1) {
          graph.fillStyle(color, 0.6);
          graph.fillPoints(inner1.points, true);
        }
        if (inner2) {
          graph.fillStyle(color, 1);
          graph.fillPoints(inner2.points, true);
        }
      }
    };

    // プレイヤー向き回転量: EAST=1, SOUTH=2, WEST=3, NORTH=0
    // originalDir = (rotatedDir + shift) % 4
    const shift = (player.direction + 1) % 4;
    const isDoorOpen = (cellX: integer, cellY: integer, rotatedDoorDir: number): boolean => {
      if (!openDoors) return false;
      const originalDir = (rotatedDoorDir + shift) % 4;
      return openDoors.has(`${cellX},${cellY},${originalDir}`);
    };
    // 隠し扉（壁に偽装中）の判定
    const isDoorDisguised = (cellX: integer, cellY: integer, rotatedDoorDir: number): boolean => {
      const originalDir = (rotatedDoorDir + shift) % 4;
      return dun.isDisguisedDoor(cellX, cellY, originalDir as MapDirection);
    };

    const DOOR_COLOR = 0xA0522D;
    // ポリゴンの4頂点から透視補間関数を生成する（側壁は調和平均ベース）
    const makeBpPersp = (pol: Phaser.Geom.Polygon) => {
      const sorted = [...pol.points].sort((a, b) => a.y - b.y);
      const [tl, tr] = sorted.slice(0, 2).sort((a, b) => a.x - b.x);
      const [bl, br] = sorted.slice(2).sort((a, b) => a.x - b.x);
      const bp = (u: number, v: number) => ({
        x: (1 - u) * (1 - v) * bl.x + u * (1 - v) * br.x + (1 - u) * v * tl.x + u * v * tr.x,
        y: (1 - u) * (1 - v) * bl.y + u * (1 - v) * br.y + (1 - u) * v * tl.y + u * v * tr.y,
      });
      const isLateralWall = Math.abs(tl.y - tr.y) > 0.1;
      const perspOff = (u: number, A: number, B: number) => A * B / ((1 - u) * B + u * A);
      return (u: number, v: number) => {
        if (!isLateralWall) return bp(u, v);
        const xOff = perspOff(u, tl.x - VP_X, tr.x - VP_X);
        const ytOff = perspOff(u, tl.y - VP_Y, tr.y - VP_Y);
        const ybOff = perspOff(u, bl.y - VP_Y, br.y - VP_Y);
        return { x: VP_X + xOff, y: VP_Y + (1 - v) * ybOff + v * ytOff };
      };
    };

    const drawDoor = (pol: Phaser.Geom.Polygon) => {
      // 半透明ベース（全面）
      graph.fillStyle(DOOR_COLOR, 0.5);
      graph.fillPoints(pol.points, true);
      const bpPersp = makeBpPersp(pol);
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

    // 開放扉：窓領域（wl〜wr）を上下端まで透過、左右柱を DOOR_COLOR 不透明で塗る
    const drawOpenDoor = (pol: Phaser.Geom.Polygon) => {
      const bpPersp = makeBpPersp(pol);
      const wl = 0.15, wr = 0.85;
      graph.fillStyle(DOOR_COLOR, 1.0);
      graph.fillPoints([bpPersp(0, 0), bpPersp(wl, 0), bpPersp(wl, 1), bpPersp(0, 1)], true);
      graph.fillPoints([bpPersp(wr, 0), bpPersp(1, 0), bpPersp(1, 1), bpPersp(wr, 1)], true);
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
            const hasDoor = !!(blockList[i][order][0] & (8 << 4)) && !isDoorDisguised(blockList[i][order][1], blockList[i][order][2], 3);
            const isOpenDoor = hasDoor && isDoorOpen(blockList[i][order][1], blockList[i][order][2], 3);
            if (isOpenDoor) {
              drawOpenDoor(pol);
            } else {
              graph.strokePoints(pol.points, true)
              if (hasDoor) {
                drawDoor(pol);
              } else {
                graph.fillStyle(0xFFFFFF);
                graph.fillPoints(pol.points, true);
              }
            }
          }
        }
        if ((blockList[i][order][0] & 1) && this.polygonList[RANGE - i][order][1]) {
          const pol = this.polygonList[RANGE - i][order][1];
          if (pol) {
            const hasDoor = !!(blockList[i][order][0] & (1 << 4)) && !isDoorDisguised(blockList[i][order][1], blockList[i][order][2], 0);
            const isOpenDoor = hasDoor && isDoorOpen(blockList[i][order][1], blockList[i][order][2], 0);
            if (isOpenDoor) {
              drawOpenDoor(pol);
            } else {
              graph.strokePoints(pol.points, true)
              if (hasDoor) {
                drawDoor(pol);
              } else {
                graph.fillStyle(0xFFFFFF);
                graph.fillPoints(pol.points, true);
              }
            }
          }
        }
        for (const object of dun.getObject(blockList[i][order][1], blockList[i][order][2])) {
          if (!object.visible) {
            continue;
          }

          const pol = this.polygonList[RANGE - i][order][2];
          if (pol) {
            const inner1 = this.floorInner1List[RANGE - i][order];
            const inner2 = this.floorInner2List[RANGE - i][order];
            drawFloorMark(pol, inner1, inner2, object.color, object.concentricCircle);
            const center = this.centerList[RANGE - i][order];
            if (object.shape === MapShape.SPHERE && center) {
              drawSphere(center, object.alpha);
            } else if (object.shape === MapShape.CUBE && center) {
              drawCube(center, object.color, object.alpha);
            } else if (object.shape === MapShape.BOX && center) {
              drawBox(center, object.color, object.alpha);
            } else if (object.shape === MapShape.CYLINDER && center) {
              drawCylinder(center, object.color, object.alpha);
            } else if (object.shape === MapShape.PYRAMID && center) {
              drawPyramid(center, object.color, object.alpha);
            }
          }
        }

        // 左側
        if ((blockList[i][order + 1][0] & 8) && this.polygonList[RANGE - i][order + 1][0]) {
          const pol = this.polygonList[RANGE - i][order + 1][0];
          if (pol) {
            const hasDoor = !!(blockList[i][order + 1][0] & (8 << 4)) && !isDoorDisguised(blockList[i][order + 1][1], blockList[i][order + 1][2], 3);
            const isOpenDoor = hasDoor && isDoorOpen(blockList[i][order + 1][1], blockList[i][order + 1][2], 3);
            if (isOpenDoor) {
              drawOpenDoor(pol);
            } else {
              graph.strokePoints(pol.points, true)
              if (hasDoor) {
                drawDoor(pol);
              } else {
                graph.fillStyle(0xFFFFFF);
                graph.fillPoints(pol.points, true);
              }
            }
          }
        }
        if ((blockList[i][order + 1][0] & 4) && this.polygonList[RANGE - i][order + 1][1]) {
          const pol = this.polygonList[RANGE - i][order + 1][1];
          if (pol) {
            const hasDoor = !!(blockList[i][order + 1][0] & (4 << 4)) && !isDoorDisguised(blockList[i][order + 1][1], blockList[i][order + 1][2], 2);
            const isOpenDoor = hasDoor && isDoorOpen(blockList[i][order + 1][1], blockList[i][order + 1][2], 2);
            if (isOpenDoor) {
              drawOpenDoor(pol);
            } else {
              graph.strokePoints(pol.points, true)
              if (hasDoor) {
                drawDoor(pol);
              } else {
                graph.fillStyle(0xFFFFFF);
                graph.fillPoints(pol.points, true);
              }
            }
          }
        }
        for (const object of dun.getObject(blockList[i][order + 1][1], blockList[i][order + 1][2])) {
          if (!object.visible) {
            continue;
          }

          const pol = this.polygonList[RANGE - i][order + 1][2];
          if (pol) {
            const inner1 = this.floorInner1List[RANGE - i][order + 1];
            const inner2 = this.floorInner2List[RANGE - i][order + 1];
            drawFloorMark(pol, inner1, inner2, object.color, object.concentricCircle);
            const center = this.centerList[RANGE - i][order + 1];
            if (object.shape === MapShape.SPHERE && center) {
              drawSphere(center, object.alpha);
            } else if (object.shape === MapShape.CUBE && center) {
              drawCube(center, object.color, object.alpha);
            } else if (object.shape === MapShape.BOX && center) {
              drawBox(center, object.color, object.alpha);
            } else if (object.shape === MapShape.CYLINDER && center) {
              drawCylinder(center, object.color, object.alpha);
            } else if (object.shape === MapShape.PYRAMID && center) {
              drawPyramid(center, object.color, object.alpha);
            }
          }
        }
      }

      // 真ん中
      // graph.lineStyle(2, 0);
      if ((blockList[i][0][0] & 1) && this.polygonList[RANGE - i][0][0]) {
        const pol = this.polygonList[RANGE - i][0][0];
        if (pol) {
          const hasDoor = !!(blockList[i][0][0] & (1 << 4)) && !isDoorDisguised(blockList[i][0][1], blockList[i][0][2], 0);
          const isOpenDoor = hasDoor && isDoorOpen(blockList[i][0][1], blockList[i][0][2], 0);
          if (isOpenDoor) {
            drawOpenDoor(pol);
          } else {
            graph.strokePoints(pol.points, true)
            if (hasDoor) {
              drawDoor(pol);
            } else {
              graph.fillStyle(0xFFFFFF);
              graph.fillPoints(pol.points, true);
            }
          }
        }
      }
      if ((blockList[i][0][0] & 4) && this.polygonList[RANGE - i][0][1]) {
        const pol = this.polygonList[RANGE - i][0][1];
        if (pol) {
          const hasDoor = !!(blockList[i][0][0] & (4 << 4)) && !isDoorDisguised(blockList[i][0][1], blockList[i][0][2], 2);
          const isOpenDoor = hasDoor && isDoorOpen(blockList[i][0][1], blockList[i][0][2], 2);
          if (isOpenDoor) {
            drawOpenDoor(pol);
          } else {
            graph.strokePoints(pol.points, true)
            if (hasDoor) {
              drawDoor(pol);
            } else {
              graph.fillStyle(0xFFFFFF);
              graph.fillPoints(pol.points, true);
            }
          }
        }
      }
      if ((blockList[i][0][0] & 8) && this.polygonList[RANGE - i][0][3]) {
        const pol = this.polygonList[RANGE - i][0][3];
        if (pol) {
          const hasDoor = !!(blockList[i][0][0] & (8 << 4)) && !isDoorDisguised(blockList[i][0][1], blockList[i][0][2], 3);
          const isOpenDoor = hasDoor && isDoorOpen(blockList[i][0][1], blockList[i][0][2], 3);
          if (isOpenDoor) {
            drawOpenDoor(pol);
          } else {
            graph.strokePoints(pol.points, true)
            if (hasDoor) {
              drawDoor(pol);
            } else {
              graph.fillStyle(0xFFFFFF);
              graph.fillPoints(pol.points, true);
            }
          }
        }
      }
      for (const object of dun.getObject(blockList[i][0][1], blockList[i][0][2])) {
        if (!object.visible) {
          continue;
        }

        const pol = this.polygonList[RANGE - i][0][2];
        if (pol) {
          const inner1 = this.floorInner1List[RANGE - i][0];
          const inner2 = this.floorInner2List[RANGE - i][0];
          drawFloorMark(pol, inner1, inner2, object.color, object.concentricCircle);
          const center = this.centerList[RANGE - i][0];
          if (object.shape === MapShape.SPHERE && center) {
            drawSphere(center, object.alpha);
          } else if (object.shape === MapShape.CUBE && center) {
            drawCube(center, object.color, object.alpha);
          } else if (object.shape === MapShape.BOX && center) {
            drawBox(center, object.color, object.alpha);
          } else if (object.shape === MapShape.CYLINDER && center) {
            drawCylinder(center, object.color, object.alpha);
          } else if (object.shape === MapShape.PYRAMID && center) {
            drawPyramid(center, object.color, object.alpha);
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
