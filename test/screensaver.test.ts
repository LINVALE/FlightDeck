import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlankPolicy } from '../assets/screensaver.js';
import { standbyTargets, standbyReviewed } from '../assets/wall-power.js';

for (const minutes of [15,30,60]) test(`screensaver blanks after ${minutes} minutes, activity resets it, Never disables it`, () => {
  let now = 0; const p = createBlankPolicy(() => now);
  now = minutes*60000-1; assert.equal(p.check(minutes,false),false);
  p.activity(); now += minutes*60000-1; assert.equal(p.check(minutes,false),false);
  now++; assert.equal(p.check(minutes,false),true);
  assert.equal(p.check(0,false),false);
  now += 86400000; assert.equal(p.check(0,false),false);
});
test('playback protects the display, a full idle interval starts on stopping, and playback wakes automatic blanking', () => {
  let now=0; const p=createBlankPolicy(()=>now);
  assert.equal(p.check(15,true),false); now=3600000;
  assert.equal(p.check(15,true),false); now++;
  assert.equal(p.check(15,false),false); now+=899999;
  assert.equal(p.check(15,false),false); now++;
  assert.equal(p.check(15,false),true);
  assert.equal(p.check(15,true),false);
});
test('repeated snapshots do not postpone blanking; a late background check uses elapsed time', () => {
  let now=0;const p=createBlankPolicy(()=>now);
  for(now=0;now<900000;now+=1000)assert.equal(p.check(15,false),false);
  now=1800000;assert.equal(p.check(15,false),true);
});
test('manual blanking remains asleep during playback; waking starts a fresh idle interval', () => {
  let now=0;const p=createBlankPolicy(()=>now);p.sleep();
  assert.equal(p.check(0,true),true);p.activity();assert.equal(p.check(15,false),false);
  now=900000;assert.equal(p.check(15,false),true);
});
const snapshot=()=>({generation:'g',core:{state:'paired'},zones:[{outputs:[{id:'a',name:'A',power:{controlKey:'amp',asleep:false}},{id:'b',name:'B',power:null},{id:'c',name:'C',power:{controlKey:'amp',asleep:true}}]},{outputs:[{id:'a',name:'A',power:{controlKey:'amp',asleep:false}},{id:'d',name:'D',power:{controlKey:'power',asleep:false}}]}]});
test('standby reviews supported awake outputs once and skips changed controls without widening the set',async()=>{
 const s=snapshot(), targets=standbyTargets(s),sent:any[]=[];
 assert.deepEqual(targets.map((t:any)=>t.output),['a','d']);
 const result=await standbyReviewed(targets,'g',()=>s,async(command:any)=>{sent.push(command);s.zones[1].outputs[1].power!.controlKey='replacement';return true;});
 assert.deepEqual(result,{sent:1,skipped:1,failed:0});assert.deepEqual(sent,[{action:'standby',output:'a',controlKey:'amp'}]);
});
test('standby skips a changed Core and counts a rejected command',async()=>{
 const s=snapshot(),targets=standbyTargets(s);
 assert.deepEqual(await standbyReviewed(targets,'old',()=>s,async()=>{throw Error('must not send');}),{sent:0,skipped:2,failed:0});
 assert.deepEqual(await standbyReviewed(targets,'g',()=>s,async()=>false),{sent:0,skipped:0,failed:2});
});
