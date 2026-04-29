'use strict'

/**
 * パラメータが増減したときにログに表示するメッセージを生成する
 * 
 * @param stat パラメータ名
 * @param delta 増減値
 * @returns 
 */
export function makeStatFluctuatedMessage(stat: string, delta: number): string {
  const sign = delta >= 0 ? '増加' : '減少';
  return `${stat} が ${Math.abs(delta)} ${sign}した`;
}