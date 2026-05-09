'use strict';

import { MapMark, MapObject } from '../MapObject';
import type { TrapDefinition } from '../TrapsLoader';
import type { ItemDefinition } from '../ItemsLoader';

export class StairsObject extends MapObject {
  constructor() {
    super();
    this.mark = MapMark.CIRCLE;
    this.color = 0x00FF00;
  }
}

export class TrapObject extends MapObject {
  constructor(public readonly trapDef: TrapDefinition) {
    super();
    this.mark = MapMark.X_CROSS;
    this.color = 0xFF0000;
    this.visible = false;
  }
}

export class ItemObject extends MapObject {
  constructor(public readonly itemDef: ItemDefinition) {
    super();
    this.mark = MapMark.CROSS;
    this.color = 0x00FFFF;
  }
}
