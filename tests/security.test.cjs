const test = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readFileSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { ProfileManager } = require('../dist/main/profile-manager');
const { TaskManager } = require('../dist/main/task-manager');
const { McpBridge } = require('../dist/main/mcp-bridge');
const { AuditLogger } = require('../dist/main/audit-logger');
const { requestRpc, createHeroMcpServer } = require('../dist/mcp');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');

function setup() {
 const dir = mkdtempSync(path.join(os.tmpdir(), 'hero-security-test-'));
 const profiles = new ProfileManager(dir);
 const tasks = new TaskManager(profiles);
 return { dir, profiles, tasks };
}
test('audit never records typed content, selector literals or error details', () => {
 const { dir } = setup();
 const logger = new AuditLogger(dir);
 logger.log({ source:'mcp', action:'automation.type', params:{selector:'#field-1',text:'DEMO_SECRET',url:'https://example.test/#access_token=FRAGMENT_SECRET'}, error:'INTERNAL_SECRET', status:'FAILED' });
 logger.log({ source:'mcp', action:'automation.click', params:{ selector:'input[value="SELECTOR_SECRET"]', url:'https://example.test/?session=SESSION_SECRET' }, status:'SUCCESS' });
 const log=readFileSync(path.join(dir,'audit.log'),'utf8');
 for(const secret of ['DEMO_SECRET','FRAGMENT_SECRET','INTERNAL_SECRET','SELECTOR_SECRET','SESSION_SECRET']) assert.ok(!log.includes(secret));
});
test('tasks keep shared sessions locked while paused; terminal states cannot be rewritten', () => {
 const { profiles,tasks }=setup();
 profiles.shareSession('default',['youtube']);
 tasks.createTask('default','owner');
 tasks.pauseTask('owner');
 assert.throws(()=>tasks.assertRunnable('owner'),{code:'TASK_NOT_RUNNING'});
 assert.throws(()=>tasks.createTask('youtube','intruder'),{code:'PROFILE_BUSY'});
 tasks.resumeTask('owner');
 assert.equal(tasks.assertRunnable('owner').status,'RUNNING');
 tasks.cancelTask('owner');
 assert.throws(()=>tasks.completeTask('owner'),{code:'INVALID_TASK_STATE'});
 tasks.createTask('youtube','next');
 tasks.dispose();
});
test('human intervention returns a token immediately and queues multiple profiles', () => {
 const {tasks}=setup(); let shown;
 tasks.setInterventionListener(req=>shown=req);
 tasks.createTask('default','first'); tasks.createTask('research','second');
 const first=tasks.requestHumanIntervention('first',{reason:'First',message:'Fixture'});
 tasks.requestHumanIntervention('second',{reason:'Second',message:'Fixture'});
 assert.equal(shown.taskId,'first');
 assert.throws(()=>tasks.resumeTask('first','wrong'),{code:'INVALID_RESUME_TOKEN'});
 tasks.resumeTask('first',first.resumeToken);
 assert.equal(shown.taskId,'second');
 tasks.cancelTask('second');
 assert.equal(shown,null);
 tasks.dispose();
});
test('bridge rejects ownerless, paused, wrong-profile, overlapping and malformed operations', async () => {
 const {dir,profiles,tasks}=setup();
 let actions=0;
 const browser={
  snapshot:()=>({tabs:[],activeProfileId:profiles.activeProfileId}),
  type:async()=>{actions++;}, switchProfile:id=>profiles.switchProfile(id),
  waitFor:async(_p,signal)=>{await delay(5000,undefined,{signal});return true;},
 };
 const bridge=new McpBridge({userDataDir:dir,browser,profiles,tasks});
 const info=await bridge.start();
 const rpc=(method,params={})=>requestRpc(info.port,info.token,method,params);
 try{
  await assert.rejects(rpc('automation.type',{selector:'#field',text:'x'}),{code:'INVALID_INPUT'});
  await rpc('tasks.create',{taskId:'owner',profileId:'default'});
  await rpc('tasks.pause',{taskId:'owner'});
  await assert.rejects(rpc('automation.type',{taskId:'owner',selector:'#field',text:'x'}),{code:'TASK_NOT_RUNNING'});
  await rpc('tasks.resumeIntervention',{taskId:'owner'});
  profiles.switchProfile('research');
  await assert.rejects(rpc('automation.type',{taskId:'owner',selector:'#field',text:'x'}),{code:'TASK_PROFILE_MISMATCH'});
  await rpc('profiles.switch',{taskId:'owner',profileId:'default'});
  await rpc('automation.type',{taskId:'owner',selector:'#field',text:'x'});
  assert.equal(actions,1);
  await assert.rejects(rpc('automation.type',{taskId:'owner',selector:'#field',text:'x',extra:'invalid'}),{code:'INVALID_INPUT'});
  const waiting=rpc('automation.waitFor',{taskId:'owner',ms:5000}).catch(e=>e);
  await delay(50);
  await assert.rejects(rpc('automation.type',{taskId:'owner',selector:'#field',text:'x'}),{code:'BROWSER_BUSY'});
  await rpc('tasks.cancel',{taskId:'owner'});
  assert.ok(await waiting instanceof Error);
  assert.equal(tasks.getTask('owner').status,'CANCELLED');
  assert.equal(actions,1);
 }finally{tasks.dispose();bridge.stop();}
});
test('RPC deadline and AbortSignal close pending connections', async () => {
 const srv=http.createServer(()=>{});
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 try {
  await assert.rejects(requestRpc(srv.address().port,'dummy','wait',{}, {timeoutMs:50}),{code:'TIMEOUT'});
  const controller=new AbortController();
  const pending=requestRpc(srv.address().port,'dummy','wait',{}, {signal:controller.signal});
  controller.abort();
  await assert.rejects(pending,{code:'CANCELLED'});
 } finally {srv.closeAllConnections();await new Promise(r=>srv.close(r));}
});
test('real MCP client sees strict schemas and dispatched side effects are never retried', async () => {
 const fs=require('node:fs');
 const dir=mkdtempSync(path.join(os.tmpdir(),'hero-mcp-client-'));
 let calls=0;
 const srv=http.createServer((req,res)=>{
  let raw='';req.on('data',c=>raw+=c);req.on('end',()=>{
   const {method}=JSON.parse(raw);res.setHeader('Content-Type','application/json');
   if(method==='ping'){res.end(JSON.stringify({ok:true,result:{ok:true}}));return;}
   calls++; // Simulate an action that happened before an error response.
   res.end(JSON.stringify({ok:false,code:'ACTION_UNCERTAIN',error:'Simulated response failure'}));
  });
 });
 await new Promise(r=>srv.listen(0,'127.0.0.1',r));
 fs.writeFileSync(path.join(dir,'mcp-bridge.json'),JSON.stringify({port:srv.address().port,token:'a'.repeat(48),pid:process.pid,createdAt:Date.now()}));
 const previous=process.env.HERO_USER_DATA_DIR;process.env.HERO_USER_DATA_DIR=dir;
 const server=createHeroMcpServer();const client=new Client({name:'audit-test',version:'1.0'});
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair();
 try{
  await Promise.all([server.connect(serverTransport),client.connect(clientTransport)]);
  const {tools}=await client.listTools();
  for(const name of ['browser_start_task','browser_pause_task','browser_resume_task','browser_complete_task','browser_cancel_task'])
   assert.ok(tools.some(t=>t.name===name));
  assert.ok(tools.every(t=>t.outputSchema&&t.inputSchema.additionalProperties===false));
  const result=await client.callTool({name:'browser_type',arguments:{taskId:'fixture',selector:'#field',text:'x'}});
  assert.equal(result.isError,true);assert.equal(calls,1);
  const malformed=await client.callTool({name:'browser_type',arguments:{taskId:'fixture',selector:'#field',text:'x',extra:'no'}});
  assert.equal(malformed.isError,true);assert.equal(calls,1);
 }finally{
  await client.close();await server.close();srv.closeAllConnections();await new Promise(r=>srv.close(r));
  if(previous===undefined)delete process.env.HERO_USER_DATA_DIR;else process.env.HERO_USER_DATA_DIR=previous;
 }
});
