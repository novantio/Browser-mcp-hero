import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { EngineSelection, EngineUpdateState } from '../shared/engine-update';
import { compareVersions, readSelection, selectedExecutable, parseSelection, stableVersion, writeAtomic } from './engine-selection';

export interface EngineUpdateOptions {
 directory:string;currentElectron:string;currentChromium:string;supported:boolean;disabledByEnvironment?:boolean;
 latest:(signal:AbortSignal)=>Promise<string>;
 prepare:(version:string,signal:AbortSignal,progress:(status:'downloading'|'verifying',percent:number|null)=>void)=>Promise<EngineSelection>;
 publish?:(state:EngineUpdateState)=>void;
}
export class EngineUpdater {
 private state:EngineUpdateState;
 private pending:Promise<EngineUpdateState>|null=null;
 private timer:ReturnType<typeof setInterval>|null=null;
 private initial:ReturnType<typeof setTimeout>|null=null;
 private controller:AbortController|null=null;
 constructor(private readonly options:EngineUpdateOptions){
  let enabled=true,lastCheckedAt:number|null=null;
  try{
   const prefs:unknown=JSON.parse(readFileSync(path.join(options.directory,'preferences.json'),'utf8'));
   if(prefs&&typeof prefs==='object'&&'enabled'in prefs&&typeof prefs.enabled==='boolean')enabled=prefs.enabled;
   if(prefs&&typeof prefs==='object'&&'lastCheckedAt'in prefs&&typeof prefs.lastCheckedAt==='number'&&Number.isFinite(prefs.lastCheckedAt))lastCheckedAt=prefs.lastCheckedAt;
  }catch{/* First run or unavailable preferences: existing engines and profiles remain untouched. */}
  const ready=readSelection(options.directory);
  this.state={status:options.supported?'idle':'unsupported',enabled:enabled&&!options.disabledByEnvironment,currentElectron:options.currentElectron,
   currentChromium:options.currentChromium,latestElectron:null,readyElectron:ready&&compareVersions(ready.version,options.currentElectron)>0?ready.version:null,
   progress:null,lastCheckedAt,message:options.supported?'Pembaruan engine dipakai saat aplikasi dibuka kembali.':'Updater ini tersedia untuk Hero Browser dari proyek pada Windows x64/arm64.'};
  if(options.supported&&this.state.readyElectron){this.state.status='ready';this.state.message='Engine baru siap untuk peluncuran berikutnya.';}
 }
 snapshot():EngineUpdateState{return {...this.state};}
 private set(value:Partial<EngineUpdateState>):void{Object.assign(this.state,value);this.options.publish?.(this.snapshot());}
 private save():void{writeAtomic(path.join(this.options.directory,'preferences.json'),{enabled:this.state.enabled,lastCheckedAt:this.state.lastCheckedAt});}
 setEnabled(enabled:boolean):EngineUpdateState{
  this.set({enabled});this.save();
  if(!enabled)this.controller?.abort();
  else if(this.options.supported&&!this.options.disabledByEnvironment)void this.check();
  return this.snapshot();
 }
 start():void{
  if(!this.options.supported||this.options.disabledByEnvironment)return;
  const due=()=>{if(this.state.enabled&&(!this.state.lastCheckedAt||Date.now()-this.state.lastCheckedAt>=6*60*60*1000))void this.check();};
  this.initial=setTimeout(due,10000);this.initial.unref();
  this.timer=setInterval(due,30*60*1000);this.timer.unref();
 }
 check():Promise<EngineUpdateState>{
  if(this.pending)return this.pending;
  if(!this.options.supported)return Promise.resolve(this.snapshot());
  this.pending=this.perform().finally(()=>{this.pending=null;});
  return this.pending;
 }
 private async perform():Promise<EngineUpdateState>{
  this.controller=new AbortController();const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(15*60*1000)]);
  this.set({status:'checking',progress:null,message:'Memeriksa rilis stabil resmi Electron…'});
  try{
   const latest=await this.options.latest(signal);
   if(!stableVersion(latest))throw new Error('Invalid stable release');
   signal.throwIfAborted();
   this.set({latestElectron:latest,lastCheckedAt:Date.now()});this.save();
   const ready=readSelection(this.options.directory);
   if(ready&&compareVersions(ready.version,this.state.currentElectron)>0&&compareVersions(ready.version,latest)>=0&&selectedExecutable(this.options.directory,this.state.currentElectron)){
    this.set({status:'ready',readyElectron:ready.version,message:'Engine baru siap untuk peluncuran berikutnya.'});return this.snapshot();
   }
   if(compareVersions(latest,this.state.currentElectron)<=0){
    this.set({status:'up_to_date',message:'Engine yang berjalan sudah setara atau lebih baru dari rilis stabil.'});return this.snapshot();
   }
   this.set({status:'downloading',progress:0,message:'Mengunduh engine resmi; sesi yang terbuka tetap berjalan.'});
   const selection=await this.options.prepare(latest,signal,(status,progress)=>{
    if(this.state.status===status&&this.state.progress===progress)return;
    this.set({status,progress,message:status==='verifying'?'Memeriksa checksum dan menguji engine pada profil sementara…':'Mengunduh engine resmi…'});
   });
   signal.throwIfAborted();
   if(!parseSelection(selection)||selection.version!==latest)throw new Error('Version mismatch');
   writeAtomic(path.join(this.options.directory,'active.json'),selection);
   this.set({status:'ready',readyElectron:latest,progress:100,message:'Siap. Engine baru dipakai saat Hero Browser dibuka kembali melalui peluncur.'});
  }catch{
   this.set({status:'error',progress:null,message:this.controller.signal.aborted?'Pembaruan dihentikan. Engine lama dan data login tetap tersedia.':'Pembaruan belum berhasil. Engine lama tetap digunakan; coba periksa lagi.'});
  }finally{this.controller=null;}
  return this.snapshot();
 }
 stop():void{
  if(this.initial)clearTimeout(this.initial);if(this.timer)clearInterval(this.timer);
  this.controller?.abort();
 }
}
