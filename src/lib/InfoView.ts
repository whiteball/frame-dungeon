export class InfoView {
  private factory: Phaser.GameObjects.GameObjectFactory;
  private graph: Phaser.GameObjects.Graphics;

  private width: integer;
  private height: integer;

  private fontFamily: string;

  floorText: Phaser.GameObjects.Text;

  private textLabelList: Phaser.GameObjects.Text[];
  private textValueList: Phaser.GameObjects.Text[];

  /**
   * 情報表示ビューを初期化する
   * @param factory Phaserのゲームオブジェクトファクトリー
   * @param x 描画開始X座標
   * @param y 描画開始Y座標
   * @param width 情報パネルの幅
   * @param height 情報パネルの高さ
   * @param fontFamily 使用するフォントファミリー（デフォルト: BIZ UDゴシック）
   */
  constructor(factory: Phaser.GameObjects.GameObjectFactory, x: integer, y: integer, width: integer, height: integer, fontFamily = '\'BIZ UDゴシック\', Consolas, monospace') {

    this.factory = factory;
    this.graph = factory.graphics({
      lineStyle: { width: 1, color: 0xFFFFFF, alpha: 1 },
      fillStyle: { color: 0, alpha: 1 },
      x: x,
      y: y,
    }).setDepth(0);
    this.width = width;
    this.height = height;
    this.fontFamily = fontFamily;

    this.floorText = factory.text(x, y, '-F').setFontFamily(fontFamily).setDepth(10);

    this.textLabelList = [];
    this.textValueList = [];
  }

  /**
   * 情報パネルをレンダリングする
   * フロア番号とゲーム情報を表示する
   * @param floor 現在のフロア番号
   * @param info 表示するゲーム情報のMap（ラベルと値のペア）
   */
  render(floor: number, info: Map<string, number | string>) {
    const graph = this.graph;
    graph.fillRect(0, 0, this.width, this.height);

    this.floorText.setText(floor + 'F');
    graph.lineBetween(0, this.floorText.height + 2, this.width, this.floorText.height + 2);
    graph.lineBetween(0, this.floorText.height + 4, this.width, this.floorText.height + 4);
    let cur = 0, y = this.floorText.height + 7;
    info.forEach((value, key) => {
      if (!this.textLabelList[cur]) {
        this.textLabelList[cur] = this.factory.text(this.graph.x, this.graph.y + y, '').setFontFamily(this.fontFamily).setDepth(10);
      }
      this.textLabelList[cur].setText(key);
      if (!this.textValueList[cur]) {
        this.textValueList[cur] = this.factory.text(this.graph.x, this.graph.y + y, '').setFontFamily(this.fontFamily).setDepth(10);
      }
      this.textValueList[cur].setText(value.toString()).setX(this.graph.x + this.width - this.textValueList[cur].width);

      y += Math.max(this.textLabelList[cur].height, this.textValueList[cur].height);
      graph.lineBetween(0, y + 3, this.width, y + 3);
      cur++;
      y += 8;
    })
    for (let i = cur; i < this.textLabelList.length; i++) {
      this.textLabelList[i].setText('');
      this.textValueList[i].setText('');
    }
  }
}