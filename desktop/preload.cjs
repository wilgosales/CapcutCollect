const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('collect',{run:(action,data)=>ipcRenderer.invoke('collect',action,data),onProgress:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('collect-progress',listener);return ()=>ipcRenderer.removeListener('collect-progress',listener);}});
