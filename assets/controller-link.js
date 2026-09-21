/* One paired browser owns navigation; the device is an input and a small mirror. */
export function startController(adapter) {
  var display,tab='t'+Date.now().toString(36)+Math.random().toString(36).slice(2,9);
  try {display=localStorage.getItem('flightdeck.display');if(!display){display='d'+Date.now().toString(36)+Math.random().toString(36).slice(2,9);localStorage.setItem('flightdeck.display',display);}}catch(e){return {settings:function(){},paired:function(){return false;},output:function(){return '';}};}
  var link=document.createElement('link');link.rel='stylesheet';link.href='/assets/controller-link.css';document.head.appendChild(link);
  var lastNative='',paired=false,claim=true,busy=false,current='',lastOutput='',timer=null,dialog=null,screenName='This screen';
  try {lastOutput=localStorage.getItem('flightdeck.puck.output.'+display)||'';screenName=localStorage.getItem('flightdeck.screen-name')||('Screen '+innerWidth+' × '+innerHeight);}catch(e){}
  function hash(s){var n=2166136261;for(var i=0;i<s.length;i++)n=Math.imul(n^s.charCodeAt(i),16777619);return (n>>>0).toString(36);}
  function read(){
    var v=adapter.read(lastOutput);v.choices=v.choices||[];
    if(dialog){v.mode='controller-settings';v.title=screenName;v.open=true;v.choices=Array.prototype.map.call(dialog.querySelectorAll('button'),function(n,i){return {key:'connect:'+i+':'+n.textContent,title:n.textContent,node:n};});v.selected='';}
    if(v.output) {lastOutput=v.output;try{localStorage.setItem('flightdeck.puck.output.'+display,lastOutput);}catch(e){}}
    else v.output=lastOutput;
    if(v.selected&&v.selected!==lastNative){current=v.selected;lastNative=v.selected;}
    var selected=current||v.selected,at=-1;
    for(var i=0;i<v.choices.length;i++)if(v.choices[i].key===selected){at=i;break;}
    if(at<0)at=0;if(v.choices[at])current=v.choices[at].key;
    v.context=hash(v.output+'|'+v.mode+'|'+v.title+'|'+v.choices.map(function(c){return c.key;}).join('|'));
    v.selectedIndex=at;return v;
  }
  function wire(v){return {output:v.output||'',room:v.room||'',context:v.context,title:v.title||'',open:v.open===true,face:v.face||0,total:v.choices.length,selected:v.selectedIndex,busy:v.busy===true,volume:v.volume||null,
    items:v.choices.slice(Math.max(0,v.selectedIndex-5),v.selectedIndex+6).map(function(c,i){return {key:String(Math.max(0,v.selectedIndex-5)+i)+'-'+hash(c.key),title:(c.title||'').slice(0,72),subtitle:(c.subtitle||'').slice(0,72),index:Math.max(0,v.selectedIndex-5)+i};})};}
  function focus(c){if(!c)return;current=c.key;var old=document.querySelectorAll('.controller-current');for(var i=0;i<old.length;i++)old[i].classList.remove('controller-current');if(c.node)c.node.classList.add('controller-current');if(c.focus){c.focus();lastNative=adapter.read(lastOutput).selected||'';}else if(c.node){c.node.focus();try{c.node.scrollIntoView({block:'nearest'});}catch(e){}}}
  function execute(input){
    var v=read();if(v.context!==input.context||v.output!==input.output)return;
    if(adapter.wake)adapter.wake();
    if(input.type==='move'){
      if(adapter.move&&adapter.move(input.value))return;
      if(v.choices.length){var at=Math.max(0,Math.min(v.choices.length-1,v.selectedIndex+input.value));focus(v.choices[at]);}return;
    }
    if(input.type==='pick'||input.type==='commit'){
      var c=null;for(var i=0;i<v.choices.length;i++)if(String(i)+'-'+hash(v.choices[i].key)===input.key)c=v.choices[i];
      if(!c)return;focus(c);if(c.activate)c.activate();else if(c.node)c.node.click();return;
    }
    adapter.command(input.type,input.value,v.output);
  }
  function post(body){return new Promise(function(resolve,reject){
    var xhr=new XMLHttpRequest();xhr.open('POST','/api/v1/controllers');xhr.timeout=1500;xhr.setRequestHeader('Content-Type','application/json');
    xhr.onload=function(){try{var data=JSON.parse(xhr.responseText);if(xhr.status<200||xhr.status>=300)throw Error(data.error||'Puck link unavailable');resolve(data);}catch(e){reject(e);}};
    xhr.onerror=xhr.ontimeout=function(){reject(Error('Puck link unavailable'));};xhr.send(JSON.stringify(body));
  });}
  function poll(){
    if(busy)return Promise.resolve();busy=true;
    var v=read();return post({op:'screen',display:display,tab:tab,name:screenName,claim:claim,state:wire(v)}).then(function(data){
      claim=false;paired=data.paired===true;
      if(data.output&&!lastOutput){lastOutput=data.output;}
      if(data.active===true){(data.inputs||[]).forEach(execute);}
      document.documentElement.setAttribute('data-puck-linked',paired?'1':'0');
    }).catch(function(){/* An absent server neither replays input nor changes a room. */}).then(function(){busy=false;clearTimeout(timer);timer=setTimeout(poll,paired?150:1200);});
  }
  window.addEventListener('focus',function(){claim=true;poll();});
  document.addEventListener('focusin',function(e){var v=read();for(var i=0;i<v.choices.length;i++)if(v.choices[i].node&&(v.choices[i].node===e.target||v.choices[i].node.contains(e.target)))current=v.choices[i].key;});
  document.addEventListener('mouseover',function(e){if(!paired)return;var v=read();for(var i=0;i<v.choices.length;i++)if(v.choices[i].node&&(v.choices[i].node===e.target||v.choices[i].node.contains(e.target)))current=v.choices[i].key;});
  function settings(){
    var autoConnect=true;
    if(dialog)dialog.remove();dialog=document.createElement('section');dialog.className='controller-settings';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-label','Connect puck');
    var heading=document.createElement('h2');heading.textContent='Connect puck';dialog.appendChild(heading);
    var label=document.createElement('label');label.textContent='Screen name';var name=document.createElement('input');name.value=screenName;name.maxLength=64;label.appendChild(name);dialog.appendChild(label);
    var note=document.createElement('p');note.textContent='This screen and its puck share rooms, Browse and Queue.';dialog.appendChild(note);
    var list=document.createElement('div');dialog.appendChild(list);
    function button(text,run){var b=document.createElement('button');b.textContent=text;b.onclick=run;return b;}
    function refresh(){list.textContent='Looking for pucks…';claim=true;screenName=name.value.trim()||'This screen';try{localStorage.setItem('flightdeck.screen-name',screenName);}catch(e){}
      poll().then(function(){return fetch('/api/v1/controllers',{cache:'no-store'});}).then(function(r){return r.json();}).then(function(data){list.textContent='';(data.devices||[]).forEach(function(d){list.appendChild(button(d.name+(d.display===display?' · connected':d.display?' · move link here':''),function(){screenName=name.value.trim()||'This screen';post({op:'pair',display:display,tab:tab,device:d.id,replace:!!d.display}).then(function(){paired=true;note.textContent='Connected to '+d.name+'. Choose a room on either device.';poll();refresh();}).catch(function(e){note.textContent=e.message;});}));});if(!list.childNodes.length)list.textContent='No puck is online yet.';if(autoConnect){autoConnect=false;if(data.devices&&data.devices.length===1&&!data.devices[0].display)list.firstChild.click();}}).catch(function(e){list.textContent=e.message;});}
    dialog.appendChild(button('Refresh',refresh));dialog.appendChild(button('Disconnect puck',function(){post({op:'unpair',display:display,tab:tab}).then(function(){paired=false;note.textContent='Disconnected. The puck returns to standalone control.';refresh();}).catch(function(e){note.textContent=e.message;});}));
    var close=button('Close',function(){dialog.remove();dialog=null;});dialog.appendChild(close);document.body.appendChild(dialog);close.focus();refresh();
  }
  window.addEventListener('keydown',function(e){
    if(!dialog)return;
    var key=e.key||({13:'Enter',27:'Escape',32:' ',38:'ArrowUp',40:'ArrowDown'})[e.keyCode];
    if(key==='Escape'){e.preventDefault();e.stopImmediatePropagation();dialog.remove();dialog=null;return;}
    var nodes=Array.prototype.slice.call(dialog.querySelectorAll('input,button')),at=nodes.indexOf(document.activeElement);
    if(key==='ArrowDown'||key==='ArrowUp'||key==='Tab'){
      e.preventDefault();e.stopImmediatePropagation();var delta=key==='ArrowUp'||(key==='Tab'&&e.shiftKey)?-1:1;nodes[(at+delta+nodes.length)%nodes.length].focus();return;
    }
    if((key==='Enter'||key===' ')&&document.activeElement.tagName==='BUTTON'){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)document.activeElement.click();}
  },true);
  poll();return {settings:settings,output:function(){return lastOutput;},paired:function(){return paired;}};
}
export function controllerPreview(seconds) {
  var node=document.querySelector('.controller-seek-preview');
  if(seconds<0){if(node)node.remove();return;}
  if(!node){node=document.createElement('div');node.className='controller-seek-preview';document.body.appendChild(node);}
  node.textContent=Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+' · release to seek';
  clearTimeout(node._expiry);node._expiry=setTimeout(function(){if(node.parentNode)node.remove();},1200);
}

var volumeUntil=0;
export function controllerVolume(output,show) {
  if(show)volumeUntil=Date.now()+2500;
  var node=document.querySelector('.controller-volume');
  if(Date.now()>volumeUntil||!output){if(node)node.remove();return;}
  if(!node){node=document.createElement('div');node.className='controller-volume';node.setAttribute('role','status');document.body.appendChild(node);}
  var v=output.volume;node.textContent=output.name+' · '+(v?(v.muted?'Muted':'Volume '+(v.value===null?'—':v.value)):'Volume unavailable');
}
