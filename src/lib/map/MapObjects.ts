'use strict';

import { MapMark, MapObject, MapShape, newMapEvent } from '../MapObject';
import type { ObjectEvent } from '../MapObject';
import { EventBus } from '../../game/EventBus';
import type { TrapDefinition } from '../TrapsLoader';
import type { Item } from '../Item';

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
    this.shape = MapShape.PYRAMID;
    this.visible = false;
  }
}

export class ItemObject extends MapObject {
  constructor(public readonly item: Item) {
    super();
    this.mark = MapMark.CROSS;
    this.shape = MapShape.BOX;
    if (item.getType() === 'consumable') {
      this.color = 0xFFA012;
    } else {
      this.color = 0x12A0FF;
    }
    

    const label = item.getLabelWithModifiers();
    const onPickup: ObjectEvent = (dungeon) => {
      const player = dungeon.getPlayerInstance();
      if (player?.getInventory().addItem(item)) {
        EventBus.emit('message-log', `${label}を入手した`, dungeon.getTurnCount());
        return false;
      }
      EventBus.emit('message-log', `${label}の上に乗った`, dungeon.getTurnCount());
      return true;
    };
    const onSelf: ObjectEvent = (dungeon, object) => {
      const player = dungeon.getPlayerInstance();
      if (player?.getInventory().addItem(item)) {
        EventBus.emit('message-log', `${label}を入手した`, dungeon.getTurnCount());
        return false;
      }
      EventBus.emit('open-drop-list-for-pickup', { mapObject: object, item });
      return true;
    };
    newMapEvent('around-0', onPickup, this.events);
    newMapEvent('around-0-self', onSelf, this.events);
  }
}
