import test from 'node:test';
import assert from 'node:assert/strict';
import {batteryLabel,devicesForOutputs} from '../assets/puck-status.js';
test('room battery status follows durable outputs through grouping and multiple Pucks',()=>{
 const devices=[{id:'a',output:'study',display:'tv'},{id:'b',output:'kitchen',display:'tv'},{id:'c',output:'',display:'tv'}];
 assert.deepEqual(devicesForOutputs(devices,['study'],'tv').map(d=>d.id),['a']);
 assert.deepEqual(devicesForOutputs(devices,['study','kitchen'],'tv').map(d=>d.id),['a','b']);
 assert.deepEqual(devicesForOutputs(devices,['garden'],'tv'),[]);
});
// Peter 09-21: the badge showed on every screen showing that room; it belongs to the Puck's own screen.
test('a Puck\'s battery shows only on the screen it is paired with',()=>{
 const devices=[{id:'a',output:'study',display:'family-room-tv'},{id:'b',output:'study',display:''}];
 assert.deepEqual(devicesForOutputs(devices,['study'],'family-room-tv').map(d=>d.id),['a'],'its own screen');
 assert.deepEqual(devicesForOutputs(devices,['study'],'study-frame'),[],'another screen showing the same room');
 assert.deepEqual(devicesForOutputs(devices,['study'],''),[],'a screen with no identity');
 assert.deepEqual(devicesForOutputs([{id:'b',output:'study',display:''}],['study'],'family-room-tv'),[],'an unpaired Puck');
});
test('estimated, externally powered and unknown battery readings are distinct',()=>{
 assert.equal(batteryLabel({percent:55,estimated:true,supplyMv:3800}),'~55%');
 assert.equal(batteryLabel({percent:0,estimated:true,supplyMv:3300}),'~0%');
 assert.equal(batteryLabel({percent:null,supplyMv:4700}),'PWR');
 assert.equal(batteryLabel(null),'?');
 assert.equal(batteryLabel({percent:null,supplyMv:null}),'?');
});
