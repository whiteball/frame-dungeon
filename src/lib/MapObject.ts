'use strict';

/**
 * オブジェクトのイベント
 * @param dungeon ダンジョンマップ
 * @param object マップオブジェクト
 * @returns falseの場合、このマップオブジェクトを破棄する
 */
export type ObjectEvent = (dungeon: any, object: MapObject) => boolean;

/** マップオブジェクトの表示マーク定数 */
export const MapMark = {
  /** 丸（デフォルト） */
  CIRCLE: 'o',
  /** 星形 */
  STAR: '*',
  /** ダイアモンド形 */
  DIAMOND: '<>',
  /** 十字形 */
  CROSS: '+',
  /** 斜め十字形 */
  X_CROSS: 'x',
} as const;
export type MapMark = typeof MapMark[keyof typeof MapMark];

export class MapObject {
  public mark: MapMark | string = MapMark.CIRCLE;
  public color: integer = 0xFFFFFF;
  public alpha: integer = 1;
  public events: Map<string, ObjectEvent> = new Map<string, ObjectEvent>();
  public x: integer = -1;
  public y: integer = -1;
  public sphere: boolean = false;
  public visible: boolean = true;
}

export function newMapEvent(eventName: string, event: ObjectEvent, parent?: Map<string, ObjectEvent>) {
  if (!parent) {
    parent = new Map<string, ObjectEvent>();
  }
  parent.set(eventName, event);
  return parent;
}
