// Runs only against a fresh synthetic profile under the staging engine directory.
const { app, BrowserWindow, WebContentsView } = require('electron');
const { DatabaseSync } = require('node:sqlite');
const timer = setTimeout(() => app.exit(1), 20000);
app.whenReady().then(async () => {
 const database = new DatabaseSync(':memory:');
 database.exec('CREATE VIRTUAL TABLE probe USING fts5(text)');
 database.close();
 const window = new BrowserWindow({ show:false, webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false} });
 const view = new WebContentsView({webPreferences:{sandbox:true,contextIsolation:true,nodeIntegration:false}});
 window.contentView.addChildView(view);
 await view.webContents.loadURL('data:text/html,<p id="probe">ready</p>');
 const result = await view.webContents.executeJavaScript("({ text:document.querySelector('#probe').textContent, node:typeof require })");
 if(result.text!=='ready'||result.node!=='undefined')throw new Error('Isolation test failed');
 console.log('HERO_ENGINE_OK '+JSON.stringify({electron:process.versions.electron,chromium:process.versions.chrome}));
 clearTimeout(timer);window.destroy();app.exit(0);
}).catch(()=>{clearTimeout(timer);app.exit(1);});
