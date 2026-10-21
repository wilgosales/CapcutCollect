'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
const {catalog,exportMany}=require('../desktop/projects.cjs');
test('catálogo usa a capa do CapCut, nome do metadado e ordem recente',async t=>{
 const root=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'capcut-collect-catalog-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));
 for(const [name,time]of [['Antigo',1000000],['Novo',2000000]]){const folder=path.join(root,name);await fs.mkdir(folder);await fs.writeFile(path.join(folder,'draft_content.json'),'{}');await fs.writeFile(path.join(folder,'draft_meta_info.json'),JSON.stringify({draft_name:'Título '+name,draft_cover:'cover.png',tm_draft_modified:time}));await fs.writeFile(path.join(folder,'cover.png'),'capa');}
 const before=await fs.readFile(path.join(root,'Novo/draft_meta_info.json'),'utf8');const rows=await catalog(root);assert.equal(rows[0].name,'Título Novo');assert.equal(rows[0].thumbnail,'data:image/png;base64,Y2FwYQ==');assert.equal(await fs.readFile(path.join(root,'Novo/draft_meta_info.json'),'utf8'),before);
 await fs.writeFile(path.join(root,'Novo/draft_meta_info.json'),JSON.stringify({draft_cover:'../Antigo/cover.png'}));assert.equal((await catalog(root)).find(p=>p.name==='Novo').thumbnail,null);
});
test('lote continua após falha e gera uma coleção por projeto com nomes repetidos',async t=>{
 const root=await fs.mkdtemp(path.join(require('node:os').tmpdir(),'capcut-collect-batch-'));t.after(()=>fs.rm(root,{recursive:true,force:true}));const source=path.join(root,'draft');await fs.mkdir(source);await fs.writeFile(path.join(source,'draft_content.json'),'{}');await fs.writeFile(path.join(source,'draft_meta_info.json'),JSON.stringify({draft_id:'id',draft_name:'Projeto'}));const out=path.join(root,'out');await fs.mkdir(out);const progress=[];
 const result=await exportMany([{id:'a',name:'Mesmo nome',path:source},{id:'b',name:'Ausente',path:path.join(root,'ausente')},{id:'c',name:'Mesmo nome',path:source}],out,'folder',p=>progress.push(p));
 assert.equal(result.succeeded,2);assert.equal(result.failed,1);assert.equal(result.results[1].ok,false);assert.equal(progress.filter(p=>!p.phase).length,3);assert.ok(progress.some(p=>p.phase==='scan'));assert.notEqual(result.results[0].result.package,result.results[2].result.package);assert.equal((await fs.readdir(out)).length,2);
 for(const row of result.results.filter(r=>r.ok))assert.deepEqual((await fs.readdir(row.result.package)).sort(),['Assets','draft_project','instruction import manual.txt'].sort());
});
