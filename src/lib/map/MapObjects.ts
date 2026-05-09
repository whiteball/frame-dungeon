'use strict';

import { MapMark, MapObject, newMapEvent } from '../MapObject';
import type { ObjectEvent } from '../MapObject';
import { Player } from '../Player';
import { EventBus } from '../../game/EventBus';
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

    const label = itemDef.label;
    const onPickup: ObjectEvent = (dungeon) => {
      const player = dungeon.getPlayerInstance();
      const newItem = Player.createItem(itemDef.name);
      if (newItem && player?.getInventory().addItem(newItem)) {
        EventBus.emit('message-log', `${label}を入手した`, dungeon.getTurnCount());
        return false;
      }
      EventBus.emit('message-log', `${label}の上に乗った`, dungeon.getTurnCount());
      return true;
    };
    const onSelf: ObjectEvent = (dungeon, object) => {
      const player = dungeon.getPlayerInstance();
      const newItem = Player.createItem(itemDef.name);
      if (newItem && player?.getInventory().addItem(newItem)) {
        EventBus.emit('message-log', `${label}を入手した`, dungeon.getTurnCount());
        return false;
      }
      EventBus.emit('open-drop-list-for-pickup', { mapObject: object, itemDef });
      return true;
    };
    newMapEvent('around-0', onPickup, this.events);
    newMapEvent('around-0-self', onSelf, this.events);
  }
}
