/** Offline Chrome smoke test. All commands go to an in-memory mock; no Roon discovery or playback. */
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
import { ControllerSessions } from '../src/controllers/sessions.ts';
import { ArtRelay } from '../src/art/relay.ts';
import { EventHub } from '../src/http/events.ts';
import { RecentLedger } from '../src/ledger/recent.ts';
import { buildSnapshot } from '../src/model/snapshot.ts';
import { createFlightDeckServer, listenWithLadder } from '../src/http/server.ts';
const root=resolve(fileURLToPath(import.meta.url),'../..');
const runDir=mkdtempSync(join(tmpdir(),'flightdeck-ui-check-'));
const assets=join(runDir,'assets');cpSync(join(root,'assets'),assets,{recursive:true});
if(process.env.FLIGHTDECK_TEST_ART)writeFileSync(join(assets,'test-cover.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="400" height="400" viewBox="0 0 400 400"><image width="400" height="400" href="data:image/jpeg;base64,'+readFileSync(process.env.FLIGHTDECK_TEST_ART).toString('base64')+'"/></svg>');
appendFileSync(assets+'/face.js','\nglobalThis.fdTest={openHierarchy,browseBack,browseInto,showPicker,openQueuePanel,displayCare,faceBlanker};');
appendFileSync(assets+'/wall.js','\nglobalThis.fdTest={wallCare,wallBlanker};');
appendFileSync(assets+'/phone.js','\nglobalThis.fdTest={browseRoot,browseBack,browseInto,browseMore,openSheet,browse};');
appendFileSync(assets+'/puck.js','\nglobalThis.fdTest={browse,companion};');
const hub=new EventHub(),relay=new ArtRelay({artworkUrl:()=>''}),ledger=new RecentLedger(null),sent=[],browses=[],sessions={};
let rev=1;
let raw=[{zone_id:'group',display_name:'Living room + Study',state:'playing',outputs:[
 {output_id:'living',display_name:'Living room',can_group_with_output_ids:['living','study','fixed','inc'],volume:{type:'db',min:-80,max:0,step:.5,value:-20.5,soft_limit:-15,hard_limit_max:-10,hard_limit_min:-60},source_controls:[{supports_standby:true,status:'selected',control_key:'amp'}]},
 {output_id:'study',display_name:'Study',can_group_with_output_ids:['living','study','fixed','inc'],volume:{type:'number',min:0,max:100,step:1,value:35,soft_limit:70,hard_limit_max:80}},
 {output_id:'fixed',display_name:'Fixed player',can_group_with_output_ids:['living','study','fixed','inc']},
 {output_id:'inc',display_name:'Steps player',can_group_with_output_ids:['living','study','fixed','inc'],volume:{type:'incremental',is_muted:false}},
],is_play_allowed:false,is_pause_allowed:true,is_next_allowed:true,is_previous_allowed:true,is_seek_allowed:true,settings:{shuffle:false,loop:'disabled',auto_radio:false},now_playing:{seek_position:10,length:240,three_line:{line1:'Test album',line2:'Test artist',line3:'Mock Core'}}}];
function publish(){const at=new Date().toISOString();const snap=buildSnapshot({generation:'test-only',zones:raw,coreName:'Offline mock',corePaired:true,coreSinceAt:at,revision:rev++,at},relay,ledger);if(process.env.FLIGHTDECK_TEST_ART)for(const z of snap.zones)if(z.nowPlaying)z.nowPlaying={...z.nowPlaying,art:{path:'/assets/test-cover.svg',key:'test-cover'}};hub.publish(snap);}
const commands={control:async(...x)=>sent.push(['control',...x]),seek:async(...x)=>sent.push(["seek",...x]),setVolume:async(id,v)=>{sent.push(['volume',id,v]);raw[0].outputs.find(o=>o.output_id===id).volume.value=v;publish();},changeVolume:async(id,steps,incremental)=>{sent.push(['steps',id,steps,incremental]);const o=raw[0].outputs.find(o=>o.output_id===id);if(o.volume.type!=='incremental')o.volume.value+=steps*o.volume.step;publish();},mute:async(id,v)=>{sent.push(['mute',id,v]);raw[0].outputs.find(o=>o.output_id===id).volume.is_muted=v;publish();},changeSettings:async(id,s)=>{sent.push(['settings',id,s]);Object.assign(raw[0].settings,s);publish();},standby:async(...x)=>sent.push(['standby',...x]),groupOutputs:async()=>{},ungroupOutputs:async()=>{},transferZone:async()=>{}};
const browseAccess={available:()=>true,browse:async(c)=>{browses.push(c);let s=sessions[c.sessionKey]||{level:0,version:0};sessions[c.sessionKey]=s;if(c.popAll){s.level=0;}else if(c.popLevels){s.level=Math.max(0,s.level-1);s.version++;}else if(c.itemKey){assert.ok(c.itemKey.startsWith('k'+s.version+':'),'stale Roon key');s.level++;}return {action:'list',list:{title:s.level?'Album tracks':'Albums',count:s.level?4:800,level:s.level,hint:'list'},items:[]};},load:async(c)=>{browses.push(c);const s=sessions[c.sessionKey];return {action:'list',offset:c.offset||0,list:{title:s.level?'Album tracks':'Albums',count:s.level?4:800,level:s.level,hint:'list'},items:Array.from({length:Math.min(c.count||100,(s.level?4:800)-(c.offset||0))},(_,i)=>({title:s.level?'Track '+i:'Album '+String((c.offset||0)+i).padStart(3,'0'),itemKey:'k'+s.version+':'+((c.offset||0)+i),hint:'list',subtitle:'Example',imageKey:null,input:null}))};}};
const controllers=new ControllerSessions(null);
let reportedOutput="living",reportedBattery={supplyMv:3800,percent:55,ageMs:0,estimated:true},deviceOnline=true;
function reportPuck(){if(deviceOnline)controllers.request({op:"device",id:"test-puck",name:"Study puck",boot:"boot-1",output:reportedOutput,displayedOutput:reportedOutput,battery:reportedBattery,inputs:[]});}
reportPuck();const heartbeat=setInterval(reportPuck,500);
const server=createFlightDeckServer({controllers,hub,relay,ledger,assetDir:assets,docDir:join(root,'docs'),commands,browseAccess,queueAccess:{snapshot:()=>({zoneId:'group',generation:'test-only',revision:1,ready:true,items:Array.from({length:3},(_,i)=>({qid:100+i,title:'Queue track '+i,artist:'Test artist',album:'Mock album',length:240,imageKey:null})),atLimit:false}),playFromHere:async(...x)=>sent.push(['queue',...x])},mdns:()=>null,urls:()=>[],port:()=>0});
publish();await listenWithLadder(server,[0],()=>{});const port=server.address().port;
const profile=join(runDir,'chrome');mkdirSync(profile);
const chrome=spawn(process.env.FLIGHTDECK_TEST_CHROME || '/opt/google/chrome/chrome',['--headless=new','--no-sandbox','--disable-gpu','--remote-debugging-port=0','--user-data-dir='+profile,'--no-first-run','--no-default-browser-check','--disable-background-networking','about:blank'],{stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let ws;
try{
 for(let i=0;i<100;i++){try{readFileSync(profile+'/DevToolsActivePort');break;}catch{}await sleep(100);}
 const debug=readFileSync(profile+'/DevToolsActivePort','utf8').split('\n')[0];const targets=await(await fetch('http://127.0.0.1:'+debug+'/json')).json();ws=new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await new Promise(r=>ws.addEventListener('open',r));
 let id=0;const pending=new Map(),errors=[];ws.addEventListener('message',e=>{const m=JSON.parse(e.data);if(m.id){const p=pending.get(m.id);if(p){pending.delete(m.id);m.error?p.reject(m.error):p.resolve(m.result);}}else if(m.method==='Log.entryAdded'){console.log('CHROME',m.params.entry.text);}else if(m.method==='Runtime.exceptionThrown'){errors.push(m.params.exceptionDetails);}});
 const cdp=(method,params={})=>new Promise((resolve,reject)=>{const n=++id;pending.set(n,{resolve,reject});ws.send(JSON.stringify({id:n,method,params}));});
 const js=async(expression)=>{const r=await cdp('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;};
 await cdp('Log.enable');await cdp('Runtime.enable');await cdp('Page.enable');await cdp('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});
 async function go(path,ready){await cdp('Page.navigate',{url:'http://127.0.0.1:'+port+path});for(let n=0;n<100;n++){await sleep(100);if(await js(ready))return;}throw new Error('Not ready '+path+' url='+await js('location.href')+' html='+await js('document.documentElement.outerHTML').then(s=>s.slice(0,1000))+' errors='+JSON.stringify(errors));}

 async function waitFor(expression){for(let i=0;i<100;i++){await sleep(100);if(await js(expression))return;}throw new Error('Timed out: '+expression);}
 const rooms=raw[0];raw=[{...rooms,outputs:[rooms.outputs[0]]},{...rooms,zone_id:'study-room',display_name:'Study',outputs:[rooms.outputs[1]]}];publish();
 await go('/?ui=tv',"!!document.querySelector('.puck-battery')");
 assert.equal(await js("document.querySelector('[data-zone=group] .puck-battery').textContent"),'~55%');
 assert.equal(await js("document.querySelector('[data-zone=study-room] .puck-battery')===null"),true);
 reportedOutput='study';reportPuck();
 await waitFor("!!document.querySelector('[data-zone=study-room] .puck-battery')&&!document.querySelector('[data-zone=group] .puck-battery')");
 reportedBattery={supplyMv:4700,percent:100,ageMs:0,estimated:true};reportPuck();
 await waitFor("document.querySelector('[data-zone=study-room] .puck-battery').textContent==='PWR'");
 assert.ok(await js("document.querySelector('.puck-battery').title.includes('battery level unavailable')"));
 console.log('PASS Room badge follows the actual output and USB-range supply never claims full battery');
 reportedBattery={supplyMv:3500,percent:10,ageMs:0,estimated:true};reportPuck();
 await waitFor("document.querySelector('.puck-battery').getAttribute('data-low')==='1'");
 const wall=await cdp('Page.captureScreenshot');writeFileSync(join(runDir,'battery-wall.png'),Buffer.from(wall.data,'base64'));
 for(const path of ['/face/study?ui=tv','/phone/study-room','/puck/study']){
  await go(path,"!!document.querySelector('.puck-battery')");
  assert.equal(await js("document.querySelector('.puck-battery').textContent"),'~10%');
  console.log('PASS Matching room battery on '+path);
 }
 deviceOnline=false;await sleep(8000);
 assert.equal(await js("document.querySelector('.puck-batteries').hidden"),true,'Offline Puck badge disappears');
 deviceOnline=true;reportedOutput='';reportPuck();await sleep(2200);
 assert.equal(await js("document.querySelector('.puck-batteries').hidden"),true,'Puck with no active display does not badge its old room');
 assert.equal(sent.length,0,'Battery reporting never issues player commands');
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS Offline expiry, cleared display and no player commands');
 console.log('Browser evidence:',runDir);
}finally{clearInterval(heartbeat);if(ws)ws.close();chrome.kill();hub.closeAll();server.close();}
