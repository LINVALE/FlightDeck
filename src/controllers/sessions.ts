import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';

export interface ControllerItem { key: string; title: string; subtitle: string; index: number }
export interface ControllerView {
  output: string; room: string; context: string; title: string; open: boolean;
  face: number; total: number; selected: number; items: ControllerItem[]; busy: boolean; volume: Record<string, unknown> | null;
}
interface Input { seq: number; type: string; value: number; key: string; context: string; output: string; at: number }
interface Battery { supplyMv: number | null; percent: number | null; estimated: boolean; sampledAt: number }
interface Device { id: string; name: string; boot: string; retired: string[]; lastSeq: number; seen: number; output: string; displayedOutput: string; battery: Battery | null; inputs: Input[] }
interface Screen { id: string; name: string; tab: string; seen: number; revision: number; state: ControllerView | null; fingerprint: string }
const TYPES = new Set(['move','pick','commit','back','rooms','browse','queue','playing','volume','seek','preview','mute','playpause','play','pause','next','previous','shuffle','repeat','options','search']);
const str = (v: unknown, max: number): string => typeof v === 'string' ? v.slice(0,max) : '';
const integer = (v: unknown, min: number, max: number): number => typeof v === 'number' && Number.isInteger(v) ? Math.max(min,Math.min(max,v)) : min;
export class ControllerError extends Error { readonly status: number; constructor(status: number, message: string) { super(message); this.status=status; } }
function id(v: unknown): string { const s=str(v,80); if(!/^[A-Za-z0-9:_-]{1,64}$/.test(s))throw new ControllerError(400,'Invalid controller/display identity');return s; }
function view(raw: unknown): ControllerView {
  if(!raw || typeof raw!=='object')throw new ControllerError(400,'Missing display state');
  const v=raw as Record<string,unknown>;const total=integer(v.total,0,10000);
  const items=(Array.isArray(v.items)?v.items:[]).slice(0,11).map((entry):ControllerItem=>{
    const x=(entry&&typeof entry==='object'?entry:{}) as Record<string,unknown>;
    return {key:str(x.key,120),title:str(x.title,120),subtitle:str(x.subtitle,120),index:integer(x.index,0,9999)};
  }).filter(i=>i.index<total && i.key!=='');
  return {output:str(v.output,48),room:str(v.room,80),context:str(v.context,120),title:str(v.title,80),open:v.open===true,
    face:integer(v.face,0,2),total,selected:integer(v.selected,0,Math.max(0,total-1)),items,busy:v.busy===true,volume: v.volume && typeof v.volume==='object' ? Object.fromEntries(Object.entries(v.volume).filter(([k,x])=>['value','min','max','step','softLimit','hardLimitMin','hardLimitMax','muted'].includes(k) && (typeof x==='number' && Number.isFinite(x) || typeof x==='boolean'))) : null};
}

/** A missing/invalid reading must never become a full battery. */
function battery(raw:unknown,now:number):Battery|null {
  if(!raw||typeof raw!=='object')return null;
  const b=raw as Record<string,unknown>;
  if(typeof b.ageMs!=='number'||!Number.isInteger(b.ageMs)||b.ageMs<0||b.ageMs>15000)return null;
  const supply=typeof b.supplyMv==='number'&&Number.isInteger(b.supplyMv)&&b.supplyMv>=2500&&b.supplyMv<=5500?b.supplyMv:null;
  const percent=supply!==null&&supply>=3000&&supply<=4250&&b.estimated===true&&typeof b.percent==='number'&&Number.isInteger(b.percent)&&b.percent>=0&&b.percent<=100?b.percent:null;
  return {supplyMv:supply,percent,estimated:percent!==null,sampledAt:now-b.ageMs};
}

/** The browser owns UI/actions. This bounded mailbox transports input once; it never executes Roon commands. */
export class ControllerSessions {
  private devices=new Map<string,Device>();
  private screens=new Map<string,Screen>();
  private pairs=new Map<string,string>(); // device -> browser identity
  private path:string|null;
  constructor(dataDir:string|null) {
    this.path=dataDir===null?null:join(dataDir,'controller-pairs.json');
    if(this.path)try {const rows=JSON.parse(readFileSync(this.path,'utf8'));if(Array.isArray(rows))for(const row of rows.slice(0,32)){
      if(Array.isArray(row)&&row.length===2){const device=id(row[0]),screen=id(row[1]);if(![...this.pairs.values()].includes(screen))this.pairs.set(device,screen);}
    }}catch{/* first run */}
  }
  private save():void { if(this.path){const tmp=this.path+'.tmp';writeFileSync(tmp,JSON.stringify([...this.pairs]));renameSync(tmp,this.path);} }
  list(now=Date.now()):unknown {return {devices:[...this.devices.values()].filter(d=>now-d.seen<10000).map(d=>({id:d.id,name:d.name,display:this.pairs.get(d.id)||'',screen:this.screens.get(this.pairs.get(d.id)||'')?.name||'',output:now-d.seen<5000?d.displayedOutput:'',battery:d.battery&&now-d.battery.sampledAt<=15000?{supplyMv:d.battery.supplyMv,percent:d.battery.percent,estimated:d.battery.estimated}:null}))};}
  request(body:Record<string,unknown>,now=Date.now()):unknown {
    if(body.op==='device')return this.device(body,now);
    if(body.op==='screen')return this.screen(body,now);
    if(body.op==='pair'||body.op==='unpair'){
      const display=id(body.display),screen=this.screens.get(display);
      if(!screen||screen.tab!==body.tab||now-screen.seen>2500)throw new ControllerError(409,'Activate this screen first');
      if(body.op==='unpair'){for(const [d,s] of this.pairs)if(s===display){this.pairs.delete(d);const device=this.devices.get(d);if(device)device.inputs=[];}this.save();return {ok:true};}
      const device=id(body.device),found=this.devices.get(device);if(!found||now-found.seen>10000)throw new ControllerError(409,'Puck is offline');
      const previous=this.pairs.get(device);if(previous&&previous!==display&&body.replace!==true)throw new ControllerError(409,'Puck is already linked to another screen');
      for(const [d,s] of this.pairs)if(s===display){this.pairs.delete(d);const old=this.devices.get(d);if(old)old.inputs=[];}
      this.pairs.set(device,display);found.inputs=[];
      if(screen.state&&!screen.state.output)screen.state={...screen.state,output:found.output};
      this.save();return {ok:true,device,output:screen.state?.output||found.output};
    }
    throw new ControllerError(400,'Unknown controller operation');
  }
  private device(b:Record<string,unknown>,now:number):unknown {
    const key=id(b.id),boot=id(b.boot);let d=this.devices.get(key);
    if(!d){if(this.devices.size>=32)throw new ControllerError(429,'Controller limit');d={id:key,name:str(b.name,64)||key,boot,retired:[],lastSeq:0,seen:now,output:str(b.output,48),displayedOutput:'',battery:null,inputs:[]};this.devices.set(key,d);}
    if(d.boot!==boot){if(d.retired.includes(boot))throw new ControllerError(409,'Retired puck connection');d.retired.push(d.boot);d.retired=d.retired.slice(-8);d.boot=boot;d.lastSeq=0;d.inputs=[];}
    d.displayedOutput=str(b.displayedOutput,48);d.battery=battery(b.battery,now);
    d.seen=now;d.name=str(b.name,64)||d.name;if(!this.pairs.has(key))d.output=str(b.output,48);
    const screen=this.screens.get(this.pairs.get(key)||'');const online=!!screen&&now-screen.seen<2500&&screen.state!==null;
    for(const raw of (Array.isArray(b.inputs)?b.inputs:[]).slice(0,16)){
      if(!raw||typeof raw!=='object')continue;const x=raw as Record<string,unknown>;const seq=integer(x.seq,0,2147483647);
      if(seq<=d.lastSeq)continue;d.lastSeq=seq;
      if(!online||!screen?.state||!TYPES.has(String(x.type))||typeof x.age!=='number'||x.age<0||x.age>1500)continue;
      const context=str(x.context,120),output=str(x.output,48);
      if(context!==screen.state.context||output!==screen.state.output)continue;
      if(d.inputs.length>=16)continue;
      d.inputs.push({seq,type:String(x.type),value:integer(x.value,-10000,10000),key:str(x.key,120),context,output,at:now});
    }
    return {paired:this.pairs.has(key),online,screen:screen?.name||'Linked screen',revision:screen?.revision||0,state:online?screen?.state:null};
  }
  private screen(b:Record<string,unknown>,now:number):unknown {
    const key=id(b.display),tab=id(b.tab);let s=this.screens.get(key);
    if(!s){if(this.screens.size>=64)throw new ControllerError(429,'Display limit');s={id:key,name:str(b.name,64)||key,tab,seen:now,revision:0,state:null,fingerprint:''};this.screens.set(key,s);}
    const deviceId=[...this.pairs].find(([,screen])=>screen===key)?.[0]||'';
    const d=this.devices.get(deviceId);
    if(s.tab!==tab&&b.claim!==true&&now-s.seen<2500)return {active:false,paired:!!deviceId,device:deviceId};
    if(s.tab!==tab){if(d)d.inputs=[];s.tab=tab;}
    s.seen=now;s.name=str(b.name,64)||s.name;
    const next=view(b.state);if(!next.output&&s.state?.output)next.output=s.state.output;
    const fingerprint=JSON.stringify(next);if(fingerprint!==s.fingerprint){s.revision++;s.fingerprint=fingerprint;s.state=next;}
    // Consume before delivery: a lost response cannot replay a transport or browse activation.
    const inputs=d?d.inputs.splice(0).filter(x=>now-x.at<=1500&&x.context===next.context&&x.output===next.output):[];
    return {active:true,paired:!!deviceId,device:deviceId,name:d?.name||'',online:!!d&&now-d.seen<2500,revision:s.revision,output:next.output,inputs};
  }
}
