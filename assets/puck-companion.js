import { formatTime } from './store.js';
import { seekTargetSecond } from './seek-target.js';
import { limitsOf, askedLevel, createDoubleTap } from './volume-limits.js';

/** A preview is valid only for the room, Core and track it was opened on. */
export function seekIdentity(state) {
  var z = state.zone, n = z && z.nowPlaying;
  return n ? JSON.stringify([state.generation,z.id,n.title,n.line2,n.line3,n.lengthSec,n.art && n.art.key]) : '';
}
export function createSeekPreview(read, send) {
  var held = null;
  function valid() { var s=read();return held && held.key===seekIdentity(s) && s.zone.allowed.seek; }
  return {
    open: function () { var s=read(),n=s.zone&&s.zone.nowPlaying;if(!n||!s.zone.allowed.seek||!(n.lengthSec>0)||s.position===null)return false;held={key:seekIdentity(s),seconds:s.position,length:n.lengthSec};return true; },
    value: function () { if(held&&!valid())held=null;return held; },
    turn: function (step) { if(valid())held.seconds=Math.max(0,Math.min(Math.max(0,Math.ceil(held.length)-1),held.seconds+step*5)); },
    position: function (fraction) { if(valid())held.seconds=seekTargetSecond(fraction,held.length); },
    cancel: function () { held=null; },
    apply: function () { if(!valid()){held=null;return false;}var seconds=held.seconds;held=null;send({action:'seek',zone:read().zone.id,seconds:seconds});return true; }
  };
}

/** Relative steps from the hand's travelled distance, including straight side drags. */
export function createRimDrag(x, y, pixelsPerStep) {
  var previousX=x,previousY=y,carry=0,travel=0;
  return {
    move:function(nextX,nextY){
      var dx=nextX-previousX,dy=nextY-previousY,distance=Math.sqrt(dx*dx+dy*dy);
      var cross=previousX*nextY-previousY*nextX;
      previousX=nextX;previousY=nextY;travel+=distance;
      // A radial pull does not turn the wheel. Clockwise travel is positive.
      if(Math.abs(cross)<.001)return 0;
      carry+=(cross>0?1:-1)*distance;
      var steps=carry<0?Math.ceil(carry/pixelsPerStep):Math.floor(carry/pixelsPerStep);
      carry-=steps*pixelsPerStep;return steps;
    },
    tapped:function(){return travel<Math.min(6,pixelsPerStep/2);}
  };
}

/** A small gap at twelve separates the minimum from the safety endpoint. */
export function rimVolumeFraction(degrees) {
  var angle=((degrees%360)+360)%360;
  return angle<5||angle>355?null:(angle-5)/350;
}
export function volumeAtRim(volume, fraction, override) {
  if(!volume||volume.type==='incremental'||fraction===null||!isFinite(fraction)||fraction<0||fraction>1)return null;
  var limits=limitsOf(volume);
  return askedLevel(limits.min+fraction*(limits.safety-limits.min),limits,override);
}

/** A round, readable face over the existing navigation and command owners. */
export function createPuckCompanion(options) {
  var rig=options.rig,glass=options.glass,root=options.root,browse=options.browse;
  root.setAttribute('data-companion','1');
  var face=document.createElement('section');face.className='pc-face';face.setAttribute('aria-label','Puck');glass.appendChild(face);
  function node(tag,cls,text,parent){var n=document.createElement(tag);n.className=cls;if(text)n.textContent=text;(parent||face).appendChild(n);return n;}
  function button(cls,label,run,parent){var n=node('button',cls,label,parent);n.type='button';n.addEventListener('click',function(e){e.stopPropagation();run();draw();});return n;}
  var exit=button('pc-exit','',options.faces,root);exit.setAttribute('aria-label','Other faces');exit.title='Other faces';
  node('span','pc-exit-arrow','←',exit);node('span','pc-exit-label','Other faces',exit);root.insertBefore(exit,root.firstChild);
  var status=button('pc-room','',function(){preview.cancel();confirmation=null;browse.open('rooms');});
  var roomText=node('span','pc-room-name','',status),volumeText=node('span','pc-room-volume','',status);
  var arc=node('div','pc-progress');arc.innerHTML='<svg viewBox="0 0 360 360" aria-hidden="true"><circle class="pc-track" cx="180" cy="180" r="166"/><circle class="pc-played" cx="180" cy="180" r="166"/></svg>';
  var played=arc.querySelector('.pc-played');
  var now=node('div','pc-now'),title=node('div','pc-title','',now),artist=node('div','pc-artist','',now);
  var time=button('pc-time','',function(){if(preview.open())confirmation=null;},now);
  var play=button('pc-art','',function(){options.transport('playpause');},now);
  var art=node('img','pc-art-image','',play);art.alt='';art.draggable=false;
  node('span','pc-art-shade','',play);var playMark=node('span','pc-play-mark','',play);
  var prev=button('pc-previous','',function(){options.transport('previous');},now);prev.setAttribute('aria-label','Previous track');prev.appendChild(options.glyph('prev'));
  var next=button('pc-next','',function(){options.transport('next');},now);next.setAttribute('aria-label','Next track');next.appendChild(options.glyph('next'));
  button('pc-bottom pc-left','Browse',function(){browse.open('browse');},now);
  button('pc-bottom pc-right','Queue',function(){browse.open('queue');},now);
  var menu=node('div','pc-menu');
  var mini=button('pc-mini','',home,menu),miniArt=node('img','pc-mini-art','',mini);miniArt.alt='';
  var miniCopy=node('span','pc-mini-copy','',mini),miniTitle=node('strong','','',miniCopy),miniArtist=node('small','','',miniCopy);node('span','pc-return','↗',mini);
  var crumb=button('pc-crumb','',function(){var n=glass.querySelector('.level-name');if(n)n.click();},menu);
  var rows=[];for(var i=0;i<3;i++)(function(slot){rows.push(button('pc-row pc-row-'+slot,'',function(){var view=browse.controllerView(),at=selected(view)+slot-1,choice=view.choices[at];if(!choice||view.busy)return;if(slot!==1){choice.focus();return;}if(view.mode==='queue'){confirmation={key:choice.key,title:choice.title};}else choice.activate();},menu));})(i);
  var count=node('div','pc-count','',menu);
  var back=button('pc-bottom pc-left','‹ Back',function(){if(preview.value()){preview.cancel();return;}if(confirmation){confirmation=null;return;}browse.back();},menu);
  var homeButton=button('pc-bottom pc-right','Now Playing',home,menu);
  var seek=node('div','pc-seek','',menu);node('div','pc-seek-label','SEEK',seek);var seekTime=node('div','pc-seek-time','',seek),seekLength=node('div','pc-seek-length','',seek);node('div','pc-seek-help','Turn the rim to preview',seek);
  var queueAction=button('pc-queue-action','',function(){var v=browse.controllerView();if(confirmation&&v.mode==='queue'&&v.selected===confirmation.key&&!v.busy){confirmation=null;browse.commit();}},menu);
  var tools=button('pc-tools','···',function(){toolMenu.hidden=!toolMenu.hidden;},face);tools.setAttribute('aria-label','Puck options');
  var toolMenu=node('div','pc-options');toolMenu.hidden=true;
  function tool(label,run){return button('',label,function(){toolMenu.hidden=true;run();},toolMenu);}
  tool('Rooms',function(){preview.cancel();browse.open('rooms');});tool('Search',function(){preview.cancel();browse.open('search');});
  var radioTool=tool('Roon Radio',function(){var z=options.read().zone;if(z)options.send({action:'radio',zone:z.id});});
  var muteTool=tool('Mute / unmute',function(){var o=options.read().output;if(o&&o.volume)options.send({action:'mute',output:o.id,muted:!o.volume.muted});});
  tool('Shuffle',function(){options.transport('shuffle');});tool('Repeat',function(){options.transport('repeat');});
  var pullTool=tool('Pull from selected room',function(){var n=glass.querySelector('.key-pull');if(n&&browse.at()==='rooms')n.click();});
  var shiftTool=tool('Shift to selected room',function(){var n=glass.querySelector('.key-shift');if(n&&browse.at()==='rooms')n.click();});
  tool('Connect puck',options.settings);tool('Other faces',options.faces);tool('Back to Wall',options.home);
  var spelling=node('div','pc-spelling','',menu);
  ['Space','Delete','Clear','Search'].forEach(function(name){button('',name,function(){var v=browse.controllerView(),c=v.choices.filter(function(c){return c.key==='spell:'+name;})[0];if(c)c.activate();},spelling);});
  var svgNS='http://www.w3.org/2000/svg';
  var scale=document.createElementNS(svgNS,'svg');scale.setAttribute('class','pc-volume-scale');scale.setAttribute('viewBox','0 0 100 100');scale.setAttribute('aria-hidden','true');rig.appendChild(scale);
  var scaleTicks=[];
  function scaleLine(className){var line=document.createElementNS(svgNS,'line');line.setAttribute('class',className);scale.appendChild(line);return line;}
  function placeMark(line,fraction,inner){var a=(fraction*350+5-90)*Math.PI/180;line.setAttribute('x1',50+inner*Math.cos(a));line.setAttribute('y1',50+inner*Math.sin(a));line.setAttribute('x2',50+49.65*Math.cos(a));line.setAttribute('y2',50+49.65*Math.sin(a));}
  for(var mark=0;mark<=100;mark++){var line=scaleLine('pc-volume-tick');placeMark(line,mark/100,mark%10===0?47.15:47.8);scaleTicks.push(line);}
  var comfortMark=scaleLine('pc-volume-comfort'),safeMark=scaleLine('pc-volume-safe'),levelMark=scaleLine('pc-volume-current');
  var volumeTaps=createDoubleTap(700),wheelModel=null,wheelKey='',wheelShown=null,wheelTarget=null,wheelFrame=0;
  function paintWheel(){
    var model=wheelModel;if(!model)return;
    scaleTicks.forEach(function(tick,i){var f=i/100;tick.setAttribute('class','pc-volume-tick'+(i%10===0?' major':'')+(model.active&&f>model.comfort?' comfort':'')+(model.active&&f<=wheelShown+0.00001?' lit':''));});
    comfortMark.style.display=model.active?'':'none';safeMark.style.display=model.active?'':'none';levelMark.style.display=model.active?'':'none';
    if(model.active){placeMark(comfortMark,model.comfort,46.95);placeMark(safeMark,1,46.95);placeMark(levelMark,wheelShown,46.85);}
  }
  function updateWheel(volume,active,output){
    var limits=volume?limitsOf(volume):null,span=limits?limits.safety-limits.min:0;
    active=!!(active&&volume&&volume.type!=='incremental'&&typeof volume.value==='number'&&span>0);
    var key=active?[output,limits.min,limits.safety,limits.comfort].join('|'):'inactive';
    wheelModel={active:active,comfort:active?(limits.comfort-limits.min)/span:1};
    var fraction=active?Math.max(0,Math.min(1,(volume.value-limits.min)/span)):0;
    if(key!==wheelKey||wheelShown===null){if(wheelFrame)cancelAnimationFrame(wheelFrame);wheelFrame=0;wheelKey=key;wheelShown=fraction;wheelTarget=fraction;}
    else if(fraction!==wheelTarget){
      if(wheelFrame)cancelAnimationFrame(wheelFrame);
      var from=wheelShown,started=performance.now();wheelTarget=fraction;
      function animate(at){var t=Math.max(0,Math.min(1,(at-started)/320));wheelShown=from+(fraction-from)*(1-Math.pow(1-t,3));paintWheel();wheelFrame=t<1?requestAnimationFrame(animate):0;}
      wheelFrame=requestAnimationFrame(animate);
    }
    scale.setAttribute('data-active',active?'1':'0');paintWheel();
  }
  function setWheelVolume(fraction){
    var state=options.read(),output=state.output,volume=output&&output.volume;
    if(!volume||volume.type==='incremental')return;
    var full=volumeAtRim(volume,fraction,true);if(!full)return;
    var override=volumeTaps.press(state.generation+'|'+output.id+'|'+full.value,Date.now());
    var asked=volumeAtRim(volume,fraction,override);if(!asked)return;
    if(asked.held==='comfort'&&options.flash)options.flash('Comfort limit · tap the same mark again to go higher');
    options.send({action:'volume',output:output.id,value:asked.value,override:override});
  }
  var hint=node('div','pc-wheel-hint','',root);hint.setAttribute('aria-live','polite');
  var preview=createSeekPreview(options.read,options.send),confirmation=null,drag=null,scrub=null,scrubClickUntil=0;
  var scrubPreview=createSeekPreview(options.read,options.send);
  function selected(v){for(var i=0;i<v.choices.length;i++)if(v.choices[i].key===v.selected)return i;return 0;}
  function home(){preview.cancel();confirmation=null;browse.park();toolMenu.hidden=true;}
  function rotate(dir){if(preview.value())preview.turn(dir);else if(browse.isOpen()){confirmation=null;browse.move(dir);}else options.turn(dir);draw();}
  function picture(img,path){if(path){if(img.getAttribute('src')!==path)img.src=path;img.hidden=false;}else{img.removeAttribute('src');img.hidden=true;}}
  function draw(){
    var state=options.read(),z=state.zone,n=z&&z.nowPlaying,v=browse.controllerView(),p=preview.value(),index=selected(v),menuOpen=v.open||!!p;
    if(confirmation&&(v.selected!==confirmation.key||v.mode!=='queue'))confirmation=null;
    now.hidden=menuOpen;menu.hidden=!menuOpen;arc.hidden=menuOpen&&!p;
    var playing=z&&(z.state==='playing'||z.state==='loading'),o=state.output,vol=o&&o.volume;
    roomText.textContent=z?z.name:'Choose a room';status.title=roomText.textContent;
    volumeText.textContent=menuOpen?'':(vol?(vol.muted?'MUTED':'VOL '+(vol.value===null?'±':vol.value)):'FIXED');
    pullTool.hidden=shiftTool.hidden=v.mode!=='rooms';radioTool.disabled=!z||!z.settings;radioTool.textContent='Roon Radio · '+(z&&z.settings&&z.settings.autoRadio?'On':'Off');muteTool.disabled=!vol;muteTool.textContent=vol&&vol.muted?'Unmute':'Mute';
    status.setAttribute('data-playing',playing?'1':'0');
    title.textContent=n?n.title:'Nothing playing';title.title=title.textContent;artist.textContent=n?[n.line2,n.line3].filter(Boolean).join(' · '):'';
    var canSeek=n&&z.allowed.seek&&n.lengthSec>0&&state.position!==null;
    time.textContent=n?(canSeek?formatTime(state.position)+' / '+formatTime(n.lengthSec):'LIVE'):'';time.disabled=!canSeek;
    play.disabled=!z||!(playing?z.allowed.pause:z.allowed.play);prev.disabled=!z||!z.allowed.previous;next.disabled=!z||!z.allowed.next;
    var label=playing?'Pause':'Play';if(playMark.getAttribute('data-label')!==label){playMark.textContent='';playMark.appendChild(options.glyph(playing?'pause':'play'));node('span','pc-play-word',label,playMark);playMark.setAttribute('data-label',label);}play.setAttribute('aria-label',label);
    picture(art,n&&n.art?n.art.path:null);picture(miniArt,n&&n.art?n.art.path:null);miniTitle.textContent=n?n.title:'Now Playing';miniArtist.textContent=n?n.line2:'';
    var scrubbing=scrub&&scrubPreview.value();
    if(scrubbing)time.textContent=formatTime(scrubbing.seconds)+' / '+formatTime(n.lengthSec);
    var fraction=canSeek?(scrubbing?scrubbing.seconds:p?p.seconds:state.position)/n.lengthSec:0;played.style.strokeDasharray=String(2*Math.PI*166);played.style.strokeDashoffset=String(2*Math.PI*166*(1-Math.max(0,Math.min(1,fraction))));
    updateWheel(vol,!menuOpen,o?o.id:'');
    var role=p?'Seek · 5 seconds':v.open?'Choose':'Volume';hint.textContent=drag?'Drag to turn · '+role:'‹  '+role+'  ›';rig.setAttribute('aria-label',menuOpen?'Puck dial: turn to move the selection':'Volume scale: click a mark to set volume, drag to turn');rig.title=menuOpen?'Click or drag the rim to turn · '+role:'Click a volume mark · drag or scroll to turn';
    if(wheelModel.active&&!scrubbing){var bounds=limitsOf(vol),unit=vol.type==='db'?' dB':'';hint.textContent='Comfort '+bounds.comfort+unit+' · Safe '+bounds.safety+unit;}
    if(scrubbing)hint.textContent='Seek · '+formatTime(scrubbing.seconds)+' · release to apply';
    crumb.textContent=v.busy?'Loading…':v.title;crumb.disabled=!!p||!!confirmation;seek.hidden=!p;queueAction.hidden=!confirmation;
    rows.forEach(function(row,slot){var choice=v.choices[index+slot-1];row.hidden=!!p||!!confirmation;row.disabled=!choice||v.busy;row.textContent=choice?choice.title+(slot===1?'  ›':''):'';row.title=choice?[choice.title,choice.subtitle].filter(Boolean).join(' · '):'';row.setAttribute('aria-current',slot===1?'true':'false');});
    count.hidden=!!p||!!confirmation;count.textContent=v.choices.length?(v.position+1)+' of '+v.total+' · tap to open':v.busy?'Loading…':'No items';
    spelling.hidden=v.mode!=='spell'||!!confirmation;
    back.textContent=p?'Cancel':'‹ Back';homeButton.textContent=p?'Apply':'Now Playing';
    if(p){seekTime.textContent=formatTime(p.seconds);seekLength.textContent='of '+formatTime(p.length)+' · from '+formatTime(state.position);}
    if(confirmation)queueAction.textContent=(glass.querySelector('.key-play').getAttribute('title')==='pause'?'Pause':glass.querySelector('.key-play').getAttribute('title')==='play'?'Play':'Play from here')+' · '+confirmation.title;
  }
  // Apply belongs to the explicit button, not to an incidental click on the ring.
  homeButton.addEventListener('click',function(e){if(preview.value()){e.stopImmediatePropagation();preview.apply();draw();}},true);
  function scrubAt(e){
    var b=glass.getBoundingClientRect(),x=e.clientX-b.left-b.width/2,y=e.clientY-b.top-b.height/2;
    if(Math.sqrt(x*x+y*y)<b.width*.15)return;
    var fraction=((Math.atan2(y,x)+Math.PI/2)/(2*Math.PI)+1)%1;
    scrubPreview.position(fraction);draw();
  }
  function stopScrub(commit){
    if(!scrub)return;
    var held=scrub;scrub=null;scrubClickUntil=Date.now()+700;
    if(commit&&!browse.isOpen())scrubPreview.apply();else scrubPreview.cancel();
    try{rig.releasePointerCapture(held.id);}catch(e){}
    draw();
  }
  rig.addEventListener('pointerdown',function(e){
    if(e.button!==0||scrub||drag||browse.isOpen()||!toolMenu.hidden||arc.hidden)return;
    if(e.target.closest&&e.target.closest('button'))return;
    var b=rig.getBoundingClientRect(),x=e.clientX-b.left-b.width/2,y=e.clientY-b.top-b.height/2,r=Math.sqrt(x*x+y*y)/(b.width/2);
    // The progress arc sits at 0.87 of the rig radius. The outer wheel starts at 0.90.
    if(r<.82||r>=.90)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(!scrubPreview.open())return;
    preview.cancel();scrub={id:e.pointerId};rig.setPointerCapture(e.pointerId);scrubAt(e);
  },true);
  rig.addEventListener('pointermove',function(e){if(!scrub||scrub.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();scrubAt(e);},true);
  rig.addEventListener('pointerup',function(e){if(!scrub||scrub.id!==e.pointerId)return;e.preventDefault();e.stopImmediatePropagation();scrubAt(e);stopScrub(true);},true);
  rig.addEventListener('pointercancel',function(e){if(scrub&&scrub.id===e.pointerId){e.stopImmediatePropagation();stopScrub(false);}},true);
  rig.addEventListener('lostpointercapture',function(e){if(scrub&&scrub.id===e.pointerId)stopScrub(false);},true);
  rig.addEventListener('click',function(e){if(Date.now()<scrubClickUntil){e.preventDefault();e.stopImmediatePropagation();}},true);
  function dragContext(){var s=options.read();return s.generation+'|'+(s.output?s.output.id:'')+'|'+(preview.value()?'seek':browse.isOpen()?'browse':'volume');}
  function moveRim(e){
    if(!drag||drag.id!==e.pointerId)return;
    e.preventDefault();e.stopImmediatePropagation();
    if(drag.context!==dragContext()){endRim(false);return;}
    var b=rig.getBoundingClientRect(),steps=drag.motion.move(e.clientX-b.left-b.width/2,e.clientY-b.top-b.height/2);
    var dir=steps<0?-1:1;for(var i=0;i<Math.abs(steps);i++)rotate(dir);
  }
  function endRim(click){
    if(!drag)return;
    var held=drag;drag=null;if(!held.motion.tapped())scrubClickUntil=Date.now()+100;
    rig.removeAttribute('data-rim-drag');
    try{rig.releasePointerCapture(held.id);}catch(e){}
    if(click&&held.motion.tapped()&&held.context===dragContext()){
      var volume=options.read().output;
      if(!browse.isOpen()&&!preview.value()&&volume&&volume.volume&&volume.volume.type!=='incremental')setWheelVolume(held.fraction);else rotate(held.side);
    }
  }
  rig.addEventListener('pointerdown',function(e){
    var b=rig.getBoundingClientRect(),x=e.clientX-b.left-b.width/2,y=e.clientY-b.top-b.height/2,r=Math.sqrt(x*x+y*y)/(b.width/2);
    if(r<.90||r>1.04||e.button!==0||scrub||drag)return;
    e.preventDefault();e.stopImmediatePropagation();
    var choosing=browse.isOpen()||!!preview.value(),spacing=Math.max(choosing?5:8,b.width*(choosing ? .015 : .035));
    drag={id:e.pointerId,side:x<0?-1:1,fraction:rimVolumeFraction(Math.atan2(y,x)*180/Math.PI+90),context:dragContext(),motion:createRimDrag(x,y,spacing)};
    rig.setAttribute('data-rim-drag','1');rig.setPointerCapture(e.pointerId);
  },true);
  rig.addEventListener('pointermove',moveRim,true);
  rig.addEventListener('pointerup',function(e){if(!drag||drag.id!==e.pointerId)return;moveRim(e);endRim(true);},true);
  rig.addEventListener('pointercancel',function(e){if(drag&&drag.id===e.pointerId){e.stopImmediatePropagation();endRim(false);}},true);
  rig.addEventListener('lostpointercapture',function(e){if(drag&&drag.id===e.pointerId)endRim(false);},true);
  window.addEventListener('blur',function(){stopScrub(false);endRim(false);});
  document.addEventListener('visibilitychange',function(){if(document.hidden){stopScrub(false);endRim(false);}});
  // Keep the retired glass gestures from interpreting presses on the new face.
  ['pointerdown','pointerup','click'].forEach(function(kind){face.addEventListener(kind,function(e){e.stopPropagation();});});
  root.addEventListener('wheel',function(e){if(toolMenu.contains(e.target))return;if(scrub){e.preventDefault();e.stopPropagation();return;}e.preventDefault();e.stopPropagation();options.scroll(e,rotate);},{passive:false});
  root.tabIndex=0;
  window.addEventListener('keydown',function(e){if(document.querySelector('.controller-settings')||e.target.tagName==='INPUT'||e.target.tagName==='SELECT')return;
    if(drag){if(e.key==='Escape')endRim(false);e.preventDefault();e.stopImmediatePropagation();return;}
    if(scrub){if(e.key==='Escape')stopScrub(false);e.preventDefault();e.stopImmediatePropagation();return;}
    if(e.repeat&&(e.key==='Enter'||e.key===' ')){e.preventDefault();e.stopImmediatePropagation();return;}
    if(e.key==='ArrowLeft'||e.key==='ArrowUp'){e.preventDefault();e.stopImmediatePropagation();rotate(-1);}
    else if(e.key==='ArrowRight'||e.key==='ArrowDown'){e.preventDefault();e.stopImmediatePropagation();rotate(1);}
    else if(e.key==='Escape'||e.key==='Backspace'){e.preventDefault();e.stopImmediatePropagation();if(!toolMenu.hidden)toolMenu.hidden=true;else if(preview.value())preview.cancel();else if(confirmation)confirmation=null;else browse.back();draw();}
    else if((e.key==='Enter'||e.key===' ')&&e.target.tagName!=='BUTTON'){e.preventDefault();e.stopImmediatePropagation();if(preview.value())preview.apply();else if(vOpen())rows[1].click();else options.transport('playpause');draw();}
    else if((e.key==='Enter'||e.key===' ')&&e.target.tagName==='BUTTON'){e.preventDefault();e.stopImmediatePropagation();e.target.click();}
  },true);
  function vOpen(){return browse.isOpen();}
  setInterval(draw,200);draw();
  return {draw:draw,turn:rotate,home:home,preview:preview};
}
