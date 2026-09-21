import test from 'node:test';
import assert from 'node:assert/strict';
import {batteryLabel,devicesForOutputs} from '../assets/puck-status.js';
test('room battery status follows durable outputs through grouping and multiple Pucks',()=>{
 const devices=[{id:'a',output:'study'},{id:'b',output:'kitchen'},{id:'c',output:''}];
 assert.deepEqual(devicesForOutputs(devices,['study']).map(d=>d.id),['a']);
 assert.deepEqual(devicesForOutputs(devices,['study','kitchen']).map(d=>d.id),['a','b']);
 assert.deepEqual(devicesForOutputs(devices,['garden']),[]);
});
test('estimated, externally powered and unknown battery readings are distinct',()=>{
 assert.equal(batteryLabel({percent:55,estimated:true,supplyMv:3800}),'~55%');
 assert.equal(batteryLabel({percent:0,estimated:true,supplyMv:3300}),'~0%');
 assert.equal(batteryLabel({percent:null,supplyMv:4700}),'PWR');
 assert.equal(batteryLabel(null),'?');
 assert.equal(batteryLabel({percent:null,supplyMv:null}),'?');
});
