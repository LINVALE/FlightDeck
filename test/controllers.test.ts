import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ControllerSessions } from '../src/controllers/sessions.ts';
const state={output:'study',room:'Study',context:'rooms-a',title:'Rooms',open:true,face:0,total:2,selected:0,items:[{key:'s',title:'Study',subtitle:'',index:0},{key:'k',title:'Kitchen',subtitle:'',index:1}],busy:false,volume:{value:30,min:0,max:100,step:1,softLimit:60,hardLimitMax:90,muted:false}};
function setup(path:string|null=null){const s=new ControllerSessions(path);const screen=(change:any={},now=1000):any=>s.request({op:'screen',display:'tv',tab:'a',name:'Study TV',state,...change},now);const device=(inputs:any[]=[],change:any={},now=1000):any=>s.request({op:'device',id:'puck',name:'Puck',boot:'b1',output:'study',inputs,...change},now);device();screen();s.request({op:'pair',display:'tv',tab:'a',device:'puck'},1000);return {s,screen,device};}
const input=(seq:number,change:any={})=>({seq,type:'volume',value:1,age:0,key:'s',context:'rooms-a',output:'study',...change});
test('paired screen receives each wheel input once, device mirrors selected room and confirmed volume',()=>{const {screen,device}=setup();assert.equal(device([input(1)]).state.volume.value,30);assert.equal(screen().inputs.length,1);device([input(1)]);assert.equal(screen().inputs.length,0);screen({state:{...state,output:'kitchen',volume:{...state.volume,value:45}}});assert.equal(device().state.output,'kitchen');assert.equal(device().state.volume.value,45);});
test('stale context, room, age and duplicate packets cannot control a changed screen',()=>{const {screen,device}=setup();device([input(1,{context:'old'}),input(2,{output:'kitchen'}),input(3,{age:1501})]);assert.equal(screen().inputs.length,0);device([input(4)]);assert.equal(screen({state:{...state,context:'next'}}).inputs.length,0);device([input(4)]);assert.equal(screen().inputs.length,0);});
test('an offline display consumes no control and reconnect never replays held input',()=>{const {screen,device}=setup();assert.equal(device([input(1)],{},4000).online,false);assert.equal(screen({},4001).inputs.length,0);device([input(1)],{},4002);assert.equal(screen({},4003).inputs.length,0);});
test('screen page ownership excludes background tabs and drops old page input on takeover',()=>{const {screen,device}=setup();device([input(1)]);assert.equal(screen({tab:'b'}).active,false);assert.equal(screen({tab:'b',claim:true}).inputs.length,0);assert.equal(screen().active,false);});
test('reboot sequence starts anew while a late retired boot is rejected',()=>{const {screen,device}=setup();device([input(10)]);screen();device([input(1)],{boot:'b2'});assert.equal(screen().inputs.length,1);assert.throws(()=>device([input(11)],{boot:'b1'}),/Retired/);assert.equal(screen().inputs.length,0);});
test('another screen does not consume this puck and moving a pair requires explicit replacement',()=>{const {s,device,screen}=setup();s.request({op:'screen',display:'other',tab:'x',state},1000);assert.throws(()=>s.request({op:'pair',display:'other',tab:'x',device:'puck'},1000),/already linked/);device([input(1)]);assert.equal((s.request({op:'screen',display:'other',tab:'x',state},1000) as any).inputs.length,0);assert.equal(screen().inputs.length,1);});
test('binding persists, runtime input does not, and unlink returns standalone',()=>{const dir=mkdtempSync(join(tmpdir(),'fd-pair-test-'));try{const {s,device}=setup(dir);device([input(1)]);const restored=new ControllerSessions(dir);const r:any=restored.request({op:'device',id:'puck',boot:'b2',inputs:[]},1000);assert.equal(r.paired,true);assert.equal(r.online,false);s.request({op:'unpair',display:'tv',tab:'a'},1000);assert.equal(device().paired,false);}finally{rmSync(dir,{recursive:true,force:true});}});

test('battery follows the actual Puck output while paired, expires offline, and is not persisted',()=>{
 const {s,screen,device}=setup();
 const sample={supplyMv:3800,percent:55,ageMs:100,estimated:true};
 device([],{displayedOutput:'study',battery:sample},1100);
 let d=(s.list(1100) as any).devices[0];assert.equal(d.output,'study');assert.equal(d.battery.percent,55);
 screen({state:{...state,output:'kitchen'}},1200);
 assert.equal((s.list(1200) as any).devices[0].output,'study','Desired browser room is not the physical display acknowledgement');
 device([],{displayedOutput:'kitchen',battery:sample},1300);
 d=(s.list(1300) as any).devices[0];assert.equal(d.output,'kitchen');assert.equal(d.battery.percent,55);
 assert.equal((s.list(6300) as any).devices[0].output,'','Offline Puck leaves room badges');
 device([],{displayedOutput:'',battery:sample},6400);assert.equal((s.list(6400) as any).devices[0].output,'');
 device([],{boot:'b2',displayedOutput:'study'},6500);assert.equal((s.list(6500) as any).devices[0].battery,null,'Old boot reading cannot survive');
 assert.throws(()=>device([],{boot:'b1',displayedOutput:'kitchen',battery:sample},6600),/Retired/);
 assert.equal((s.list(6600) as any).devices[0].output,'study');
});
test('USB-range voltage, stale samples and malformed battery values never become 100 percent',()=>{
 const {s,device}=setup();
 for(const b of [{supplyMv:4700,percent:100,ageMs:0,estimated:true},{supplyMv:3800,percent:101,ageMs:0,estimated:true},{supplyMv:3800,percent:55,ageMs:15001,estimated:true},{supplyMv:3800,percent:55,ageMs:-1,estimated:true},{supplyMv:3800,percent:'55',ageMs:0,estimated:true},{supplyMv:NaN,percent:55,ageMs:0,estimated:true}]){
  device([],{displayedOutput:'study',battery:b});assert.equal((s.list(1000) as any).devices[0].battery?.percent??null,null);
 }
 device([],{displayedOutput:'study',battery:{supplyMv:3800,percent:55,ageMs:14000,estimated:true}});
 assert.equal((s.list(2001) as any).devices[0].battery,null,'Sample expires independently of device presence');
});
