import type { Item } from './Item';

const SLOT_LABELS: Array<{ key: 'weapon' | 'mainArmor' | 'subArmor1' | 'subArmor2'; label: string }> = [
  { key: 'weapon', label: '武' },
  { key: 'mainArmor', label: '主' },
  { key: 'subArmor1', label: '副1' },
  { key: 'subArmor2', label: '副2' },
];

export interface EquippedSnapshot {
  weapon: Item | null;
  mainArmor: Item | null;
  subArmor1: Item | null;
  subArmor2: Item | null;
}

export class EquipmentView {
  private factory: Phaser.GameObjects.GameObjectFactory;
  private graph: Phaser.GameObjects.Graphics;

  private width: integer;
  private height: integer;

  private fontFamily: string;

  private headerText: Phaser.GameObjects.Text;
  private textLabelList: Phaser.GameObjects.Text[];
  private textValueList: Phaser.GameObjects.Text[];

  constructor(
    factory: Phaser.GameObjects.GameObjectFactory,
    x: integer,
    y: integer,
    width: integer,
    height: integer,
    fontFamily = '\'BIZ UDゴシック\', Consolas, monospace'
  ) {
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

    this.headerText = factory.text(x, y, '装備').setFontFamily(fontFamily).setDepth(10);

    this.textLabelList = [];
    this.textValueList = [];
  }

  private truncateLabel(label: string, maxLen = 10): string {
    if (label.length <= maxLen) return label;
    return label.slice(0, 4) + '…' + label.slice(-4);
  }

  render(equipped: EquippedSnapshot) {
    const graph = this.graph;
    graph.fillRect(0, 0, this.width, this.height);

    this.headerText.setText('装備');
    graph.lineBetween(0, this.headerText.height + 2, this.width, this.headerText.height + 2);
    graph.lineBetween(0, this.headerText.height + 4, this.width, this.headerText.height + 4);

    let cur = 0;
    let y = this.headerText.height + 7;
    for (const slot of SLOT_LABELS) {
      const item = equipped[slot.key];
      if (!this.textLabelList[cur]) {
        this.textLabelList[cur] = this.factory.text(this.graph.x, this.graph.y + y, '').setFontFamily(this.fontFamily).setDepth(10);
      }
      this.textLabelList[cur].setText(slot.label).setY(this.graph.y + y);
      if (!this.textValueList[cur]) {
        this.textValueList[cur] = this.factory.text(this.graph.x, this.graph.y + y, '').setFontFamily(this.fontFamily).setDepth(10);
      }
      const valueText = item ? this.truncateLabel(item.getLabel()) : '-';
      this.textValueList[cur]
        .setText(valueText)
        .setY(this.graph.y + y)
        .setX(this.graph.x + this.width - this.textValueList[cur].width);

      y += Math.max(this.textLabelList[cur].height, this.textValueList[cur].height);
      graph.lineBetween(0, y + 3, this.width, y + 3);
      cur++;
      y += 8;
    }
  }
}
