/** Battery status comes from physical Pucks, never from this browser's battery. */
/**
 * ⚖️ A PUCK'S BADGE BELONGS TO ITS SCREEN (Peter, 09-21: "the puck power is showing for all
 * screens - should only show on the screen to which it is associated"). A badge appears only
 * on the screen the Puck is paired with, for the room that Puck is showing; every other
 * screen showing that room stays clean. An unpaired Puck shows no badge.
 */
export function devicesForOutputs(devices, outputs, display) {
  return devices.filter(function(d){
    return d.output && outputs.indexOf(d.output)!==-1 && !!display && d.display===display;
  });
}
export function batteryLabel(battery) {
  if(battery && battery.estimated===true && typeof battery.percent==='number' && battery.percent>=0 && battery.percent<=100)return '~'+battery.percent+'%';
  return battery && typeof battery.supplyMv==='number' && battery.supplyMv>4250?'PWR':'?';
}
export function startPuckStatus(targets) {
  var link=document.createElement('link');link.rel='stylesheet';link.href='/assets/puck-status.css';document.head.appendChild(link);
  var devices=[],received=0,busy=false,display='';
  try{display=localStorage.getItem('flightdeck.display')||'';}catch(e){display='';}
  function paint(){
    var live=Date.now()-received<5000?devices:[];
    targets().forEach(function(t){
      var host=t.host.querySelector('.puck-batteries');
      if(!host){host=document.createElement('span');host.className='puck-batteries';t.host.appendChild(host);}
      var matching=devicesForOutputs(live,t.outputs,display),key=JSON.stringify(matching);
      host.hidden=matching.length===0;if(host.getAttribute('data-reading')===key)return;host.setAttribute('data-reading',key);host.textContent='';
      matching.forEach(function(d){
        var b=d.battery,label=batteryLabel(b),badge=document.createElement('span');badge.className='puck-battery';
        var message=(d.name||'Puck')+' · '+(label.charAt(0)==='~'?'battery approximately '+b.percent+'%':label==='PWR'?'power supply detected; battery level unavailable':'battery level unavailable');
        if(b&&typeof b.supplyMv==='number')message+=' · supply '+(b.supplyMv/1000).toFixed(2)+' V';
        badge.title=message;badge.setAttribute('aria-label',message);badge.setAttribute('role','img');badge.setAttribute('data-device',d.id);
        badge.setAttribute('data-low',b&&typeof b.percent==='number'&&b.percent<=20?'1':'0');
        var icon=document.createElement('span');icon.className='puck-battery-icon';icon.setAttribute('aria-hidden','true');
        var fill=document.createElement('span');fill.style.width=b&&typeof b.percent==='number'?b.percent+'%':'0%';icon.appendChild(fill);badge.appendChild(icon);
        var text=document.createElement('span');text.textContent=label;badge.appendChild(text);host.appendChild(badge);
      });
    });
  }
  function poll(){
    if(busy)return;busy=true;var xhr=new XMLHttpRequest();xhr.open('GET','/api/v1/controllers');xhr.timeout=1500;
    xhr.onload=function(){if(xhr.status!==200)return;try{var data=JSON.parse(xhr.responseText);if(Array.isArray(data.devices)){devices=data.devices;received=Date.now();paint();}}catch(e){}};
    xhr.onloadend=function(){busy=false;};xhr.send();
  }
  setInterval(paint,1000);setInterval(poll,2000);poll();
}
