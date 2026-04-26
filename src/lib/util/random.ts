'use strict';

/**
 * 指定した範囲内のランダムな整数を生成する
 * @param min 最小値（含む）
 * @param max 最大値（含まない）
 * @returns 生成されたランダムな整数
 */
export function getRandomInt(min: integer, max: integer): integer {
  min = Math.ceil(min);
  max = Math.floor(max);
  return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

/**
 * Fisher-Yatesアルゴリズムを使用して配列をシャッフルする
 * @param array シャッフルする配列
 * @returns シャッフルされた配列
 * @see https://ja.wikipedia.org/wiki/%E3%83%95%E3%82%A3%E3%83%83%E3%82%B7%E3%83%A3%E3%83%BC%E2%80%93%E3%82%A4%E3%82%A7%E3%83%BC%E3%83%84%E3%81%AE%E3%82%B7%E3%83%A3%E3%83%83%E3%83%95%E3%83%AB
 */
export function arrayShuffle<T>(array: Array<T>): Array<T> {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}
