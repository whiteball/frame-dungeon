'use strict';

import { MapMark, MapObject, MapShape, newMapEvent } from '../MapObject';
import type { ObjectEvent } from '../MapObject';
import { EventBus } from '../../game/EventBus';
import type { TrapDefinition } from '../TrapsLoader';
import type { Item } from '../Item';
import type { EventDefinition } from '../EventsLoader';
import { applyAppearance } from '../AppearanceSpec';
import type { MapDirection } from './MapDirection';

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
    this.visible = trapDef.visible ?? false;
    const ap = trapDef.appearance;
    if (ap) {
      if (ap.mark !== undefined) this.mark = ap.mark;
      if (ap.color !== undefined) this.color = ap.color;
      if (ap.shape !== undefined) this.shape = ap.shape;
      if (ap.concentricCircle !== undefined) this.concentricCircle = ap.concentricCircle;
    }
  }
}

export class TreasureObject extends MapObject {
  constructor(
    public readonly item: Item,
    public readonly trapRate: number,
    public readonly trapPool: string[],
  ) {
    super();
    this.mark = MapMark.SQUARE;
    this.color = 0xFFD700;
    this.shape = MapShape.CUBE;
    this.visible = true;
  }
}

/**
 * `events.yml` で定義された汎用イベントオブジェクト。
 * 調査 (C キー方向選択経由) でのみ発動する。`blocking: true`（既定）の場合は
 * 宝箱と同様に進入禁止セル化される（`DungeonMap.isCellBlocked` 経由）。
 *
 * イベントハンドラの差し込みは `buildEventObject` (mapObjectFactory) で行う。
 */
export class EventObject extends MapObject {
  /**
   * `unlock_door: self` action 用の連動扉座標。
   * 鍵 (`secret_room_key`) のような特定の扉と紐付けられた EventObject 用に
   * FloorPopulator / deserialize 経由で外部から代入される。
   */
  public linkedDoor?: { x: integer; y: integer; dir: MapDirection };

  constructor(public readonly eventDef: EventDefinition) {
    super();
    // 既定の見た目（青系球体）。appearance 指定があれば上書きする
    this.mark = MapMark.STAR;
    this.color = 0x88CCFF;
    this.shape = MapShape.SPHERE;
    this.visible = true;
    applyAppearance(this, eventDef.appearance);
  }

  /** blocking: true（既定）なら進入禁止セル化対象 */
  get isBlocking(): boolean {
    return this.eventDef.blocking ?? true;
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
