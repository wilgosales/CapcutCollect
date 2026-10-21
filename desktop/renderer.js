'use strict';
const $=id=>document.getElementById(id);
let projects=[],selected=new Set(),busy=false;
const dateFormat=new Intl.DateTimeFormat('en-US',{dateStyle:'short',timeStyle:'short'});
function visibleProjects(){const query=$('search').value.trim().toLocaleLowerCase('en-US');return projects.filter(p=>p.name.toLocaleLowerCase('en-US').includes(query));}
function updateSelection(){const visible=visibleProjects(),count=visible.filter(p=>selected.has(p.id)).length;$('select-all').checked=visible.length>0&&count===visible.length;$('select-all').indeterminate=count>0&&count<visible.length;$('selection-count').textContent=selected.size?`${selected.size} project${selected.size>1?'s':''} selected`:'None selected';for(const id of ['batch-zip','batch-folder'])$(id).disabled=busy||!selected.size;}
function render(){
 const list=visibleProjects();$('count').textContent=`${projects.length} project${projects.length!==1?'s':''} · newest first`;
 $('projects').replaceChildren();
 if(!list.length){const empty=document.createElement('p');empty.className='empty';empty.textContent=projects.length?'No projects match your search.':'No local projects found.';$('projects').append(empty);}
 for(const project of list){
  const row=document.createElement('article');row.className='project';
  const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(project.id);check.disabled=busy;check.setAttribute('aria-label','Select '+project.name);check.onchange=()=>{if(check.checked)selected.add(project.id);else selected.delete(project.id);updateSelection();};
  const thumb=document.createElement(project.thumbnail?'img':'div');thumb.className='thumb'+(project.thumbnail?'':' placeholder');if(project.thumbnail){thumb.src=project.thumbnail;thumb.alt='';thumb.loading='lazy';thumb.onerror=()=>{thumb.removeAttribute('src');};}else{thumb.textContent='▱';thumb.setAttribute('aria-hidden','true');}
  const info=document.createElement('div');info.className='project-info';const title=document.createElement('h3');title.textContent=project.name;const meta=document.createElement('p');meta.textContent='Modified '+dateFormat.format(new Date(project.modifiedAt));info.append(title,meta);
  const actions=document.createElement('div');actions.className='row-actions';for(const [format,label]of [['zip','ZIP'],['folder','Folder']]){const button=document.createElement('button');button.className=format==='zip'?'primary':'secondary';button.textContent=label;button.disabled=busy;button.setAttribute('aria-label','Export '+project.name+' as '+label);button.onclick=()=>run('export',{ids:[project.id],format});actions.append(button);}
  row.append(check,thumb,info,actions);$('projects').append(row);
 }
 updateSelection();
}
function setBusy(value){busy=value;for(const id of ['refresh','import','folder','integrate','search','select-all'])$(id).disabled=value;render();}
async function refresh(){try{const next=await window.collect.run('list');projects=next;const ids=new Set(next.map(p=>p.id));selected=new Set([...selected].filter(id=>ids.has(id)));render();}catch(e){$('status').textContent=e.message;}}
let taskStarted = 0, taskTimer, taskFileCount = '';
function updateTaskTime() { $('task-files').textContent = taskFileCount + Math.floor((Date.now() - taskStarted) / 1000) + 's elapsed'; }
function showTask(action) {
 if (!['export','import'].includes(action)) return;
 taskStarted = Date.now(); taskFileCount = ''; clearInterval(taskTimer); taskTimer = setInterval(updateTaskTime, 1000); $('task-title').textContent = action === 'export' ? 'Exporting collection' : 'Importing collection';
 $('task-counter').textContent = 'PREPARING'; $('task-project').textContent = ''; $('task-files').textContent = '';
 $('task-detail').textContent = action === 'export' ? 'Choose where to save your collection…' : 'Choose a collection to import…';
 document.body.setAttribute('aria-busy','true'); $('task-progress').showModal();
}
function taskProgress(progress) {
 if (!busy || !$('task-progress').open) return;
 $('task-counter').textContent = progress.total ? 'PROJECT ' + progress.current + ' OF ' + progress.total : 'WORKING';
 $('task-project').textContent = progress.name || '';
 $('task-detail').textContent = progress.message || 'Preparing project…';
 const count = Number.isFinite(progress.completed) && progress.fileTotal ? progress.completed + ' of ' + progress.fileTotal + ' files checked · ' : '';
 taskFileCount = count; updateTaskTime();
 $('status').textContent = (progress.name ? progress.name + ' — ' : '') + (progress.message || 'Preparing project…');
}
function hideTask() {
 clearInterval(taskTimer);
 if ($('task-progress').open) $('task-progress').close();
 document.body.removeAttribute('aria-busy');
 const tab = document.querySelector('[role="tab"][aria-selected="true"]'); if (tab) tab.focus();
}
$('task-progress').addEventListener('cancel', event => event.preventDefault());
async function run(action,data){setBusy(true);showTask(action);$('results').replaceChildren();$('results').hidden=true;$('status').textContent='Please wait…';try{const result=await window.collect.run(action,data);if(!result)$('status').textContent='Canceled.';else if(result.results){$('status').textContent=`${result.succeeded} project${result.succeeded!==1?'s':''} exported${result.failed?` · ${result.failed} failed`:''}.`;$('results').hidden=false;for(const entry of result.results){const line=document.createElement('p');line.className='result'+(entry.ok?'':' error');line.textContent=(entry.ok?'✓ ':'! ')+entry.name+' — '+(entry.ok?entry.result.package+(entry.result.adjustments?.length ? ` (${entry.result.adjustments.length} adjustments recorded in the manifest)` : ''):entry.error);$('results').append(line);}}else $('status').textContent=result.message||'Project imported: '+result.draft;if(action==='import')await refresh();}catch(e){$('status').textContent=e.message;}finally{hideTask();setBusy(false);}}
function tab(name){for(const id of ['export','import']){const active=id===name;$('tab-'+id).setAttribute('aria-selected',String(active));$('tab-'+id).tabIndex=active?0:-1;$('panel-'+id).hidden=!active;}}
for(const id of ['export','import']){$('tab-'+id).onclick=()=>tab(id);$('tab-'+id).onkeydown=e=>{if(['ArrowLeft','ArrowRight','Home','End'].includes(e.key)){e.preventDefault();const next=e.key==='Home'?'export':e.key==='End'?'import':id==='export'?'import':'export';tab(next);$('tab-'+next).focus();}};}
$('search').oninput=render;$('select-all').onchange=()=>{for(const p of visibleProjects())if($('select-all').checked)selected.add(p.id);else selected.delete(p.id);render();};
$('batch-zip').onclick=()=>run('export',{ids:projects.filter(p=>selected.has(p.id)).map(p=>p.id),format:'zip'});$('batch-folder').onclick=()=>run('export',{ids:projects.filter(p=>selected.has(p.id)).map(p=>p.id),format:'folder'});
$('import').onclick=()=>run('import');$('folder').onclick=()=>run('import',{folder:true});$('integrate').onclick=()=>run('integrate');$('refresh').onclick=refresh;
window.collect.onProgress(taskProgress);refresh();
