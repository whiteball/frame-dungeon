import { DungeonMap } from './MapGenerator';
import { MapDirection } from './map/MapDirection';
import { MapMark, MapObject } from './MapObject';

export class MiniMapView {
  private graph: Phaser.GameObjects.Graphics;

  private width: integer;
  private height: integer;

  private fullMapMode: boolean;

  private moveMode = false;
  private moveOffsetX = 0;
  private moveOffsetY = 0;

  /**
   * ミニマップビューを初期化する
   * @param factory Phaserのゲームオブジェクトファクトリー
   * @param x 描画開始X座標
   * @param y 描画開始Y座標
   * @param width ミニマップの幅
   * @param height ミニマップの高さ
   * @param initialFullMapMode 初期表示モード（省略時はプレイヤー周囲のみ）
   */
  constructor(factory: Phaser.GameObjects.GameObjectFactory, x: integer, y: integer, width: integer, height: integer, initialFullMapMode: boolean = false) {
    this.fullMapMode = initialFullMapMode;
    const mask = factory.graphics({ fillStyle: { color: 0xffffff, alpha: 0 } });
    mask.fillRect(x - 1, y - 1, width + 2, height + 2);

    this.graph = factory.graphics({
      lineStyle: { width: 4, color: 0xCCCCCC, alpha: 1 },
      fillStyle: { color: 0, alpha: 1 },
      x: x,
      y: y,
    }).setMask(mask.createGeometryMask());
    this.width = width;
    this.height = height;
  }

  /**
   * ダンジョンマップを俯瞰図でレンダリングする
   * 探索済みエリア、壁、扉、オブジェクト、プレイヤーの位置を表示する
   * @param dun レンダリングするダンジョンマップ
   */
  render(dun: DungeonMap, revealAll = false) {
    const graph = this.graph;
    graph.clear();

    graph.lineStyle(2, 0xDDDDDD);
    graph.fillStyle(0x787878);
    const around = this.fullMapMode ? 0 : dun.getViewRange() + 1;
    const WIDTH = this.width, HEIGHT = this.height;
    const rect = new Phaser.Geom.Rectangle(0, 0, WIDTH, HEIGHT);
    const maxLength = around === 0 ? Math.max(dun.getWidth(), dun.getHeight()) : around * 2 + 1;
    const blockWidth = (WIDTH / maxLength), blockHeight = (HEIGHT / maxLength);
    graph.fillRectShape(rect);

    const enemySet = new Set<MapObject>(dun.getEnemies());

    // 左上に描画するマスのマップ上の座標
    const origin: [number | undefined, number | undefined] = [undefined, undefined];

    const centerOverride = (this.moveMode && !this.fullMapMode)
      ? { x: dun.getPlayerPos().x + this.moveOffsetX, y: dun.getPlayerPos().y + this.moveOffsetY }
      : undefined;

    // マス描画
    for (const block of dun.mapIterator(around, false, centerOverride)) {
      if (origin[0] === undefined) origin[0] = block.x;
      if (origin[1] === undefined) origin[1] = block.y;
      const baseX = (block.x - origin[0]) * blockWidth, baseY = (block.y - origin[1]) * blockHeight;

      if (!block.enter || block.fog === 1) {
        continue;
      }

      if (block.walked === 1) {
        graph.fillStyle(0x3333FF);
        graph.fillRect(baseX, baseY, blockWidth, blockHeight);
      } else {
        graph.fillStyle(0x0);
        graph.fillRect(baseX, baseY, blockWidth, blockHeight);
      }

      graph.lineStyle(2, 0xDDDDDD);
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
      // 隠し扉は壁として描画済みなので扉線をスキップする
      if (block.wallState.door[MapDirection.EAST] && !dun.isDisguisedDoor(block.x, block.y, MapDirection.EAST)) {
        graph.lineBetween(baseX + blockWidth, baseY, baseX + blockWidth, baseY + blockHeight)
        graph.lineBetween(baseX + blockWidth - blockWidth / 6, baseY + blockHeight / 2, baseX + blockWidth, baseY + blockHeight / 2)
      }
      if (block.wallState.door[MapDirection.SOUTH] && !dun.isDisguisedDoor(block.x, block.y, MapDirection.SOUTH)) {
        graph.lineBetween(baseX, baseY + blockHeight, baseX + blockWidth, baseY + blockHeight)
        graph.lineBetween(baseX + blockWidth / 2, baseY + blockHeight - blockHeight / 6, baseX + blockWidth / 2, baseY + blockHeight)
      }
      if (block.wallState.door[MapDirection.WEST] && !dun.isDisguisedDoor(block.x, block.y, MapDirection.WEST)) {
        graph.lineBetween(baseX, baseY, baseX, baseY + blockHeight)
        graph.lineBetween(baseX, baseY + blockHeight / 2, baseX + blockWidth / 6, baseY + blockHeight / 2)
      }
      if (block.wallState.door[MapDirection.NORTH] && !dun.isDisguisedDoor(block.x, block.y, MapDirection.NORTH)) {
        graph.lineBetween(baseX, baseY, baseX + blockWidth, baseY)
        graph.lineBetween(baseX + blockWidth / 2, baseY, baseX + blockWidth / 2, baseY + blockHeight / 6)
      }

      for (const object of dun.getObject(block.x, block.y)) {
        if (!object.visible) {
          continue;
        }
        if (!revealAll && enemySet.has(object) && block.inView === 0) {
          continue;
        }

        graph.fillStyle(object.color, object.alpha);
        graph.lineStyle(1, 0xFFFFFF);
        switch (object.mark) {
          case MapMark.CIRCLE:
            graph.fillCircle(baseX + blockWidth / 2, baseY + blockWidth / 2, blockWidth / 3 - 1);
            graph.strokeCircle(baseX + blockWidth / 2, baseY + blockWidth / 2, blockWidth / 3 - 1);
            break;
          case MapMark.STAR:
            {
              const r = blockWidth * 4 / 5 / 3;
              graph.translateCanvas(baseX + blockWidth / 2, baseY + blockWidth / 2)
                .beginPath()
                .moveTo(r * Math.cos(Math.PI * 0 / 5 - Math.PI / 10), r * Math.sin(Math.PI * 0 / 5 - Math.PI / 10));
              for (let i = 1; i < 10; i++) {
                if (i % 2 === 1) {
                  graph.lineTo(r / 2 * Math.cos(Math.PI * i / 5 - Math.PI / 10), r / 2 * Math.sin(Math.PI * i / 5 - Math.PI / 10));
                } else {
                  graph.lineTo(r * Math.cos(Math.PI * i / 5 - Math.PI / 10), r * Math.sin(Math.PI * i / 5 - Math.PI / 10));
                }
              }
              graph.closePath().fill().stroke()
                .translateCanvas(-baseX - blockWidth / 2, -baseY - blockWidth / 2)
            }
            break;
          case MapMark.DIAMOND:
            graph.translateCanvas(baseX + blockWidth / 2, baseY + blockWidth / 2)
              .rotateCanvas(Math.PI / 4)
              .fillRect(-blockWidth / 4, -blockWidth / 4, blockWidth / 2 - 1, blockWidth / 2 - 1)
              .strokeRect(-blockWidth / 4, -blockWidth / 4, blockWidth / 2 - 1, blockWidth / 2 - 1)
              .rotateCanvas(-Math.PI / 4)
              .translateCanvas(-baseX - blockWidth / 2, -baseY - blockWidth / 2);
            break;
          case MapMark.CROSS:
            {
              const r = blockWidth * 4 / 5 / 3;
              graph.translateCanvas(baseX + blockWidth / 2, baseY + blockWidth / 2)
                .beginPath()
                .moveTo(r * Math.cos(Math.PI * 0 / 2 - Math.PI / 10), r * Math.sin(Math.PI * 0 / 2 - Math.PI / 10));
              for (let i = 0; i < 4; i++) {
                graph.lineTo(r * Math.cos(Math.PI * i / 2 + Math.PI / 10), r * Math.sin(Math.PI * i / 2 + Math.PI / 10));
                graph.lineTo(r / 3 * Math.cos(Math.PI * (i + 1) / 2 - Math.PI / 4), r / 3 * Math.sin(Math.PI * (i + 1) / 2 - Math.PI / 4));
                graph.lineTo(r * Math.cos(Math.PI * (i + 1) / 2 - Math.PI / 10), r * Math.sin(Math.PI * (i + 1) / 2 - Math.PI / 10));
              }
              graph.closePath().fill().stroke()
                .translateCanvas(-baseX - blockWidth / 2, -baseY - blockWidth / 2)
            }
            break;
          case MapMark.X_CROSS:
            {
              const r = blockWidth * 4 / 5 / 3;
              graph.translateCanvas(baseX + blockWidth / 2, baseY + blockWidth / 2).rotateCanvas(Math.PI / 4)
                .beginPath()
                .moveTo(r * Math.cos(Math.PI * 0 / 2 - Math.PI / 10), r * Math.sin(Math.PI * 0 / 2 - Math.PI / 10));
              for (let i = 0; i < 4; i++) {
                graph.lineTo(r * Math.cos(Math.PI * i / 2 + Math.PI / 10), r * Math.sin(Math.PI * i / 2 + Math.PI / 10));
                graph.lineTo(r / 3 * Math.cos(Math.PI * (i + 1) / 2 - Math.PI / 4), r / 3 * Math.sin(Math.PI * (i + 1) / 2 - Math.PI / 4));
                graph.lineTo(r * Math.cos(Math.PI * (i + 1) / 2 - Math.PI / 10), r * Math.sin(Math.PI * (i + 1) / 2 - Math.PI / 10));
              }
              graph.closePath().fill().stroke()
                .rotateCanvas(-Math.PI / 4).translateCanvas(-baseX - blockWidth / 2, -baseY - blockWidth / 2)
            }
            break;
          default:
            graph.fillRect(baseX + blockWidth / 5, baseY + blockWidth / 5, blockWidth * 3 / 5, blockWidth * 3 / 5)
              .strokeRect(baseX + blockWidth / 5, baseY + blockWidth / 5, blockWidth * 3 / 5, blockWidth * 3 / 5);
            break;
        }
      }

      if (!revealAll && block.fog === 0 && block.inView === 0) {
        graph.fillStyle(0xFFFFFF, 0.2);
        graph.fillRect(baseX, baseY, blockWidth, blockHeight);
      }
    }

    graph.lineStyle(4, 0xFFFFFF);
    graph.strokeRectShape(rect);

    // プレイヤー描画
    graph.lineStyle(1, 0xFFFFFF);
    graph.fillStyle(0xFFFFFF);
    const playerPos = dun.getPlayerPos();
    const baseX = (playerPos.x - (origin[0] ?? 1)) * blockWidth + blockWidth / 5, baseY = (playerPos.y - (origin[1] ?? 1)) * blockHeight + blockHeight / 5;
    const playerWidth = blockWidth - blockWidth / 5 * 2, playerHeight = blockHeight - blockHeight / 5 * 2;
    let tri: Phaser.Geom.Triangle;
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

  public enterMoveMode(initialOffsetX = 0, initialOffsetY = 0): void {
    this.moveMode = true;
    this.moveOffsetX = initialOffsetX;
    this.moveOffsetY = initialOffsetY;
  }

  public exitMoveMode(): void {
    this.moveMode = false;
    this.moveOffsetX = 0;
    this.moveOffsetY = 0;
  }

  public isMoveMode(): boolean {
    return this.moveMode;
  }

  public scroll(dx: number, dy: number, dun: DungeonMap): void {
    const {x: px, y: py} = dun.getPlayerPos();
    this.moveOffsetX = Math.max(1 - px, Math.min(dun.getWidth() - px, this.moveOffsetX + dx));
    this.moveOffsetY = Math.max(1 - py, Math.min(dun.getHeight() - py, this.moveOffsetY + dy));
  }

  public toggleMapMode() {
    return this.fullMapMode = !this.fullMapMode;
  }

  public getFullMapMode(): boolean {
    return this.fullMapMode;
  }
}