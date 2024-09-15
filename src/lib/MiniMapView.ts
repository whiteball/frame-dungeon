import { DungeonMap, MapDirection } from './MapGenerator';

export class MiniMapView {
  private graph: Phaser.GameObjects.Graphics;

  private width: integer;
  private height: integer;

  constructor(factory: Phaser.GameObjects.GameObjectFactory, x: integer, y: integer, width: integer, height: integer) {
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

  render(dun: DungeonMap) {
    const graph = this.graph;

    graph.lineStyle(2, 0xCCCCCC);
    graph.fillStyle(0x0);
    const WIDTH = this.width, HEIGHT = this.height;
    const rect = new Phaser.Geom.Rectangle(0, 0, WIDTH, HEIGHT);
    const blockWidth = (WIDTH / dun.getWidth()), blockHeight = (HEIGHT / dun.getHeight());
    graph.fillRectShape(rect);

    // マス描画
    graph.fillStyle(0xCCCCCC);
    for (const block of dun.mapIterator()) {
      const baseX = (block.x - 1) * blockWidth, baseY = (block.y - 1) * blockHeight;
      graph.lineStyle(2, 0xCCCCCC);

      if (!block.enter || block.fog === 1) {
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
        switch (object.mark) {
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
    const baseX = (playerPos.x - 1) * blockWidth + blockWidth / 5, baseY = (playerPos.y - 1) * blockHeight + blockHeight / 5;
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
}