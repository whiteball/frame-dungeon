'use strict';

/**
 * 矩形領域を表すクラス
 * 部屋・通路の位置とサイズを保持する
 */
export class Rect {
  public x1: integer;
  public x2: integer;
  public y1: integer;
  public y2: integer;
  constructor(x1: integer | Rect, y1: integer = 0, x2: integer = 0, y2: integer = 0) {
    if (x1 instanceof Rect) {
      this.x1 = x1.x1;
      this.y1 = x1.y1;
      this.x2 = x1.x2;
      this.y2 = x1.y2;
      return
    }
    this.x1 = x1;
    this.y1 = y1;
    this.x2 = x2;
    this.y2 = y2;
  }

  /**
   * 指定した矩形と一辺が完全に一致しているか判定する
   * @param rect 判定する矩形
   * @returns 一辺が完全に一致している場合true
   */
  isContact(rect: Rect) {
    if (rect.y1 === this.y1 && rect.y2 === this.y2 && rect.x2 === this.x1 + 1) {
      return true;
    }

    if (rect.x1 === this.x1 && rect.x2 === this.x2 && rect.y1 === this.y2 + 1) {
      return true;
    }

    if (rect.y1 === this.y1 && rect.y2 === this.y2 && rect.x2 + 1 === this.x1) {
      return true;
    }

    if (rect.x1 === this.x1 && rect.x2 === this.x2 && rect.y2 + 1 === this.y1) {
      return true;
    }

    return false;
  }
}
