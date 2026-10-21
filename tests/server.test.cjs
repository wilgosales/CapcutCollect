'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { startServer } = require('../src/server.cjs');
const { pathToFileURL } = require('node:url');
test('ponte local exige token e executa exportação/importação sem índice', async t => {
  const root = await fs.mkdtemp(path.join(require('node:os').tmpdir(), 'capcut-collect-http-'));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const drafts = path.join(root, 'drafts'); const source = path.join(drafts, 'Um projeto');
  await fs.mkdir(source, { recursive: true });
  const media = path.join(root, 'clip.mp4'); await fs.writeFile(media, 'vídeo de teste');
  await fs.writeFile(path.join(source, 'draft_content.json'), JSON.stringify({ id: 'timeline', materials: { videos: [{ id: 'material', path: media }] } }));
  await fs.writeFile(path.join(source, 'draft_meta_info.json'), JSON.stringify({ draft_id: 'original-project', draft_name: 'Um projeto', draft_fold_path: source, draft_root_path: drafts }));
  const backend = await startServer({ draftRoot: drafts, outputRoot: path.join(root, 'out'), importRoot: path.join(root, 'in') });
  t.after(() => backend.close());
  assert.equal((await fetch(backend.url + '/state')).status, 401);
  const headers = { Authorization: 'Bearer ' + backend.token, 'Content-Type': 'application/json' };
  async function state() { return (await fetch(backend.url + '/state', { headers })).json(); }
  async function wait() {
    for (let i = 0; i < 200; i++) { const value = await state(); if (value.job.status !== 'running') return value.job; await new Promise(r => setTimeout(r, 10)); }
    throw Error('Tempo de teste excedido');
  }
  const initial = await state(); assert.equal(initial.projects.length, 1);
  assert.equal((await fetch(backend.url + '/export', { method: 'POST', headers, body: JSON.stringify({ projectId: initial.projects[0].id }) })).status, 400);
  assert.equal(backend.job.status, 'idle');
  assert.equal((await fetch(backend.url + '/export', { method: 'POST', headers, body: JSON.stringify({ projectId: initial.projects[0].id, outputRoot: pathToFileURL(path.join(root, 'out')).href }) })).status, 202);
  const exported = await wait(); assert.equal(exported.status, 'done');
  assert.ok(exported.result.package.endsWith('.zip'));
  assert.equal((await fetch(backend.url + '/import', { method: 'POST', headers, body: JSON.stringify({ packagePath: exported.result.package }) })).status, 202);
  const imported = await wait(); assert.equal(imported.status, 'done');
  assert.match(imported.message, /^Project prepared:/);
  assert.equal(imported.result.globalIndexModified, false);
  assert.notEqual(imported.result.projectIdentity.after, 'original-project');
  assert.equal(JSON.parse(await fs.readFile(path.join(imported.result.draft, 'draft_content.json'))).id, 'timeline');
});
