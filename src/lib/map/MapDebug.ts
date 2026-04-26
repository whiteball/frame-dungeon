'use strict';

/**
 * デバッグ用にマップの状態をコンソールに出力する。
 *
 * 1次元の壁ビット配列（パディング込みの width × height）を受け取り、
 * Box-drawing 文字を使ってグリッド形式で console.log する。
 *
 * @param map パディング込みの 1次元壁配列
 * @param width パディング込みの行幅（DungeonMap._width と同じ）
 * @param player プレイヤー位置と向き（東=0, 南=1, 西=2, 北=3）
 * @param doorOff trueの場合、扉ビット（上位4bit）をマスクして表示しない
 */
export function dumpDungeon(
  map: integer[],
  width: integer,
  player: { x: integer, y: integer, direction: integer },
  doorOff = false,
): void {
  let buffer = '';
  const bias = doorOff ? 15 : -1;
  const playerPos = player.y * width + player.x;
  for (let i = 0; i < map.length; i++) {
    if (i === playerPos) {
      switch (player.direction) {
        case 0:
          buffer += '→';
          break;
        case 1:
          buffer += '↓';
          break;
        case 2:
          buffer += '←';
          break;
        case 3:
          buffer += '↑';
          break;
      }
      continue;
    }
    switch (map[i] & bias) {
      case -1 & bias:
        buffer += '☆';
        break;
      case 1:
        buffer += '┤';
        break;
      case 2:
        buffer += '┴';
        break;
      case 3:
        buffer += '┘';
        break;
      case 4:
        buffer += '├';
        break;
      case 5:
        buffer += '||';
        break;
      case 6:
        buffer += '└';
        break;
      case 7:
        buffer += '┻';
        break;
      case 8:
        buffer += '┬';
        break;
      case 9:
        buffer += '┐';
        break;
      case 10:
        buffer += '＝';
        break;
      case 11:
        buffer += '┫';
        break;
      case 12:
        buffer += '┌';
        break;
      case 13:
        buffer += '┳';
        break;
      case 14:
        buffer += '┣';
        break;
      case 15:
        buffer += '□';
        break;
      default:
        if (16 <= map[i] && map[i] <= 255) {
          buffer += '扉';
        } else {
          buffer += '　';
        }
        break;
    }
    if ((i + 1) % width === 0) {
      buffer += '\n';
    }
  }
  console.log(buffer);
}
