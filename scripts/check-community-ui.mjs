/** Offline Chrome smoke test. All commands go to an in-memory mock; no Roon discovery or playback. */
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import assert from 'node:assert/strict';
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
const server=createFlightDeckServer({hub,relay,ledger,assetDir:assets,docDir:join(root,'docs'),commands,browseAccess,queueAccess:{snapshot:()=>({zoneId:'group',generation:'test-only',revision:1,ready:true,items:Array.from({length:3},(_,i)=>({qid:100+i,title:'Queue track '+i,artist:'Test artist',album:'Mock album',length:240,imageKey:null})),atLimit:false}),playFromHere:async(...x)=>sent.push(['queue',...x])},mdns:()=>null,urls:()=>[],port:()=>0});
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
 await go('/?ui=tv',"document.querySelector('.tile-members')!==null");
 await sleep(1600);
 const icon=await js("(()=>{var b=document.querySelector('.tile-members'),r=b.getBoundingClientRect(),card=b.closest('.tile').getBoundingClientRect(),bar=b.closest('.tile-volume-line').getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,width:r.width,height:r.height,inCard:r.bottom<=card.bottom&&r.right<=card.right,inRow:r.top>=bar.top-1&&r.bottom<=bar.bottom+1,hit:b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};})()");
 assert.ok(icon.width>=22&&icon.height>=22&&icon.inCard&&icon.inRow&&icon.hit, 'Group-volume icon must be visible and hit-testable: '+JSON.stringify(icon));
 const readings=()=>js("(()=>{var tile=document.querySelector('.tile'),bar=tile.querySelector('.tile-volume-line .tile-rule').getBoundingClientRect(),time=tile.querySelector('.tile-progress-line .total'),volume=tile.querySelector('.tile-volume-line .total'),button=tile.querySelector('.tile-members'),range=document.createRange();range.selectNodeContents(volume);return {barRight:bar.right,timeLeft:time.getBoundingClientRect().left,volumeLeft:volume.getBoundingClientRect().left,timeAlign:getComputedStyle(time).textAlign,volumeAlign:getComputedStyle(volume).textAlign,clear:range.getBoundingClientRect().right+3<=button.getBoundingClientRect().left};})()");
 const groupedReadings=await readings();
 assert.equal(groupedReadings.timeAlign,'left');assert.equal(groupedReadings.volumeAlign,'left');assert.equal(groupedReadings.clear,true);
 const groupedOutputs=raw[0].outputs;raw[0].outputs=groupedOutputs.slice(0,1);publish();await sleep(150);
 const singleReadings=await readings();
 for(const key of ['barRight','timeLeft','volumeLeft'])assert.equal(singleReadings[key],groupedReadings[key],'Grouping must not shift '+key);
 raw[0].outputs=groupedOutputs;publish();await sleep(150);
 console.log('PASS Grouping keeps bars and left-aligned readings stationary');
 const singleRoom=raw;
 raw=[raw[0],...Array.from({length:15},(_,i)=>({...raw[0],zone_id:'extra-'+i,display_name:'Player '+i,outputs:[{...raw[0].outputs[1],output_id:'extra-output-'+i,display_name:'Player '+i}]}))];publish();
 for(const size of [[1920,1080],[1280,720]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:1,mobile:false});await sleep(300);
  assert.equal(await js("document.querySelectorAll('.grid > .tile').length"),16);
  assert.equal(await js("(()=>{var b=document.querySelector('.tile-members:not([hidden])'),r=b.getBoundingClientRect(),line=b.closest('.tile-volume-line').getBoundingClientRect();return r.width>=22&&r.height>=22&&r.top>=line.top-1&&r.bottom<=line.bottom+1&&b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2));})()"),true,'16-room layout at '+size.join('x'));
 }
 raw=singleRoom;publish();await cdp('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await sleep(300);
 const closed=await cdp('Page.captureScreenshot');writeFileSync(join(runDir,'group-card-icon.png'),Buffer.from(closed.data,'base64'));
 console.log('PASS Group icon visible in single-card and 16-room layouts at 1080p and 720p');
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:icon.x,y:icon.y,button:'left',clickCount:1});
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:icon.x,y:icon.y,button:'left',clickCount:1});
 assert.equal(await js("document.querySelectorAll('.wall-member').length"),4);
 assert.equal(await js("document.querySelector('.wall-member-value').textContent"),'-20.5 dB');
 await js("document.querySelector('[aria-label=\"Raise volume for Living room\"]').click()");await sleep(200);assert.deepEqual(sent.at(-1),['steps','living',1,false]);assert.equal(await js("document.querySelector('.wall-member-value').textContent"),'-20 dB');
 await js("document.querySelector('[aria-label=\"Mute Study\"]').click()");await sleep(150);assert.deepEqual(sent.at(-1),['mute','study',true]);
 assert.equal(await js("document.querySelectorAll('.wall-member-controls button:disabled').length"),3);
 await js("document.querySelector('[aria-label=\"Raise volume for Steps player\"]').click()");await sleep(100);assert.deepEqual(sent.at(-1),['steps','inc',1,true]);
 const screenshot=await cdp('Page.captureScreenshot');writeFileSync(join(runDir,'member-volumes.png'),Buffer.from(screenshot.data,'base64'));
 raw[0].outputs=raw[0].outputs.slice(0,2);publish();await sleep(150);assert.equal(await js("document.querySelector('.wall-panel').hidden"),true);
 console.log('PASS Wall member volume/mute, fixed/incremental players and topology fencing');
 // Screensaver checks use a browser-local clock; the mock server clock is untouched.
 const pressText=async(text)=>js(`Array.from(document.querySelectorAll('.wall-panel button')).find(b=>b.textContent===${JSON.stringify(text)}).click()`);
 await js("document.querySelector('.wall-settings').click()");
 assert.equal(await js("document.querySelector('[aria-label=\"Blank after inactivity\"]').value"),'0');
 await js("var select=document.querySelector('[aria-label=\"Blank after inactivity\"]');select.value='15';select.dispatchEvent(new Event('change'))");
 assert.equal(await js("JSON.parse(localStorage.getItem('flightdeck.wall-care')).blankMinutes"),15);
 const settingsShot=await cdp('Page.captureScreenshot');writeFileSync(join(runDir,'wall-settings.png'),Buffer.from(settingsShot.data,'base64'));
 await pressText('Blank this display now');await sleep(800);
 assert.equal(await js("document.querySelector('.display-screen-blank').hidden"),false);
 const commandCount=sent.length;
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:icon.x,y:icon.y,button:'left',clickCount:1});
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:icon.x,y:icon.y,button:'left',clickCount:1});
 assert.equal(await js("document.querySelector('.display-screen-blank').hidden"),true);
 assert.equal(await js("document.querySelector('.wall-panel').hidden"),true);
 assert.equal(sent.length,commandCount);await sleep(800);
 await js('window.realNow=Date.now;window.testNow=realNow();Date.now=()=>testNow;fdTest.wallBlanker.activity();fdTest.wallBlanker.check();testNow+=3600000;fdTest.wallBlanker.check()');
 assert.equal(await js('fdTest.wallBlanker.asleep()'),false,'Playing room protects Wall');
 raw[0].state='paused';publish();await sleep(150);await js('fdTest.wallBlanker.check();testNow+=900000;fdTest.wallBlanker.check()');
 assert.equal(await js('fdTest.wallBlanker.asleep()'),true,'Quiet Wall blanks after delay');
 raw[0].state='playing';publish();await sleep(150);assert.equal(await js('fdTest.wallBlanker.asleep()'),false,'Playback automatically wakes quiet-only Wall');
 await js('fdTest.wallCare.set("blankOnlySilent",false);fdTest.wallBlanker.activity();fdTest.wallBlanker.check();testNow+=900000;fdTest.wallBlanker.check()');
 assert.equal(await js('fdTest.wallBlanker.asleep()'),true,'Unconditional Wall mode blanks during playback');
 await js('fdTest.wallCare.set("blankMinutes",0);fdTest.wallBlanker.check();Date.now=realNow');
 assert.equal(await js('fdTest.wallBlanker.asleep()'),false);
 await js("document.querySelector('.wall-settings').click()");await pressText('Roon Radio by room');
 await js("document.querySelector('.wall-panel [aria-pressed]').click()");await sleep(150);
 assert.deepEqual(sent.at(-1),['settings','group',{auto_radio:true}]);
 await js("document.querySelector('.wall-panel [aria-pressed]').click()");await sleep(150);
 await pressText('Back to Deck settings');await pressText('Standby all players…');
 assert.equal(await js("document.querySelectorAll('.wall-standby-player').length"),1);
 await js("document.querySelector('.wall-standby-confirm').click()");await sleep(150);
 assert.deepEqual(sent.at(-1),['standby','living','amp']);
 console.log('PASS Deck settings, saved idle delay, playback protection, automatic wake, manual wake without click-through, Radio and reviewed standby');
 await go('/face/living?ui=tv',"!!globalThis.fdTest");await js("fdTest.openHierarchy('albums','Albums')");await sleep(400);
 await js("let l=document.querySelector('.browse-list');l.scrollTop=1300;");await sleep(150);
 const before=await js("Array.from(document.querySelectorAll('.browse-row')).filter(n=>n.getBoundingClientRect().bottom>document.querySelector('.browse-list').getBoundingClientRect().top)[3].textContent");
 await js("Array.from(document.querySelectorAll('.browse-row')).filter(n=>n.getBoundingClientRect().bottom>document.querySelector('.browse-list').getBoundingClientRect().top)[3].click()");await sleep(200);await js('fdTest.browseBack()');await sleep(300);
 assert.equal(await js("document.querySelector('.browse-key-current').textContent"),before);
 assert.ok(browses.filter(c=>c.offset>0).length>0);
 await js("document.querySelector('.browse-key-current').click()");await sleep(150);assert.ok(await js("document.querySelector('.browse-title').textContent.includes('Album tracks')"));
 await js("fdTest.showPicker('faces')");assert.ok(await js("document.querySelector('.row-display-care').textContent.includes('Brightness')"));
 await js('window.realNow=Date.now;window.testNow=realNow();Date.now=()=>testNow;fdTest.displayCare.set("blankMinutes",15);fdTest.faceBlanker.activity();fdTest.faceBlanker.check();testNow+=3600000;fdTest.faceBlanker.check()');
 assert.equal(await js('fdTest.faceBlanker.asleep()'),false,'Face stays visible during playback');
 raw[0].state='paused';publish();await sleep(150);await js('fdTest.faceBlanker.check();testNow+=900000;fdTest.faceBlanker.check()');
 assert.equal(await js('fdTest.faceBlanker.asleep()'),true,'Face blanks after room idle');
 raw[0].state='playing';publish();await sleep(150);assert.equal(await js('fdTest.faceBlanker.asleep()'),false,'Face wakes when its room plays');
 await js('fdTest.displayCare.set("blankMinutes",0);Date.now=realNow');
 await js('fdTest.showPicker("faces")');await sleep(600);
 await js("var blankOption=Array.from(document.querySelectorAll('.row-display-care .opt')).find(b=>b.textContent==='Blank display now');blankOption.dispatchEvent(new MouseEvent('mouseup',{bubbles:true,cancelable:true}));blankOption.dispatchEvent(new MouseEvent('click',{bubbles:true,cancelable:true}))");
 assert.equal(await js('fdTest.faceBlanker.asleep()'),true,'Blanking gesture echoes must not wake Face');await sleep(800);
 const beforeFaceWake=sent.length;
 await cdp('Input.dispatchMouseEvent',{type:'mousePressed',x:960,y:540,button:'left',clickCount:1});
 await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',x:960,y:540,button:'left',clickCount:1});
 assert.equal(await js('fdTest.faceBlanker.asleep()'),false);assert.equal(sent.length,beforeFaceWake);
 console.log('PASS Face stays visible playing, blanks idle, automatically wakes on playback');
 console.log('PASS Face Back preserves visible position and reselects with fresh keys; display options render');
 await go('/phone/group',"!!globalThis.fdTest");await js("fdTest.openSheet('browse')");await sleep(250);await js('fdTest.browseMore()');await sleep(100);await js("document.querySelector('.sheet-body').scrollTop=1800");
 const ordinal=await js("fdTest.browse.items[75].itemKey");await js('fdTest.browseInto(fdTest.browse.items[75])');await sleep(100);await js('fdTest.browseBack()');await sleep(150);assert.ok(await js('fdTest.browse.offset>0'));
 assert.ok(await js("document.querySelector('.browse-earlier')!==null"));await js("document.querySelector('.browse-earlier').click()");await sleep(150);
 console.log('PASS Phone Back and earlier-item paging');
 await go('/puck/living',"!!globalThis.fdTest");await js("fdTest.browse.open('albums')");await sleep(300);
 await js("let a=fdTest.browse.controllerView().choices.find(c=>c.title==='A');a.focus();a.activate()");await sleep(350);
 const picked=await js("var v=fdTest.browse.controllerView();v.choices[3].focus();v.choices[3].title");await js('fdTest.browse.commit()');await sleep(200);await js('fdTest.browse.back()');await sleep(250);
 assert.equal(await js("var v=fdTest.browse.controllerView();v.choices.find(c=>c.key===v.selected).title"),picked);
 await js('fdTest.browse.commit()');await sleep(150);
 await js("fdTest.browse.open('queue')");await sleep(250);await js("document.querySelector('.key-radio-q').click()");await sleep(150);assert.deepEqual(sent.at(-1),['settings','group',{auto_radio:true}]);
 await go('/puck/living',"!!globalThis.fdTest&&!!document.querySelector('.pc-face')");await sleep(300);
 const rim=async(side,wait=220)=>{const pt=await js(`(()=>{let b=document.querySelector('.rig').getBoundingClientRect();return {x:b.left+b.width*${side==='left'?'.025':'.975'},y:b.top+b.height/2};})()`);await cdp('Input.dispatchMouseEvent',{type:'mousePressed',...pt,button:'left',clickCount:1});await cdp('Input.dispatchMouseEvent',{type:'mouseReleased',...pt,button:'left',clickCount:1});await sleep(wait);};
 let startCommands=sent.length;await rim('right',40);assert.deepEqual(sent.slice(startCommands),[['volume','living',-48]],'Rim mark sets the exact fractional-device volume');
 const fills=[];for(let n=0;n<16;n++){fills.push(await js("document.querySelectorAll('.pc-volume-tick.lit').length"));await sleep(40);}
 assert.ok(new Set(fills).size>=3,'Confirmed volume animates through intermediate marks: '+fills);assert.equal(fills.at(-1),25);
 assert.equal(await js("document.querySelectorAll('.pc-rim-cue').length"),0);
 // Direct progress scrubbing is a different band from the volume wheel.
 const progressPoint=async(fraction)=>js(`(()=>{let b=document.querySelector('.glass').getBoundingClientRect(),a=${fraction}*Math.PI*2-Math.PI/2,r=b.width*166/360;return {x:b.left+b.width/2+r*Math.cos(a),y:b.top+b.height/2+r*Math.sin(a)};})()`);
 const pointer=async(type,point)=>cdp('Input.dispatchMouseEvent',{type,...point,button:'left',buttons:type==='mouseReleased'?0:1,clickCount:1});
 let quarter=await progressPoint(.25),half=await progressPoint(.5);startCommands=sent.length;
 await pointer('mousePressed',quarter);assert.equal(sent.length,startCommands);await pointer('mouseReleased',quarter);await sleep(180);assert.deepEqual(sent.slice(startCommands),[['seek','group',60]],'Progress click seeks once without changing volume');await sleep(750);
 startCommands=sent.length;await pointer('mousePressed',quarter);await pointer('mouseMoved',half);assert.equal(sent.length,startCommands);assert.equal(await js("document.querySelector('.pc-time').textContent"),'2:00 / 4:00');
 await pointer('mouseReleased',half);await sleep(180);assert.deepEqual(sent.slice(startCommands),[['seek','group',120]],'Dragging sends only the release position');await sleep(750);
 startCommands=sent.length;await pointer('mousePressed',quarter);await pointer('mouseMoved',half);await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Escape',code:'Escape',windowsVirtualKeyCode:27});await pointer('mouseReleased',half);await sleep(150);assert.equal(sent.length,startCommands,'Cancelled scrub sends nothing');await sleep(750);
 startCommands=sent.length;await pointer('mousePressed',quarter);raw[0].now_playing.three_line.line1='Changed during scrub';publish();await sleep(180);await pointer('mouseReleased',half);await sleep(180);assert.equal(sent.length,startCommands,'Changed track invalidates scrub');raw[0].now_playing.three_line.line1='Test album';publish();await sleep(750);
 console.log('PASS Progress click/drag seeks once on release; preview, cancellation and changed-track fencing');
 const scalePoint=async(f)=>js(`(()=>{let b=document.querySelector('.rig').getBoundingClientRect(),a=(${f}*350+5-90)*Math.PI/180,r=b.width*.4875;return {x:b.left+b.width/2+r*Math.cos(a),y:b.top+b.height/2+r*Math.sin(a)};})()`);
 const upperMark=await scalePoint(.95);startCommands=sent.length;await pointer('mousePressed',upperMark);await pointer('mouseReleased',upperMark);await sleep(120);assert.deepEqual(sent.at(-1),['volume','living',-15],'First press holds at comfort');
 await pointer('mousePressed',upperMark);await pointer('mouseReleased',upperMark);await sleep(160);assert.deepEqual(sent.at(-1),['volume','living',-12.5],'Second press reaches the same chosen mark above comfort');
 const gap=await scalePoint(-5/350);startCommands=sent.length;await pointer('mousePressed',gap);await pointer('mouseReleased',gap);assert.equal(sent.length,startCommands,'Top gap cannot confuse minimum with maximum');
 assert.equal(await js("document.querySelector('.pc-volume-scale').getAttribute('data-active')"),'1');assert.ok(await js("document.querySelector('.pc-wheel-hint').textContent.includes('Safe -10')"));
 console.log('PASS Volume scale: exact clicks, animated confirmed level, comfort double-tap and safety endpoint');

 startCommands=sent.length;await js("document.querySelector('.pc-time').click()");await rim('right');assert.equal(sent.length,startCommands,'Seek ring only previews');
 assert.equal(await js("document.querySelector('.pc-seek-time').textContent"),'0:15');
 await js("document.querySelector('.pc-menu .pc-left').click()");assert.equal(sent.length,startCommands,'Cancel does not seek');
 await js("document.querySelector('.pc-time').click()");await rim('right');await js("document.querySelector('.pc-menu .pc-right').click()");await sleep(180);assert.deepEqual(sent.at(-1),['seek','group',15]);
 await js("document.querySelector('.pc-now .pc-left').click()");await sleep(350);
 const selectedBefore=await js('fdTest.browse.controllerView().selected');startCommands=sent.length;const browseBefore=browses.length;
 await rim('right');assert.notEqual(await js('fdTest.browse.controllerView().selected'),selectedBefore);assert.equal(sent.length,startCommands,'Browse rim never changes volume');assert.equal(browses.length,browseBefore,'Browse rim never opens selected item');
 // A straight swipe down the right edge or up the left edge spins several choices.
 const edgeDrag=async(side,dy)=>{const p=await js(`(()=>{let b=document.querySelector('.rig').getBoundingClientRect();return {x:b.left+b.width*${side==='left'?'.025':'.975'},y:b.top+b.height/2,d:b.width*.12};})()`);await pointer('mousePressed',{x:p.x,y:p.y});await pointer('mouseMoved',{x:p.x,y:p.y+p.d*dy});const during=await js('fdTest.browse.controllerView().position');await pointer('mouseReleased',{x:p.x,y:p.y+p.d*dy});await sleep(180);assert.equal(await js('fdTest.browse.controllerView().position'),during,'Release adds no extra click');return during;};
 let dragBefore=await js('fdTest.browse.controllerView().position');startCommands=sent.length;const browsesBeforeDrag=browses.length;
 const afterRight=await edgeDrag('right',1);assert.ok(afterRight>=dragBefore+5,'Right-side drag generates multiple choices');
 const afterLeft=await edgeDrag('left',-1);assert.ok(afterLeft>=afterRight+5,'Left-side upward drag spins forward');assert.equal(sent.length,startCommands,'Fast menu drag never issues transport or volume');assert.equal(browses.length,browsesBeforeDrag,'Fast drag does not open a choice');
 console.log('PASS Left/right side drags generate multiple detents and release adds no click');
 const selectedAfter=await js('fdTest.browse.controllerView().selected');await js("document.querySelector('.pc-mini').click()");await js("document.querySelector('.pc-now .pc-left').click()");await sleep(150);assert.equal(await js('fdTest.browse.controllerView().selected'),selectedAfter,'Now Playing preserves browse position');
 await js("document.querySelector('.pc-mini').click();document.querySelector('.pc-now .pc-right').click()");await sleep(300);
 startCommands=sent.length;await rim('right');assert.equal(sent.length,startCommands);await js("document.querySelector('.pc-row-1').click()");assert.equal(sent.length,startCommands,'Queue choice requires its named action');
 assert.equal(await js("document.querySelector('.pc-queue-action').hidden"),false);await js("document.querySelector('.pc-queue-action').click()");await sleep(180);assert.equal(sent.at(-1)[0],'queue');
 await js("document.querySelector('.pc-mini').click()");startCommands=sent.length;await js("document.querySelector('.pc-art').focus()");
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await sleep(150);assert.equal(sent.length,startCommands+1,'Keyboard artwork activation must issue one command');
 await js("document.querySelector('.pc-now .pc-left').click()");await sleep(200);
 for(const size of [[1920,1080],[390,844],[360,360]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:1,mobile:false});await sleep(250);
  const row=await js("(()=>{let n=document.querySelector('.pc-row-1'),r=n.getBoundingClientRect();return {visible:r.width>0&&r.height>0,hit:n.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};})()");assert.ok(row.visible&&row.hit,'Readable and clickable selection at '+size.join('x'));
  const shot=await cdp('Page.captureScreenshot');writeFileSync(join(runDir,'puck-browse-'+size.join('x')+'.png'),Buffer.from(shot.data,'base64'));
 }
 await js("document.querySelector('.pc-mini').click()");await cdp('Emulation.setDeviceMetricsOverride',{width:1920,height:1080,deviceScaleFactor:1,mobile:false});await sleep(200);
 const nowShot=await cdp('Page.captureScreenshot');writeFileSync(join(runDir,'puck-now-playing.png'),Buffer.from(nowShot.data,'base64'));
 console.log('PASS Companion rim clicks: exact bounded volume, browse selection only, seek preview/cancel/apply, persistent browse position and three screen sizes');
 // Real Face -> Puck -> visible exit round trips, with a remembered Puck preference.
 const exitCommandCount=sent.length;
 const faceReady="!!document.querySelector('.picker.mode-faces:not([hidden]) [data-face-option=presence]')";
 async function waitFor(expression){for(let n=0;n<100;n++){await sleep(100);if(await js(expression))return;}throw new Error('Navigation did not settle: '+await js('location.href'));}
 const exitPoint=()=>js("(()=>{let b=document.querySelector('.pc-exit'),r=b.getBoundingClientRect();return {x:r.left+r.width/2,y:r.top+r.height/2,visible:r.width>=44&&r.height>=44&&r.left>=0&&r.top>=0&&r.right<=innerWidth&&r.bottom<=innerHeight,hit:b.contains(document.elementFromPoint(r.left+r.width/2,r.top+r.height/2))};})()");
 for(const size of [[1920,1080],[390,844],[360,360]]){
  await cdp('Emulation.setDeviceMetricsOverride',{width:size[0],height:size[1],deviceScaleFactor:1,mobile:false});
  await go('/face/living?ui=tv&panel=faces',faceReady);await sleep(650);
  await js("document.querySelector('[data-face-option=presence]').click()");await sleep(120);
  await js("document.querySelector('[data-face-option=puck]').click()");
  await waitFor("location.pathname==='/puck/living'&&!!document.querySelector('.pc-exit')");await sleep(200);
  assert.equal(await js("localStorage.getItem('flightdeck.face.group')"),'puck');
  await js("document.querySelector('.pc-now .pc-left').click()");await sleep(200);
  const pt=await exitPoint();assert.ok(pt.visible&&pt.hit,'Visible exit while browsing at '+size.join('x'));
  await pointer('mousePressed',{x:pt.x,y:pt.y});await pointer('mouseReleased',{x:pt.x,y:pt.y});
  await waitFor(faceReady);await sleep(300);
  assert.equal(await js('location.pathname'),'/face/living');
  assert.equal(await js("document.querySelector('#face').getAttribute('data-face')"),'presence');
  assert.equal(await js("localStorage.getItem('flightdeck.face.group')"),'presence');
 }
 // A group change must not send the chooser back to a different remembered Puck.
 await go('/puck/living',"!!document.querySelector('.pc-exit')");
 raw[0].zone_id='regrouped';publish();await sleep(200);
 await js("localStorage.setItem('flightdeck.face.regrouped','puck');localStorage.setItem('flightdeck.face.before.regrouped','aurora');document.querySelector('.pc-exit').focus()");
 await cdp('Input.dispatchKeyEvent',{type:'keyDown',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});await cdp('Input.dispatchKeyEvent',{type:'keyUp',key:'Enter',code:'Enter',windowsVirtualKeyCode:13});
 await waitFor(faceReady);await sleep(300);
 assert.equal(await js("document.querySelector('#face').getAttribute('data-face')"),'aurora');
 assert.equal(await js("localStorage.getItem('flightdeck.face.regrouped')"),'aurora');
 assert.equal(sent.length,exitCommandCount,'Leaving the simulator issues no player commands');
 console.log('PASS Visible Puck exit: three screen sizes, open Browse, keyboard activation, previous face restoration and regrouping without redirect loops');
 assert.equal(errors.length,0,JSON.stringify(errors));console.log('PASS Puck Back preserves selection with fresh keys, Radio toggles, no browser runtime exceptions');
 writeFileSync(join(runDir,'results.json'),JSON.stringify({passed:true,commands:sent,browseCalls:browses.length},null,2));
 console.log('Browser evidence:',runDir);
}finally{if(ws)ws.close();chrome.kill();hub.closeAll();server.close();}
