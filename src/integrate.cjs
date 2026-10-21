'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
async function integrate({ pid, backend }) {
  if (!Number.isSafeInteger(pid) || pid < 1) throw Error('Provide --pid for the main CapCut process');
  const frida = require('frida');
  const device = await frida.getLocalDevice();
  const processes = await device.enumerateProcesses();
  if (!processes.some(p => p.pid === pid && p.name.toLowerCase() === 'capcut.exe')) throw Error('PID does not belong to CapCut');
  let panel = await fs.readFile(path.join(__dirname, '..', 'ui', 'CollectPanel.qml'), 'utf8');
  panel = panel.replace('__BRIDGE_URL__', JSON.stringify(backend.url)).replace('__BRIDGE_TOKEN__', JSON.stringify(backend.token));
  let agent = await fs.readFile(path.join(__dirname, 'qt-agent.js'), 'utf8');
  const marker = '__COLLECT_EXPRESSION__';
  if (!agent.includes(marker)) throw Error('Incompatible integration template');
  const expression = `(function(){ for(var i=0;i<contentItem.children.length;i++){if(contentItem.children[i].objectName==='capcutCollectPanel')throw new Error('Collect is already open');} var item=Qt.createQmlObject(${JSON.stringify(panel)}, contentItem, 'CapCutCollectPanel.qml'); return JSON.stringify({created:item!==null,parentIsContentItem:item.parent===contentItem,name:item.objectName}); })()`;
  agent = agent.replace(marker, JSON.stringify(expression));
  // This ABI was validated only against this specific CapCut / Qt combination.
  agent = `const actualQtModule=Process.getModuleByName('Qt6Core.dll'); if(!actualQtModule.path.replace(/\\\\/g,'/').includes('/9.6.0.4097/')) throw Error('Unsupported CapCut version'); const qtVersion=new NativeFunction(actualQtModule.getExportByName('qVersion'),'pointer',[])().readUtf8String(); if(qtVersion!=='6.2.2')throw Error('Unsupported Qt version: '+qtVersion);\n` + agent;
  const session = await device.attach(pid);
  let script;
  try {
    script = await session.createScript(agent, { name: 'CapCutCollect-v0.3' });
    script.message.connect(message => { if (message.type === 'error') console.error(message.description); });
    await script.load();
    const result = await script.exports.inspect();
    console.log('Internal panel created: ' + result.value);
  } finally {
    if (script) await script.unload().catch(() => {});
    await session.detach();
  }
  const monitor = setInterval(() => {
    try { process.kill(pid, 0); }
    catch (error) { if (error.code === 'ESRCH') backend.close().catch(() => {}); }
  }, 3000);
  monitor.unref();
  backend.server.once('close', () => clearInterval(monitor));
}
module.exports = { integrate };
