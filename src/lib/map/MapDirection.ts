'use strict';

import { getRandomInt } from '../util/random';

/** マップ上の方向を表す定数（東=0, 南=1, 西=2, 北=3） */
export const MapDirection = {
  EAST: 0,
  SOUTH: 1,
  WEST: 2,
  NORTH: 3,
} as const;
export type MapDirection = typeof MapDirection[keyof typeof MapDirection]

/**
 * ランダムな方向を取得する
 * @returns ランダムに選択された方向
 */
export const getRandomDirection = (): MapDirection => {
  switch (getRandomInt(0, 4)) {
    case 0:
      return MapDirection.EAST;
    case 1:
      return MapDirection.SOUTH;
    case 2:
      return MapDirection.WEST;
    case 3:
      return MapDirection.NORTH;
  }

  return MapDirection.EAST;
}

/**
 * 指定した方向を時計回りに回転させる
 * @param direction 回転させる元の方向
 * @param value 回転量（1=90度時計回り）
 * @returns 回転後の方向
 */
export const rotateDirection = (direction: MapDirection, value: number) => {
  switch ((Number(direction) + value) % 4) {
    case 0:
      return MapDirection.EAST;
    case 1:
      return MapDirection.SOUTH;
    case 2:
      return MapDirection.WEST;
    case 3:
      return MapDirection.NORTH;
  }

  console.error('rotateDirection');
  return direction;
}
