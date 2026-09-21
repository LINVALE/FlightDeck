import test from 'node:test';
import assert from 'node:assert/strict';
import {createSeekPreview,createRimDrag,rimVolumeFraction,volumeAtRim} from '../assets/puck-companion.js';
function fixture(){let state:any={generation:'g',position:10,zone:{id:'room',allowed:{seek:true},nowPlaying:{title:'Song',line2:'Artist',line3:'Album',lengthSec:120,art:{key:'cover'}}}};const sent:any[]=[];const preview=createSeekPreview(()=>state,(body:any)=>sent.push(body));return {state,sent,preview};}
test('turning previews five-second steps; Cancel sends nothing and Apply sends exactly once',()=>{
 const {preview,sent}=fixture();assert.equal(preview.open(),true);preview.turn(1);assert.equal(preview.value().seconds,15);assert.equal(sent.length,0);preview.cancel();assert.equal(sent.length,0);
 preview.open();preview.turn(-1);assert.equal(preview.apply(),true);assert.deepEqual(sent,[{action:'seek',zone:'room',seconds:5}]);assert.equal(preview.apply(),false);assert.equal(sent.length,1);
});
test('preview clamps to track bounds and refuses live or non-seekable sources',()=>{
 const {preview,state}=fixture();preview.open();preview.turn(100);assert.equal(preview.value().seconds,119);preview.turn(-100);assert.equal(preview.value().seconds,0);
 preview.cancel();state.zone.nowPlaying.lengthSec=null;assert.equal(preview.open(),false);state.zone.nowPlaying.lengthSec=120;state.zone.allowed.seek=false;assert.equal(preview.open(),false);
});
for(const change of ['Core','room','track','permission'])test('preview expires on changed '+change,()=>{
 const {preview,state,sent}=fixture();preview.open();if(change==='Core')state.generation='new';if(change==='room')state.zone.id='other';if(change==='track')state.zone.nowPlaying.title='Next';if(change==='permission')state.zone.allowed.seek=false;
 assert.equal(preview.apply(),false);assert.equal(sent.length,0);assert.equal(preview.value(),null);
});

test('direct scrub positions stay within playable bounds and commit only once',()=>{
 const {preview,sent}=fixture();preview.open();preview.position(.25);assert.equal(preview.value().seconds,30);preview.position(.75);assert.equal(preview.value().seconds,90);assert.equal(sent.length,0);preview.position(1);assert.equal(preview.value().seconds,119);preview.apply();preview.apply();assert.deepEqual(sent,[{action:'seek',zone:'room',seconds:119}]);
});

test('straight side drags emit multiple relative detents in wheel direction',()=>{
 const right=createRimDrag(100,0,10);assert.equal(right.move(100,60),6);assert.equal(right.tapped(),false);assert.equal(right.move(100,20),-4);
 const left=createRimDrag(-100,0,10);assert.equal(left.move(-100,-60),6);assert.equal(left.move(-100,-20),-4);
});
test('distance is independent of pointer event rate and a drag adds no release click',()=>{
 const coarse=createRimDrag(100,0,10),fine=createRimDrag(100,0,10);let steps=0;for(let y=1;y<=60;y++)steps+=fine.move(100,y);assert.equal(steps,coarse.move(100,60));assert.equal(coarse.move(100,60),0);assert.equal(coarse.tapped(),false);
 const click=createRimDrag(100,0,10);assert.equal(click.move(100,1),0);assert.equal(click.tapped(),true);
});
test('circular drags cross the angle seam without reversing and radial pulls do not turn',()=>{
 const circle=createRimDrag(-100,-1,10);assert.ok(circle.move(-100,-41)>0);
 const radial=createRimDrag(100,0,10);assert.equal(radial.move(200,0),0);assert.equal(radial.tapped(),false);
});

test('volume marks span the permitted minimum to safety, with a separate top gap',()=>{
 assert.equal(rimVolumeFraction(0),null);assert.equal(rimVolumeFraction(5),0);assert.equal(rimVolumeFraction(355),1);assert.equal(rimVolumeFraction(180),.5);
 const v={type:'db',min:-80,max:0,step:.5,hardLimitMin:-60,hardLimitMax:-10,softLimit:-15};
 assert.deepEqual(volumeAtRim(v,0,false),{value:-60,held:'none'});assert.deepEqual(volumeAtRim(v,.95,false),{value:-15,held:'comfort'});assert.deepEqual(volumeAtRim(v,.95,true),{value:-12.5,held:'none'});assert.deepEqual(volumeAtRim(v,1,true),{value:-10,held:'none'});
 assert.equal(volumeAtRim(v,1.01,true),null);assert.equal(volumeAtRim(v,null,true),null);assert.equal(volumeAtRim({...v,type:'incremental'},.5,true),null);
});
