import { existsSync, readFileSync, realpathSync, renameSync, writeFileSync, mkdirSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import type { EngineSelection } from '../shared/engine-update';
export const stableVersion=(value:unknown):value is string=>typeof value==='string'&&/^[1-9]\d*\.\d+\.\d+$/.test(value);
export function compareVersions(a:string,b:string):number {
 const x=a.split('.').map(Number),y=b.split('.').map(Number);
 for(let i=0;i<3;i++){if(x[i]!==y[i])return x[i]!>y[i]!?1:-1;}return 0;
}
export function engineDirectory():string {
 return process.env.HERO_ENGINE_HOME||path.join(process.env.LOCALAPPDATA||path.join(os.homedir(),'AppData','Local'),'Hero Browser Engines');
}
export function writeAtomic(file:string,value:unknown):void {
 mkdirSync(path.dirname(file),{recursive:true});
 const temporary=file+'.'+randomUUID()+'.tmp';
 writeFileSync(temporary,JSON.stringify(value,null,2),{encoding:'utf8',flag:'wx',flush:true});
 renameSync(temporary,file);
}
export function parseSelection(value:unknown,platform=process.platform,arch=process.arch):EngineSelection|null {
 if(!value||typeof value!=='object')return null;
 const v=value as Partial<EngineSelection>;
 if(!stableVersion(v.version)||v.platform!==platform||v.arch!==arch||
    typeof v.chromium!=='string'||!/^\d+\.\d+\.\d+\.\d+$/.test(v.chromium)||
    typeof v.directory!=='string'||!/^electron-\d+\.\d+\.\d+-win32-(x64|arm64)-[a-f0-9-]{36}$/.test(v.directory)||
    !v.directory.startsWith('electron-'+v.version+'-'+platform+'-'+arch+'-')||
    typeof v.executableSha256!=='string'||!/^[a-f0-9]{64}$/.test(v.executableSha256)||
    typeof v.verifiedAt!=='number'||!Number.isFinite(v.verifiedAt))return null;
 return v as EngineSelection;
}
export function readSelection(directory:string):EngineSelection|null {
 try{return parseSelection(JSON.parse(readFileSync(path.join(directory,'active.json'),'utf8')));}catch{return null;}
}
export function selectedExecutable(directory:string,baselineVersion:string):string|null {
 const selected=readSelection(directory);
 if(!selected||compareVersions(selected.version,baselineVersion)<0)return null;
 const executable=path.join(directory,selected.directory,'electron.exe');
 if(!existsSync(executable))return null;
 // Resolve paths before use: a modified pointer or junction may not escape the engine cache.
 const root=realpathSync(directory),resolved=realpathSync(executable);
 const relative=path.relative(root,resolved);
 if(relative.startsWith('..')||path.isAbsolute(relative))return null;
 const actual=createHash('sha256').update(readFileSync(resolved)).digest('hex');
 return actual===selected.executableSha256?resolved:null;
}
