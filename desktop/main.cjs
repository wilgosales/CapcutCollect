'use strict';
const {app,BrowserWindow,ipcMain,dialog}=require('electron');
const path=require('node:path');
const {discoverProjects,exportProject,importPackage,readManifest,safeName}=require('../src/collect.cjs');
const root=()=>process.env.CAPCUT_DRAFT_ROOT||path.join(app.getPath('home'),'AppData/Local/CapCut/User Data/Projects/com.lveditor.draft');
const { catalog, exportMany } = require('./projects.cjs');
let win, busy=false, backend;
app.requestSingleInstanceLock() || app.quit();
app.on('second-instance',()=>{if(win){win.show();win.focus();}});
ipcMain.handle('collect',async(event,action,data={})=>{
 if(event.sender!==win.webContents) throw Error('Invalid window');
 if(action==='list') return catalog(root());
 if(busy) throw Error('Wait for the operation to finish');
 busy=true;
 let lastProgress = 0, lastPhase, lastProject;
 function progress(detail) { const now = Date.now(); if (now - lastProgress < 150 && detail.phase !== 'finish' && detail.phase === lastPhase && detail.current === lastProject) return; lastProgress = now; lastPhase = detail.phase; lastProject = detail.current; if (!win.isDestroyed()) win.webContents.send('collect-progress', { operation: action, ...detail }); }
 try{
  if(action==='export'){
   const projects=await discoverProjects(root());
   const ids = data.ids || [data.id];
   if (!Array.isArray(ids) || !ids.length || ids.length > projects.length || new Set(ids).size !== ids.length) throw Error('Invalid selection');
   const selected = ids.map(id => { const project = projects.find(p => p.id === id); if (!project) throw Error('Project not found; refresh the list'); return project; });
   if(!['zip','folder'].includes(data.format))throw Error('Invalid format');
   const pick=await dialog.showOpenDialog(win,{title:'Choose export destination',buttonLabel:'Export here',properties:['openDirectory','createDirectory']});if(pick.canceled)return null;
   return await exportMany(selected, pick.filePaths[0], data.format, progress);
  }
  if(action==='import'){
   const pick=await dialog.showOpenDialog(win,{title:'Select a collection',buttonLabel:'Select collection',properties:[data.folder?'openDirectory':'openFile'],filters:[{name:'Collect collection',extensions:['zip','capcollect']}]});if(pick.canceled)return null;
   progress({ phase: 'validate', message: 'Reading collection…' });
   const manifest=await readManifest(pick.filePaths[0]);
   progress({ phase: 'validate', message: 'Checking collection integrity…', name: manifest.projectName });
   return await importPackage(pick.filePaths[0],path.join(root(),safeName(manifest.projectName).slice(0,64)+'-Collect-'+Date.now()+'-'+require('node:crypto').randomBytes(3).toString('hex')),{layout:'library', onProgress: detail => progress({ ...detail, name: manifest.projectName }) });
  }
  if(action==='integrate'){
   if(backend&&!backend.closed)throw Error('Integration is already active');
   const {execFile}=require('node:child_process');
   const query="@(Get-CimInstance Win32_Process -Filter \"Name='CapCut.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }) | ConvertTo-Json -Compress";
   const {stdout}=await require('node:util').promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-Command',query],{windowsHide:true});
   const parsed=stdout.trim()?JSON.parse(stdout):[];const pids=Array.isArray(parsed)?parsed:[parsed];if(pids.length!==1)throw Error('Open one CapCut instance on the home screen, with projects saved and closed.');
   backend=await require('../src/server.cjs').startServer({draftRoot:root(),outputRoot:app.getPath('documents'),importRoot:root()});
   try{await require('../src/integrate.cjs').integrate({pid:pids[0],backend});}catch(e){await backend.close();throw e;}
   return {message:'Panel connected to CapCut.'};
  }
  throw Error('Invalid operation');
 }finally{busy=false;}
});
app.whenReady().then(()=>{win=new BrowserWindow({width:1040,height:800,minWidth:720,minHeight:620,autoHideMenuBar:true,icon:path.join(__dirname,'../assets/icon.ico'),webPreferences:{preload:path.join(__dirname,'preload.cjs'),contextIsolation:true,nodeIntegration:false,sandbox:true}});win.on('close',event=>{if(busy){event.preventDefault();dialog.showMessageBox(win,{message:'Wait for the operation to finish before closing.'});}});win.webContents.setWindowOpenHandler(()=>({action:'deny'}));win.webContents.on('will-navigate',e=>e.preventDefault());win.loadFile(path.join(__dirname,'index.html'));});
app.on('window-all-closed',()=>{if(!busy){backend?.close();app.quit();}});
app.on('before-quit',event=>{if(busy){event.preventDefault();dialog.showMessageBox(win,{message:'Wait for export or import to finish before closing.'});}});
