const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto');
const {EngineUpdater}=require('../dist/main/engine-updater');
const {compareVersions,selectedExecutable,parseSelection,writeAtomic}=require('../dist/main/engine-selection');
const {archiveTarget,extractEngine,smokeEngine}=require('../dist/main/engine-download');
const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'hero-engine-test-'));
function selection(root,version='45.0.0') {
 const directory='electron-'+version+'-win32-'+process.arch+'-'+crypto.randomUUID();
 fs.mkdirSync(path.join(root,directory),{recursive:true});
 const executable=path.join(root,directory,'electron.exe');fs.writeFileSync(executable,'synthetic executable');
 return {version,chromium:'145.0.1.0',platform:process.platform,arch:process.arch,directory,executableSha256:crypto.createHash('sha256').update('synthetic executable').digest('hex'),verifiedAt:Date.now()};
}
const options=(root,extra={})=>({directory:root,currentElectron:'44.2.0',currentChromium:'144.0.0.0',supported:true,latest:async()=> '45.0.0',prepare:async version=>selection(root,version),...extra});
test('versions compare numerically, prerelease and unsafe selectors are rejected',()=>{
 assert.equal(compareVersions('44.10.0','44.9.1'),1);
 const root=temporary(),valid=selection(root);
 assert.ok(parseSelection(valid));
 for(const directory of ['../Hero Browser Profiles','C:\\Windows','electron-45.0.0-win32-x64-..'])assert.equal(parseSelection({...valid,directory}),null);
 assert.equal(parseSelection({...valid,version:'45.0.0-beta.1'}),null);
});
test('updater stages once and publishes ready without touching profile sentinel',async()=>{
 const root=temporary(),profiles=path.join(root,'profiles');fs.mkdirSync(profiles);fs.writeFileSync(path.join(profiles,'login'),'KEEP');
 let downloads=0;
 const updater=new EngineUpdater(options(root,{prepare:async version=>{downloads++;return selection(root,version);}}));
 assert.equal((await updater.check()).status,'ready');
 assert.equal(fs.readFileSync(path.join(profiles,'login'),'utf8'),'KEEP');
 assert.ok(selectedExecutable(root,'44.2.0'));
 await updater.check();assert.equal(downloads,1);
 assert.equal(new EngineUpdater(options(root)).snapshot().readyElectron,'45.0.0');
});
test('failed checksum or smoke verification leaves selected engine unchanged',async()=>{
 const root=temporary(),old=selection(root,'44.3.0');
 writeAtomic(path.join(root,'active.json'),old);
 const before=fs.readFileSync(path.join(root,'active.json'),'utf8');
 const updater=new EngineUpdater(options(root,{prepare:async()=>{throw new Error('CHECKSUM FAILED');}}));
 assert.equal((await updater.check()).status,'error');
 assert.equal(fs.readFileSync(path.join(root,'active.json'),'utf8'),before);
});
test('updater never downloads older stable releases or enables packaged updates',async()=>{
 let calls=0;
 const updater=new EngineUpdater(options(temporary(),{latest:async()=> '43.0.0',prepare:async()=>{calls++;throw Error();}}));
 assert.equal((await updater.check()).status,'up_to_date');assert.equal(calls,0);
 const unsupported=new EngineUpdater(options(temporary(),{supported:false,latest:async()=>{calls++;return '45.0.0';}}));
 assert.equal((await unsupported.check()).status,'unsupported');assert.equal(calls,0);
});
test('concurrent checks share one request and disabling aborts staging without activation',async()=>{
 const root=temporary();let count=0,begin;
 const begun=new Promise(r=>begin=r);
 const updater=new EngineUpdater(options(root,{prepare:async(_version,signal)=>{count++;begin();return new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(new Error('cancelled')),{once:true}));}}));
 const first=updater.check(),second=updater.check();await begun;
 updater.setEnabled(false);await Promise.all([first,second]);
 assert.equal(count,1);assert.equal(fs.existsSync(path.join(root,'active.json')),false);
 assert.equal(new EngineUpdater(options(root)).snapshot().enabled,false);
});
test('launcher refuses tampered executable or a downgrade',()=>{
 const root=temporary(),data=selection(root);writeAtomic(path.join(root,'active.json'),data);
 assert.ok(selectedExecutable(root,'44.2.0'));assert.equal(selectedExecutable(root,'46.0.0'),null);
 fs.appendFileSync(path.join(root,data.directory,'electron.exe'),'tamper');
 assert.equal(selectedExecutable(root,'44.2.0'),null);
});
test('ZIP extraction rejects symlinks, absolute paths, ADS and traversal',()=>{
 const root=temporary();
 for(const name of ['../cookies','/absolute','C:/users','sub\\file','sub/file:stream','sub/../out','con.txt','sub/name.'])
  assert.throws(()=>archiveTarget(root,name,0),undefined,name);
 assert.throws(()=>archiveTarget(root,'link',(0xa1ff<<16)>>>0));
 assert.equal(archiveTarget(root,'locales/en-US.pak',0),path.join(root,'locales/en-US.pak'));
});
test('smoke check uses installed runtime and a new profile, without main app login data',async()=>{
 const root=temporary(),electron=require('electron'),version=require('electron/package.json').version;
 const result=await smokeEngine(electron,path.resolve('scripts/engine-smoke.cjs'),path.join(root,'smoke-profile'),version,new AbortController().signal);
 assert.equal(result.electron,version);assert.match(result.chromium,/^\d+\./);
});

test('packaged runtime remains unsupported even if a staged source runtime exists', async () => {
 const root=temporary();writeAtomic(path.join(root,'active.json'),selection(root));
 const updater=new EngineUpdater(options(root,{supported:false}));
 assert.equal(updater.snapshot().status,'unsupported');
 assert.equal((await updater.check()).status,'unsupported');
});

test('automatic updater waits after startup, respects six-hour interval and disabled preference', async t => {
 t.mock.timers.enable({apis:['setTimeout','setInterval','Date'],now:Date.UTC(2026,8,29)});
 let checks=0;
 const root=temporary();
 const updater=new EngineUpdater(options(root,{latest:async()=>{checks++;return '44.2.0';}}));
 try {
  updater.start();
  t.mock.timers.tick(9999);assert.equal(checks,0);
  t.mock.timers.tick(1);await updater.check();assert.equal(checks,1);
  t.mock.timers.tick(5*60*60*1000);assert.equal(checks,1);
  t.mock.timers.tick(90*60*1000);await updater.check();assert.equal(checks,2);
  updater.setEnabled(false);
  t.mock.timers.tick(7*60*60*1000);assert.equal(checks,2);
 } finally {updater.stop();t.mock.timers.reset();}
});
