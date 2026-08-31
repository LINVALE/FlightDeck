/**
 * A Roon zone id is disposable: grouping destroys solo zones and publishes a
 * successor. The first output is the durable leader, so it owns the wall slot.
 */
export function wallSlot(zone) {
  if (zone !== null && zone !== undefined && Array.isArray(zone.outputs)
      && zone.outputs.length > 0 && typeof zone.outputs[0].id === 'string') {
    return 'output:' + zone.outputs[0].id;
  }
  return 'zone:' + zone.id;
}

/** Playback state never owns position: the default Wall is room-name order. */
export function alphabeticalWallZones(zones) {
  return zones.slice().sort(function (left, right) {
    var a = String(left.name || '').toLowerCase();
    var b = String(right.name || '').toLowerCase();
    if (a < b) return -1;
    if (a > b) return 1;
    return String(left.id).localeCompare(String(right.id));
  });
}

/** Apply a screen-local list of durable leader-output slots to live zones. */
export function applyWallSlotOrder(zones, slots) {
  var bySlot = {};
  for (var i = 0; i < zones.length; i += 1) bySlot[wallSlot(zones[i])] = zones[i];
  var used = {};
  var ordered = [];
  for (var s = 0; s < slots.length; s += 1) {
    var saved = bySlot[slots[s]];
    if (saved !== undefined && used[saved.id] !== true) {
      ordered.push(saved);
      used[saved.id] = true;
    }
  }
  for (var z = 0; z < zones.length; z += 1) {
    if (used[zones[z].id] !== true) ordered.push(zones[z]);
  }
  return ordered;
}

/** Output id -> the zone that owned it on the preceding wall frame. */
export function wallOutputOwners(zones) {
  var owners = {};
  for (var i = 0; i < zones.length; i += 1) {
    for (var o = 0; o < zones[i].outputs.length; o += 1) {
      owners[zones[i].outputs[o].id] = zones[i].id;
    }
  }
  return owners;
}

/** True when formerly separate outputs have landed in a new group successor. */
export function joinedPreviousZones(zones, previousOwners) {
  for (var i = 0; i < zones.length; i += 1) {
    for (var o = 0; o < zones[i].outputs.length; o += 1) {
      var oldOwner = previousOwners[zones[i].outputs[o].id];
      if (oldOwner !== undefined && oldOwner !== zones[i].id) return true;
    }
  }
  return false;
}

/**
 * Keep surviving zones in place and let a successor inherit its leader's slot.
 * Any genuinely new room follows in the server's order.
 */
export function inheritWallOrder(zones, previousIds, previousSlots) {
  var byId = {};
  for (var i = 0; i < zones.length; i += 1) byId[zones[i].id] = zones[i];

  var used = {};
  var held = [];
  for (var p = 0; p < previousIds.length; p += 1) {
    var same = byId[previousIds[p]];
    if (same !== undefined && used[same.id] !== true) {
      held.push(same);
      used[same.id] = true;
      continue;
    }
    for (var z = 0; z < zones.length; z += 1) {
      if (used[zones[z].id] !== true && wallSlot(zones[z]) === previousSlots[p]) {
        held.push(zones[z]);
        used[zones[z].id] = true;
        break;
      }
    }
  }
  for (var n = 0; n < zones.length; n += 1) {
    if (used[zones[n].id] !== true) held.push(zones[n]);
  }
  return held;
}
