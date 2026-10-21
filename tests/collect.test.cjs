'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const yazl = require('yazl');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const { exportProject, importPackage, readManifest, hashFile, archivePath, resolveDraftPath, discoverProjects } = require('../src/collect.cjs');
const { MANUAL_FILE } = require('../src/manual.cjs');
async function fixture(t) {
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'capcut-collect-test-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const source = path.join(root, 'Projeto com espaços');
  const media = path.join(root, 'mídia.mp4');
  await fs.mkdir(path.join(source, 'Timelines', 'timeline-1'), { recursive: true });
  await fs.writeFile(media, 'conteúdo audiovisual de teste');
  const doc = '{"id":"timeline-1","large":9007199254740993,"materials":{"videos":[{"id":"material-1","path":' + JSON.stringify(media) + '}]},"tracks":[{"segments":[{"material_id":"material-1"}]}]}';
  for (const name of ['draft_content.json', 'draft_content.json.bak', 'template-2.tmp', 'Timelines/timeline-1/draft_content.json']) await fs.writeFile(path.join(source, name), doc);
  await fs.writeFile(path.join(source, 'draft_meta_info.json'), JSON.stringify({ draft_id: 'project-1', draft_name: 'Teste ç', draft_fold_path: '/antigo', draft_root_path: '/raiz', draft_cover: 'draft_cover.jpg', draft_materials: [{ value: [{ file_Path: media, id: 'local-1' }] }] }));
  await fs.writeFile(path.join(source, 'draft_cover.jpg'), 'capa');
  await fs.writeFile(path.join(source, 'draft_biz_config.json'), '');
  return { root, source, media, doc, package: path.join(root, 'teste.zip') };
}
async function makeZip(file, manifest, files) {
  const zip = new yazl.ZipFile();
  const done = pipeline(zip.outputStream, createWriteStream(file));
  zip.addBuffer(Buffer.from(JSON.stringify(manifest)), 'collect-manifest.json');
  for (const [name, buffer] of files) zip.addBuffer(Buffer.from(buffer), name);
  zip.end(); await done;
}
test('áudio nativo do CapCut preserva Resources/audioAlg e o nome original em exportação e importação', async t => {
  const f = await fixture(t); const relative = 'Resources/audioAlg/voice_human.wav';
  await fs.mkdir(path.join(f.source, 'Resources/audioAlg'), { recursive: true });
  const nativeAudio = Buffer.from('RIFFnativeCapCutWAVE').map(byte => byte ^ 0xef);
  await fs.writeFile(path.join(f.source, relative), nativeAudio);
  const audioId = 'audio-native';
  const doc = JSON.stringify({ materials: { audios: [{ id: audioId, type: 'extract_music', path: relative }] }, tracks: [{ type: 'audio', segments: [{ material_id: audioId }] }] });
  for (const file of ['draft_content.json', 'Timelines/timeline-1/draft_content.json']) await fs.writeFile(path.join(f.source, file), doc);
  await exportProject(f.source, f.package);
  const manifest = await readManifest(f.package);
  assert.ok(manifest.files.some(file => file.path === 'Project/' + relative));
  assert.ok(!manifest.files.some(file => file.path.startsWith('Assets/') && file.path.endsWith('voice_human.wav')));
  const progress = [];
  const imported = await importPackage(f.package, path.join(f.root, 'Native'), { layout: 'library', onProgress: event => progress.push(event) });
  for (const phase of ['validate', 'extract', 'relink', 'verify', 'finish']) assert.ok(progress.some(event => event.phase === phase));
  assert.deepEqual(await fs.readFile(path.join(imported.draft, relative)), nativeAudio);
  for (const file of ['draft_content.json', 'Timelines/timeline-1/draft_content.json']) {
    const result = JSON.parse(await fs.readFile(path.join(imported.draft, file)));
    assert.equal(result.materials.audios[0].path, path.join(imported.draft, relative).split(path.sep).join('/'));
    assert.equal(result.tracks[0].segments[0].material_id, audioId);
  }
  assert.equal(await fs.readFile(path.join(f.source, 'draft_content.json'), 'utf8'), doc);
});
test('importação de pacote antigo restaura áudio nativo achatado usando o caminho original do manifesto', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, 'draft_content.json'), JSON.stringify({ materials: { audios: [{ id: 'voice', path: f.media, type: 'extract_music' }] } }));
  await exportProject(f.source, f.package);
  const m = await readManifest(f.package);
  const record = m.files.find(file => file.path.startsWith('Assets/'));
  for (const ref of m.references.filter(ref => ref.target === record.path)) ref.original = 'C:/other/Resources/audioAlg/native_human.wav';
  const plan = await require('../src/collect.cjs').planProject(f.source);
  const content = await Promise.all(m.files.map(async file => { const entry = plan.entries.get(file.path); return [file.path, entry.buffer || await fs.readFile(entry.source)]; }));
  const oldZip = path.join(f.root, 'antigo.zip'); await makeZip(oldZip, m, content);
  const imported = await importPackage(oldZip, path.join(f.root, 'Reparado'), { layout: 'library' });
  const doc = JSON.parse(await fs.readFile(path.join(imported.draft, 'draft_content.json')));
  assert.equal(doc.materials.audios[0].path, path.join(imported.draft, 'Resources/audioAlg/native_human.wav').split(path.sep).join('/'));
  assert.equal(doc.materials.audios[0].id, 'voice');
  assert.equal(imported.nativeResourceRepairs.length, 1);
  assert.equal(await fs.readFile(doc.materials.audios[0].path, 'utf8'), 'conteúdo audiovisual de teste');
});
test('exportação atualiza datas na cópia e reúne mídias internas e externas sem subpastas em Assets', async t => {
  const f = await fixture(t);
  const metaFile = path.join(f.source, 'draft_meta_info.json');
  const meta = JSON.parse(await fs.readFile(metaFile));
  meta.tm_draft_create = 1600000000000000; meta.tm_draft_modified = 1600000001000000;
  await fs.writeFile(metaFile, JSON.stringify(meta));
  const original = await fs.readFile(metaFile, 'utf8');
  await fs.mkdir(path.join(f.source, 'Assets/Videos'), { recursive: true });
  await fs.writeFile(path.join(f.source, 'Assets/Videos/mídia.mp4'), 'mídia interna');
  await fs.writeFile(path.join(f.source, 'draft_content.json'), JSON.stringify({ materials: { videos: [{ id: 'i', path: 'Assets/Videos/mídia.mp4' }, { id: 'e', path: f.media }] } }));
  const started = Date.now() * 1000;
  const output = path.join(f.root, 'Plano');
  await exportProject(f.source, output, { format: 'folder' });
  const exported = JSON.parse(await fs.readFile(path.join(output, 'Projeto com espaços_project/draft_meta_info.json')));
  assert.ok(exported.tm_draft_modified >= started && exported.tm_draft_modified <= Date.now() * 1000);
  assert.equal(exported.tm_draft_create, exported.tm_draft_modified);
  assert.equal(await fs.readFile(metaFile, 'utf8'), original);
  const files = await fs.readdir(path.join(output, 'Assets'), { withFileTypes: true });
  assert.equal(files.length, 2); assert.ok(files.every(file => file.isFile()));
  assert.notEqual(files[0].name, files[1].name);
  const imported = await importPackage(output, path.join(f.root, 'Importado'), { layout: 'library' });
  const doc = JSON.parse(await fs.readFile(path.join(imported.draft, 'draft_content.json')));
  assert.equal(await fs.readFile(doc.materials.videos[0].path, 'utf8'), 'mídia interna');
  assert.equal(await fs.readFile(doc.materials.videos[1].path, 'utf8'), 'conteúdo audiovisual de teste');
});
test('pastas de recursos mantêm sua estrutura dentro do projeto e não criam subpastas em Assets', async t => {
  const f = await fixture(t); const resource = path.join(f.root, 'efeito');
  await fs.mkdir(path.join(resource, 'nested'), { recursive: true });
  await fs.writeFile(path.join(resource, 'nested/config.bin'), 'recurso');
  await fs.writeFile(path.join(f.source, 'draft_content.json'), JSON.stringify({ effect: { path: resource } }));
  const output = path.join(f.root, 'Recursos'); await exportProject(f.source, output, { format: 'folder' });
  assert.ok((await fs.readdir(path.join(output, 'Assets'), { withFileTypes: true })).every(file => file.isFile()));
  const imported = await importPackage(output, path.join(f.root, 'Destino recurso'), { layout: 'library' });
  const doc = JSON.parse(await fs.readFile(path.join(imported.draft, 'draft_content.json')));
  assert.equal(await fs.readFile(path.join(doc.effect.path, 'nested/config.bin'), 'utf8'), 'recurso');
});
test('patch antigo usa arquivo interno exato do draft atual e limpa somente cache de matting desativado', async t => {
  const f = await fixture(t);
  await fs.writeFile(path.join(f.source, 'freeze.png'), 'quadro congelado');
  const current = { id: 'timeline', large: 'preservar', materials: { videos: [{ id: 'frame', path: 'freeze.png', matting: { flag: 0, path: 'matting/cache-ausente' } }] } };
  const original = JSON.stringify(current);
  await fs.writeFile(path.join(f.source, 'draft_content.json'), original);
  const patch = path.join(f.source, 'Timelines/timeline-1/attachment/patch'); await fs.mkdir(patch, { recursive: true });
  await fs.writeFile(path.join(patch, 'mini_draft.json'), JSON.stringify({ mini_draft_data: { segments: [{ material: { id: 'frame', path: 'C:/old/com.lveditor.draft/Outro/freeze.png' }, matting: { flag: 0, path: 'C:/old/com.lveditor.draft/Outro/matting/cache-ausente' } }] } }));
  const result = await exportProject(f.source, f.package);
  assert.equal(result.adjustments.filter(a => a.kind === 'disabled-matting').length, 2);
  assert.equal(result.adjustments.filter(a => a.kind === 'relocated-patch-resource').length, 1);
  const imported = await importPackage(f.package, path.join(f.root, 'Destino'), { layout: 'library' });
  const doc = JSON.parse(await fs.readFile(path.join(imported.draft, 'draft_content.json')));
  assert.equal(doc.materials.videos[0].matting.path, '');
  assert.equal(doc.materials.videos[0].matting.flag, 0);
  assert.equal(doc.materials.videos[0].id, 'frame');
  const mini = JSON.parse(await fs.readFile(path.join(imported.draft, 'Timelines/timeline-1/attachment/patch/mini_draft.json')));
  assert.equal(await fs.readFile(mini.mini_draft_data.segments[0].material.path, 'utf8'), 'quadro congelado');
  assert.equal(await fs.readFile(path.join(f.source, 'draft_content.json'), 'utf8'), original);
});
test('matting ativo ou patch sem correspondência no draft atual continuam bloqueando a coleta', async t => {
  const f = await fixture(t);
  const doc = { materials: { videos: [{ id: 'v', matting: { flag: 1, path: 'cache-ausente' } }] } };
  await fs.writeFile(path.join(f.source, 'draft_content.json'), JSON.stringify(doc));
  await assert.rejects(exportProject(f.source, f.package), /missing/);
  await fs.writeFile(path.join(f.source, 'draft_content.json'), f.doc);
  await fs.writeFile(path.join(f.source, 'unreferenced.png'), 'não é usado no draft atual');
  const patch = path.join(f.source, 'Timelines/timeline-1/attachment/patch'); await fs.mkdir(patch, { recursive: true });
  await fs.writeFile(path.join(patch, 'mini_draft.json'), JSON.stringify({ path: 'C:/old/com.lveditor.draft/Outro/unreferenced.png' }));
  await assert.rejects(exportProject(f.source, f.package), /missing/);
});
test('pasta sem compactação tem somente projeto, Assets e tutorial e pode ser importada', async t => {
  const f = await fixture(t);
  const output = path.join(f.root, 'Colecao');
  await exportProject(f.source, output, { format: 'folder' });
  assert.deepEqual((await fs.readdir(output)).sort(), ['Assets', 'Projeto com espaços_project', MANUAL_FILE].sort());
  const physical = JSON.parse(await fs.readFile(path.join(output, 'Projeto com espaços_project', 'collect-manifest.json')));
  assert.equal(physical.draft, 'Projeto com espaços_project');
  assert.ok(physical.files.some(file => file.path === 'Projeto com espaços_project/draft_content.json'));
  await fs.rename(f.media, f.media + '.indisponivel');
  const imported = await importPackage(output, path.join(f.root, 'Destino pasta'), { layout: 'library' });
  const doc = JSON.parse(await fs.readFile(path.join(imported.draft, 'draft_content.json')));
  assert.equal(await fs.readFile(doc.materials.videos[0].path, 'utf8'), 'conteúdo audiovisual de teste');
  await assert.rejects(exportProject(f.source, output, { format: 'folder' }), /already exists/);
});
test('ZIP apresenta o novo layout físico com manifesto dentro do projeto', async t => {
  const f = await fixture(t); await exportProject(f.source, f.package);
  const names = await new Promise((resolve, reject) => require('yauzl').open(f.package, { lazyEntries: true }, (err, zip) => {
    if (err) return reject(err);
    const rows = []; zip.on('error', reject); zip.on('entry', entry => { rows.push(entry.fileName); zip.readEntry(); }); zip.on('end', () => resolve(rows)); zip.readEntry();
  }));
  assert.deepEqual([...new Set(names.map(name => name.split('/')[0]))].sort(), ['Assets', 'Projeto com espaços_project', MANUAL_FILE].sort());
  assert.ok(names.includes('Projeto com espaços_project/collect-manifest.json'));
  assert.ok(!names.includes('collect-manifest.json'));
});
test('round-trip entre destinos, JSON exato e mídia sem origem disponível', async t => {
  const f = await fixture(t); const before = await hashFile(path.join(f.source, 'draft_content.json'));
  const result = await exportProject(f.source, f.package);
  assert.equal(result.references, 6); // cinco referências à mídia mais a capa
  const m = await readManifest(f.package);
  assert.ok(m.files.some(file => file.path === MANUAL_FILE));
  assert.equal(m.files.filter(x => x.path.startsWith('Assets/')).length, 1);
  await fs.rename(f.media, f.media + '.indisponivel');
  for (const destination of [path.join(f.root, 'Computador A'), path.join(f.root, 'Computador B')]) {
    const imported = await importPackage(f.package, destination);
    assert.equal(imported.globalIndexModified, false);
    const guide = await fs.readFile(path.join(destination, MANUAL_FILE), 'utf8');
    assert.match(guide, /HOW TO OPEN THE PROJECT/);
    assert.match(guide, /Assets/);
    assert.match(guide, /Projeto com espaços_project/);
    assert.match(guide, /relink media/);
    const doc = await fs.readFile(path.join(imported.draft, 'draft_content.json'), 'utf8');
    assert.match(doc, /9007199254740993/);
    const value = JSON.parse(doc);
    assert.equal(value.id, 'timeline-1');
    assert.equal(value.tracks[0].segments[0].material_id, 'material-1');
    const dependency = value.materials.videos[0].path;
    assert.ok(path.isAbsolute(dependency));
    assert.equal(await fs.readFile(dependency, 'utf8'), 'conteúdo audiovisual de teste');
    const meta = JSON.parse(await fs.readFile(path.join(imported.draft, 'draft_meta_info.json')));
    assert.equal(meta.draft_id, 'project-1');
    assert.equal(meta.draft_fold_path, imported.draft.split(path.sep).join('/'));
    assert.equal(meta.draft_root_path, destination.split(path.sep).join('/'));
  }
  assert.equal(await hashFile(path.join(f.source, 'draft_content.json')), before);
});
test('recusa sobrescrever e dependência ausente, sem pacote parcial', async t => {
  const f = await fixture(t);
  await exportProject(f.source, f.package);
  await assert.rejects(exportProject(f.source, f.package), /already exists/);
  await fs.unlink(f.media);
  const another = path.join(f.root, 'outro.zip');
  await assert.rejects(exportProject(f.source, another), /missing/);
  await assert.rejects(fs.stat(another), /ENOENT/);
  const target = path.join(f.root, 'existente'); await fs.mkdir(target);
  await assert.rejects(importPackage(f.package, target), /already exists/);
});
test('hash divergente e arquivo não declarado abortam e limpam staging', async t => {
  const f = await fixture(t); await exportProject(f.source, f.package);
  const m = await readManifest(f.package);
  const bad = path.join(f.root, 'corrompido.zip');
  await makeZip(bad, m, m.files.map(file => [file.path, 'conteúdo adulterado']));
  const target = path.join(f.root, 'destino');
  await assert.rejects(importPackage(bad, target), /mismatch|Integrity/);
  await assert.rejects(fs.stat(target), /ENOENT/);
  assert.equal((await fs.readdir(f.root)).some(n => n.startsWith('.collect-stage-')), false);
  const extra = path.join(f.root, 'extra.zip');
  await makeZip(extra, m, [['fora-do-manifesto.txt', 'adicional']]);
  await assert.rejects(importPackage(extra, target), /Undeclared/);
});
test('manifesto não pode escapar do pacote ou editar IDs', async t => {
  const f = await fixture(t); await exportProject(f.source, f.package);
  const m = await readManifest(f.package);
  m.references[0].target = '../fora.mp4';
  const bad = path.join(f.root, 'escape.zip'); await makeZip(bad, m, []);
  await assert.rejects(importPackage(bad, path.join(f.root, 'escape')), /Unsafe/);
  for (const value of ['../x', '/x', 'C:/x', 'a\\b', 'Assets/CON.txt', 'Assets/a:ads', 'Assets/a./x']) assert.throws(() => archivePath(value));
  const changed = await readManifest(f.package); changed.references[0].parts = ['id'];
  const id = path.join(f.root, 'id.zip'); await makeZip(id, changed, []);
  await assert.rejects(importPackage(id, path.join(f.root, 'id')), /Invalid reference target/);
});
test('links simbólicos são recusados', async t => {
  const f = await fixture(t);
  try { await fs.symlink(f.media, path.join(f.source, 'link.mp4')); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) { t.skip('Sem permissão de criar symlink neste Windows'); return; } throw e; }
  await assert.rejects(exportProject(f.source, f.package), /Link/);
});
test('junções de diretório são recusadas no Windows', async t => {
  if (process.platform !== 'win32') return t.skip('Teste específico de junção Windows');
  const f = await fixture(t); const target = path.join(f.root, 'outra-pasta'); await fs.mkdir(target);
  try { await fs.symlink(target, path.join(f.source, 'juncao'), 'junction'); }
  catch (e) { if (['EPERM', 'EACCES'].includes(e.code)) return t.skip('Sem permissão para criar junção'); throw e; }
  await assert.rejects(exportProject(f.source, f.package), /Link/);
});
test('layout de biblioteca coloca draft e Assets na raiz e cria identidade própria', async t => {
  const f = await fixture(t);
  const metaFile = path.join(f.source, 'draft_meta_info.json');
  const original = JSON.parse(await fs.readFile(metaFile));
  original.tm_draft_create = 1600000000000000;
  original.tm_draft_modified = 1600000001000000;
  await fs.writeFile(metaFile, JSON.stringify(original));
  await exportProject(f.source, f.package);
  const started = Date.now() * 1000;
  const destination = path.join(f.root, 'Novo Collect');
  const imported = await importPackage(f.package, destination, { layout: 'library' });
  assert.equal(imported.draft, destination);
  const meta = JSON.parse(await fs.readFile(path.join(destination, 'draft_meta_info.json')));
  assert.notEqual(meta.draft_id, 'project-1');
  assert.equal(meta.draft_name, 'Teste ç (Collect)');
  assert.ok(meta.tm_draft_modified >= started && meta.tm_draft_modified <= Date.now() * 1000);
  assert.equal(meta.tm_draft_create, meta.tm_draft_modified);
  assert.deepEqual(JSON.parse(await fs.readFile(metaFile)), original);
  const projects = await discoverProjects(f.root);
  assert.equal(projects[0].path, destination);
  assert.equal(meta.draft_root_path, f.root.split(path.sep).join('/'));
  assert.equal(meta.draft_fold_path, destination.split(path.sep).join('/'));
  const doc = JSON.parse(await fs.readFile(path.join(destination, 'draft_content.json')));
  assert.equal(doc.id, 'timeline-1');
  assert.equal(doc.materials.videos[0].id, 'material-1');
  assert.equal(await fs.readFile(doc.materials.videos[0].path, 'utf8'), 'conteúdo audiovisual de teste');
  assert.equal(imported.globalIndexModified, false);
  assert.equal(imported.internalIdsPreserved, true);
});
test('layout de biblioteca recusa colisão entre Project/Assets e Assets', async t => {
  const f = await fixture(t); await exportProject(f.source, f.package);
  const m = await readManifest(f.package);
  const asset = m.files.find(file => file.path.startsWith('Assets/'));
  m.files.push({ ...asset, path: 'Project/' + asset.path });
  const bad = path.join(f.root, 'colisao.zip'); await makeZip(bad, m, []);
  await assert.rejects(importPackage(bad, path.join(f.root, 'destino'), { layout: 'library' }), /Collision in library layout/);
});
test('recoleta caminhos com marcador nativo salvo pelo CapCut', async t => {
  const f = await fixture(t);
  await fs.mkdir(path.join(f.source, 'Assets', 'Videos'), { recursive: true });
  await fs.copyFile(f.media, path.join(f.source, 'Assets', 'Videos', 'interno.mp4'));
  const marker = '##_draftpath_placeholder_0E685133-18CE-45ED-8CB8-2904A212EC80_##/';
  const value = JSON.parse(f.doc); value.materials.videos[0].path = marker + 'Assets/Videos/interno.mp4';
  await fs.writeFile(path.join(f.source, 'draft_content.json'), JSON.stringify(value));
  await exportProject(f.source, f.package);
  const imported = await importPackage(f.package, path.join(f.root, 'Recoletado'), { layout: 'library' });
  const doc = JSON.parse(await fs.readFile(path.join(imported.draft, 'draft_content.json')));
  assert.equal(await fs.readFile(doc.materials.videos[0].path, 'utf8'), 'conteúdo audiovisual de teste');
  assert.throws(() => resolveDraftPath(f.source, marker + '../fora.mp4'), /outside the project/);
});
test('preserva importacao do formato antigo e regenera guia na recoleta', async t => {
  const f = await fixture(t); await exportProject(f.source, f.package);
  const old = path.join(f.root, 'antigo.capcollect'); await fs.copyFile(f.package, old);
  const destination = path.join(f.root, 'Biblioteca');
  await importPackage(old, destination, { layout: 'library' });
  const recollected = path.join(f.root, 'recoletado.zip');
  await exportProject(destination, recollected);
  const manifest = await readManifest(recollected);
  assert.equal(manifest.files.filter(file => file.path.toLowerCase().endsWith(MANUAL_FILE)).length, 1);
  await importPackage(recollected, path.join(f.root, 'Outro destino'), { layout: 'library' });
  await assert.rejects(exportProject(f.source, path.join(f.root, 'nao-exportar.capcollect')), /\.zip extension/);
});
