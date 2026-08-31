import test from 'node:test';
import assert from 'node:assert/strict';
import {
  alphabeticalWallZones, applyWallSlotOrder, inheritWallOrder,
  joinedPreviousZones, wallOutputOwners, wallSlot,
} from '../assets/wall-order.js';

const zone = (id: string, outputs: string[], name = id) => ({
  id,
  name,
  outputs: outputs.map((output) => ({ id: output })),
});

test('the Wall defaults to alphabetical room names rather than playback recency', () => {
  const zones = [zone('z', ['oz'], 'Study'), zone('a', ['oa'], 'attic'), zone('k', ['ok'], 'Kitchen')];
  assert.deepEqual(alphabeticalWallZones(zones).map((item) => item.name), ['attic', 'Kitchen', 'Study']);
  assert.deepEqual(zones.map((item) => item.name), ['Study', 'attic', 'Kitchen'], 'the snapshot is not mutated');
});

test('a saved Wall order follows durable leader-output slots and appends new rooms', () => {
  const zones = [zone('study', ['oStudy']), zone('attic', ['oAttic']), zone('kitchen', ['oKitchen'])];
  const slots = [wallSlot(zones[2]), wallSlot(zones[0])];
  assert.deepEqual(applyWallSlotOrder(zones, slots).map((item) => item.id),
    ['kitchen', 'study', 'attic']);
});

test('a new group successor inherits its leader position on Wall 2', () => {
  const before = [zone('kitchen', ['oKitchen']), zone('leader', ['oLeader']),
    zone('member', ['oMember']), zone('study', ['oStudy'])];
  const previousIds = before.map((item) => item.id);
  const previousSlots = before.map(wallSlot);
  const owners = wallOutputOwners(before);

  // The server may rank a newly minted, never-used group last. Its first output
  // is still the leader and therefore the durable owner of the old wall slot.
  const after = [zone('kitchen', ['oKitchen']), zone('study', ['oStudy']),
    zone('group-successor', ['oLeader', 'oMember'])];
  assert.equal(joinedPreviousZones(after, owners), true);
  assert.deepEqual(inheritWallOrder(after, previousIds, previousSlots).map((item) => item.id),
    ['kitchen', 'group-successor', 'study']);
});

test('a same-id leader also holds its slot when another room joins it', () => {
  const before = [zone('a', ['oa']), zone('leader', ['ol']), zone('member', ['om']), zone('b', ['ob'])];
  const after = [zone('a', ['oa']), zone('b', ['ob']), zone('leader', ['ol', 'om'])];
  assert.equal(joinedPreviousZones(after, wallOutputOwners(before)), true,
    'the moved member reveals grouping even if Roon retains the leader zone id');
  assert.deepEqual(inheritWallOrder(after, before.map((item) => item.id), before.map(wallSlot))
    .map((item) => item.id), ['a', 'leader', 'b']);
});
