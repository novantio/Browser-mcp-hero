const { _electron: electron } = require('playwright');
const assert = require('node:assert/strict');
const { createServer } = require('node:http');
const { mkdtempSync, readFileSync } = require('node:fs');
const path = require('node:path');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

(async () => {
 const server = createServer((_req,res) => {
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.end('<!doctype html><html><body><h1>Automation fixture</h1>' +
   '<input id="name-input"><button id="submit-btn" onclick="document.querySelector(\'#submitted\').textContent=document.querySelector(\'#name-input\').value">Simpan</button><div id="submitted"></div>' +
   '<ul><li class="item">Alpha</li><li class="item">Beta</li><li class="item">Gamma</li></ul>' +
   '<input type="hidden" name="csrf" value="DEMO_TOKEN"><input id="field-1" type="password" value="DEMO_PASSWORD">' +
   '<textarea id="notes">DEMO_NOTE</textarea><div style="display:none">DEMO_HIDDEN</div>' +
   '<a id="safe-link" href="/callback?token=DEMO_URL#access_token=DEMO_FRAGMENT">Open</a>' +
   '<script>window.fixtureSecret="DEMO_SCRIPT";</script></body></html>');
 });
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const url='http://127.0.0.1:'+server.address().port;
 const userDataDir=mkdtempSync(path.resolve('test-results/automation-'));
 // Uses tools outside the default core preset.
 const env={...process.env,HERO_USER_DATA_DIR:userDataDir,HERO_TOOL_PROFILE:'all'};delete env.ELECTRON_RUN_AS_NODE;
 let app,client;
 try {
  app=await electron.launch({args:['.','--user-data-dir='+userDataDir],env,timeout:30000});
  const win=await app.firstWindow();app.context().setDefaultTimeout(10000);
  await win.getByRole('heading',{name:/Ke mana kita/}).waitFor();
  await win.waitForFunction(()=>document.querySelector('#mcp-status-badge').textContent==='MCP AKTIF');
  client=new Client({name:'electron-regression',version:'1.0'});
  const transport=new StdioClientTransport({command:process.execPath,args:[path.resolve('dist/mcp/index.js')],cwd:process.cwd(),env,stderr:'pipe'});
  transport.stderr.on('data',()=>{});
  await client.connect(transport);
  const raw=(name,args={})=>client.callTool({name,arguments:args});
  const call=async(name,args={})=>{
   const result=await raw(name,args);
   assert.ok(!result.isError, name+': '+JSON.stringify(result.content));
   assert.ok(result.structuredContent, 'Structured output required');
   return result.structuredContent.result;
  };
  const task=await call('browser_start_task',{profileId:'default'});
  const taskId=task.id;
  const action=(name,args={})=>call(name,{taskId,...args});
  await win.waitForFunction(()=>document.querySelector('#profile-control').textContent==='Dikunci tugas AI');
  assert.match(await win.locator('#task-list').innerText(),/Berjalan/);
  console.log('PASS real stdio MCP starts a task and updates UI lock');

  const ownerless=await raw('browser_type',{selector:'#name-input',text:'invalid'});
  assert.equal(ownerless.isError,true);
  await action('browser_navigate',{url});
  await action('browser_wait',{selector:'#name-input'});
  await action('browser_type',{selector:'#name-input',text:'Hero Agent',clear:true});
  await action('browser_click',{selector:'#submit-btn'});
  assert.ok((await action('browser_get_dom',{format:'text'})).includes('Hero Agent'));
  const items=await action('browser_extract',{selector:'.item'});
  assert.deepEqual(items.map(i=>i.text),['Alpha','Beta','Gamma']);
  console.log('PASS task-bound navigation, typing, click and structured extraction');

  for(const format of ['html','text','outline']){
   const dom=await action('browser_get_dom',{format});
   for(const marker of ['DEMO_PASSWORD','DEMO_TOKEN','DEMO_NOTE','DEMO_HIDDEN','DEMO_URL','DEMO_FRAGMENT','DEMO_SCRIPT'])
    assert.ok(!dom.includes(marker),format+' must redact '+marker);
  }
  const extracted=JSON.stringify(await action('browser_extract',{selector:'body,input,textarea,script,a'}));
  for(const marker of ['DEMO_PASSWORD','DEMO_TOKEN','DEMO_NOTE','DEMO_HIDDEN','DEMO_URL','DEMO_FRAGMENT','DEMO_SCRIPT'])
   assert.ok(!extracted.includes(marker),'Extraction must redact '+marker);
  const guest=app.context().pages().find(p=>p.url().startsWith(url));
  assert.ok(guest);
  assert.equal(await guest.locator('#field-1').inputValue(),'DEMO_PASSWORD');
  assert.equal(await guest.locator('#notes').inputValue(),'DEMO_NOTE');
  console.log('PASS sanitized HTML, text, outline and extraction leave live fields untouched');

  const screenshot=await raw('browser_screenshot',{taskId});
  assert.ok(screenshot.content.some(c=>c.type==='image'&&c.data.length>100));
  console.log('PASS screenshot via MCP');

  const intervention=await action('browser_request_human_intervention',{reason:'CAPTCHA fixture',message:'Selesaikan pemeriksaan uji.',timeoutMs:10000});
  assert.equal(intervention.status,'human_required');assert.ok(intervention.resumeToken);
  await win.locator('#intervention-banner').waitFor({state:'visible'});
  const blocked=await raw('browser_type',{taskId,selector:'#name-input',text:'MUST_NOT_TYPE',clear:true});
  assert.equal(blocked.isError,true);
  assert.equal(await guest.locator('#name-input').inputValue(),'Hero Agent');
  assert.equal((await call('browser_get_task_status',{taskId})).status,'WAITING_FOR_HUMAN');
  await win.locator('#intervention-resume').click();
  await win.locator('#intervention-banner').waitFor({state:'hidden'});
  assert.equal((await call('browser_get_task_status',{taskId})).status,'RUNNING');
  console.log('PASS waiting-for-human blocks actions and human resume restores task');

  await action('browser_type',{selector:'#field-1',text:'DEMO_TYPED_SECRET',clear:true});
  const log=readFileSync(path.join(userDataDir,'audit.log'),'utf8');
  assert.ok(!log.includes('DEMO_TYPED_SECRET'));
  assert.ok(await win.locator('#activity-list .activity-item').count()>0);
  console.log('PASS audit and activity feed without typed secrets');

  const controller=new AbortController();
  const waiting=client.callTool({name:'browser_wait',arguments:{taskId,ms:60000}},undefined,{signal:controller.signal}).catch(e=>e);
  await new Promise(r=>setTimeout(r,200));controller.abort();
  await waiting;
  await win.waitForFunction(()=>document.querySelector('#task-list').textContent.includes('Dibatalkan'));
  assert.equal((await call('browser_get_task_status',{taskId})).status,'CANCELLED');
  console.log('PASS MCP cancellation propagates to browser task and releases its lock');

  const next=await call('browser_start_task',{profileId:'default'});
  await call('browser_complete_task',{taskId:next.id});
  await win.waitForFunction(()=>document.querySelector('#profile-control').textContent==='Manual');
  await win.screenshot({path:path.resolve('test-results/mcp-hardened.png')});
  console.log('PASS next task completes after cancellation; profile remains usable');
 }finally{
  if(client)await client.close();
  if(app)await app.close();
  await new Promise(r=>server.close(r));
 }
})().catch(e=>{console.error(e);process.exitCode=1;});
