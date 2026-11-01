import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { openPromise } from 'yauzl';
import type { EngineSelection } from '../shared/engine-update';
import { stableVersion } from './engine-selection';

// Inside Electron, node:fs treats *.asar files as archives, so writing
// resources/default_app.asar through it fails and every update aborted mid-extract.
// original-fs is the unpatched module; plain Node (tests, launcher) has no asar support.
const writeFs: typeof import('node:fs') = process.versions.electron ? require('original-fs') : require('node:fs');

export async function latestStable(signal:AbortSignal):Promise<string>{
 const response=await fetch('https://api.github.com/repos/electron/electron/releases/latest',{
  signal:AbortSignal.any([signal,AbortSignal.timeout(20000)]),
  headers:{Accept:'application/vnd.github+json','User-Agent':'Hero-Browser-Engine-Updater'},
 });
 if(!response.ok)throw new Error(response.status===403||response.status===429?'GitHub membatasi permintaan (rate limit); coba lagi nanti':'Feed rilis tidak tersedia (HTTP '+response.status+')');
 const raw=await response.text();if(raw.length>1000000)throw new Error('Release feed too large');
 const data:unknown=JSON.parse(raw);
 if(!data||typeof data!=='object'||!('tag_name'in data)||typeof data.tag_name!=='string'||
   ('prerelease'in data&&data.prerelease)||('draft'in data&&data.draft))throw new Error('Invalid release feed');
 const version=data.tag_name.replace(/^v/,'');if(!stableVersion(version))throw new Error('Not a stable release');return version;
}

export function archiveTarget(root:string,name:string,attributes:number):string {
 if(!name||name.includes('\\')||name.includes('\0')||name.includes(':')||name.startsWith('/')||
   name.split('/').some(part=>part==='..'||part==='.'||/[. ]$/.test(part)||/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i.test(part)))throw new Error('Unsafe archive path');
 const type=(attributes>>>16)&0xf000;
 if(type!==0&&type!==0x8000&&type!==0x4000)throw new Error('Links and special entries are forbidden');
 const target=path.resolve(root,name),relative=path.relative(path.resolve(root),target);
 if(!relative||relative.startsWith('..')||path.isAbsolute(relative))throw new Error('Archive path escapes staging');
 return target;
}
export async function extractEngine(zipPath:string,destination:string,signal:AbortSignal):Promise<void>{
 // Destination is newly created for this attempt, with no existing symlinks/files.
 mkdirSync(destination);
 const zip=await openPromise(zipPath,{strictFileNames:true,validateEntrySizes:true});
 let total=0,count=0;
 try{
  for await(const entry of zip.eachEntry()){
   signal.throwIfAborted();total+=entry.uncompressedSize;
   if(++count>20000||total>1500000000)throw new Error('Archive size limit');
   const target=archiveTarget(destination,entry.fileName,entry.externalFileAttributes);
   if(entry.fileName.endsWith('/')){mkdirSync(target,{recursive:true});continue;}
   mkdirSync(path.dirname(target),{recursive:true});
   const source=await zip.openReadStreamPromise(entry);
   await pipeline(source,writeFs.createWriteStream(target,{flags:'wx'}),{signal});
  }
 }finally{zip.close();}
}
export function smokeEngine(executable:string,smokeScript:string,profileDirectory:string,expected:string,signal:AbortSignal):Promise<{electron:string;chromium:string}>{
 return new Promise((resolve,reject)=>{
  const env:NodeJS.ProcessEnv={...process.env,HERO_ENGINE_UPDATES:'0'};delete env.ELECTRON_RUN_AS_NODE;
  const child=spawn(executable,[smokeScript,'--user-data-dir='+profileDirectory],{env,windowsHide:true,stdio:['ignore','pipe','ignore']});
  let stdout='',settled=false;
  const end=(error?:Error,result?:{electron:string;chromium:string})=>{
   if(settled)return;settled=true;clearTimeout(timer);signal.removeEventListener('abort',abort);
   if(error){child.kill();reject(error);}else resolve(result!);
  };
  const abort=()=>end(new Error('Smoke cancelled'));
  const timer=setTimeout(()=>end(new Error('Smoke timeout')),30000);
  child.stdout.on('data',chunk=>{stdout+=String(chunk);if(stdout.length>100000)end(new Error('Smoke output limit'));});
  child.on('error',error=>end(error));child.on('close',code=>{
   try{
    const marker=stdout.split(/\r?\n/).find(line=>line.startsWith('HERO_ENGINE_OK '));
    if(code!==0||!marker)throw new Error('Smoke failed');
    const result=JSON.parse(marker.slice(15));
    if(result.electron!==expected||! /^\d+\.\d+\.\d+\.\d+$/.test(result.chromium))throw new Error('Unexpected engine');
    end(undefined,result);
   }catch{end(new Error('Engine failed compatibility test'));}
  });
  signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
 });
}
export async function prepareEngine(version:string,directory:string,smokeScript:string,signal:AbortSignal,
 progress:(status:'downloading'|'verifying',percent:number|null)=>void):Promise<EngineSelection>{
 if(process.platform!=='win32'||!['x64','arm64'].includes(process.arch)||!stableVersion(version))throw new Error('Unsupported engine target');
 mkdirSync(directory,{recursive:true});
 mkdirSync(path.join(directory,'downloads-temp'),{recursive:true});
 pruneStaging(directory);
 const {downloadArtifact}=await import('@electron/get');
 const zip=await downloadArtifact({
  version,artifactName:'electron',platform:'win32',arch:process.arch,
  cacheRoot:path.join(directory,'downloads'),tempDirectory:path.join(directory,'downloads-temp'),
  unsafelyDisableChecksums:false,
  mirrorOptions:{resolveAssetURL:async details=>{
   // Ignore mirror/custom filename environment overrides; reject version overrides.
   if(String(details.version).replace(/^v/,'')!==version)throw new Error('Unexpected artifact version');
   const filename=details.artifactName==='SHASUMS256.txt'?'SHASUMS256.txt':'electron-v'+version+'-win32-'+process.arch+'.zip';
   return 'https://github.com/electron/electron/releases/download/v'+version+'/'+filename;
  }},
  downloadOptions:{signal,quiet:true,getProgressCallback:async(p:{percent:number})=>progress('downloading',Math.round(p.percent*100))},
 });
 signal.throwIfAborted();progress('verifying',null);
 if(statSync(zip).size>600000000)throw new Error('Download too large');
 const name='electron-'+version+'-win32-'+process.arch+'-'+randomUUID();
 const staging=path.join(directory,name);
 try{
  await extractEngine(zip,staging,signal);
  const executable=path.join(staging,'electron.exe');
  const result=await smokeEngine(executable,smokeScript,path.join(staging,'smoke-profile'),version,signal);
  signal.throwIfAborted();
  const digest=createHash('sha256');
  for await(const chunk of createReadStream(executable))digest.update(chunk as Buffer);
  return {version,chromium:result.chromium,platform:process.platform,arch:process.arch,directory:name,executableSha256:digest.digest('hex'),verifiedAt:Date.now()};
 }catch(error){
  // A half-extracted engine is ~360 MB and can never be selected; do not keep it.
  try{writeFs.rmSync(staging,{recursive:true,force:true});}catch{/* Locked by antivirus; pruned next time. */}
  throw error;
 }
}

/** Removes staging folders from earlier attempts, keeping only the engine selected in active.json. */
export function pruneStaging(directory:string):void{
 let keep='';
 try{keep=JSON.parse(readFileSafe(path.join(directory,'active.json'))).directory||'';}catch{/* No active engine yet. */}
 for(const entry of readdirSync(directory,{withFileTypes:true})){
  if(!entry.isDirectory()||entry.name===keep||!/^electron-\d+\.\d+\.\d+-win32-(x64|arm64)-[0-9a-f-]{36}$/.test(entry.name))continue;
  try{writeFs.rmSync(path.join(directory,entry.name),{recursive:true,force:true});}catch{/* In use; retry on the next attempt. */}
 }
}
function readFileSafe(file:string):string{return writeFs.readFileSync(file,'utf8');}
