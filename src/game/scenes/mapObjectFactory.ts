'use strict';

import { newMapEvent } from '../../lib/MapObject';
import type { MapObject, ObjectEvent } from '../../lib/MapObject';
import { StairsObject, TrapObject } from '../../lib/map/MapObjects';
import type { DungeonMap } from '../../lib/MapGenerator';
import type { TrapDefinition } from '../../lib/TrapsLoader';

export function buildStairsObject(
  onEnterStair: (dungeon: DungeonMap) => void,
): StairsObject {
  const obj = new StairsObject();
  const handler: ObjectEvent = (dungeon) => { onEnterStair(dungeon); return true; };
  newMapEvent('around-0', handler, obj.events);
  newMapEvent('around-0-self', handler, obj.events);
  return obj;
}

export function buildTrapObject(
  trapDef: TrapDefinition,
  applyEffects: (def: TrapDefinition) => void,
  enterConfirmMode: (def: TrapDefinition, obj: MapObject) => void,
): TrapObject {
  const obj = new TrapObject(trapDef);
  const onTrigger: ObjectEvent = (_, object) => {
    if (object.visible) return true;
    object.visible = true;
    applyEffects(trapDef);
    return true;
  };
  const onSelfTrigger: ObjectEvent = (_, object) => {
    enterConfirmMode(trapDef, object);
    return true;
  };
  newMapEvent('around-0', onTrigger, obj.events);
  newMapEvent('around-0-self', onSelfTrigger, obj.events);
  return obj;
}
