'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs/promises');
const { fileURLToPath } = require('node:url');
const { discoverProjects, exportProject, importPackage, readManifest, safeName } = require('./collect.cjs');
async function startServer({ draftRoot, outputRoot, importRoot, libraryMode = true }) {
  outputRoot = path.resolve(outputRoot); importRoot = path.resolve(importRoot);
  await fs.mkdir(outputRoot, { recursive: true }); await fs.mkdir(importRoot, { recursive: true });
  const token = crypto.randomBytes(32).toString('hex');
  let projects = await discoverProjects(draftRoot);
  let job = { status: 'idle', message: 'Choose a project to export or a collection to import.' };
  let closed = false;
  function reply(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); }
  const server = http.createServer(async (req, res) => {
    try {
      const supplied = req.headers.authorization || '';
      if (supplied.length !== token.length + 7 || !crypto.timingSafeEqual(Buffer.from(supplied), Buffer.from('Bearer ' + token))) return reply(res, 401, { error: 'Unauthorized' });
      if (req.method === 'GET' && req.url === '/state') return reply(res, 200, { projects: projects.map(({ id, name }) => ({ id, name })), outputRoot, importRoot, libraryMode, job });
      if (req.method !== 'POST') return reply(res, 404, { error: 'Unknown operation' });
      let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 16384) { req.destroy(); return; } }
      const body = raw ? JSON.parse(raw) : {};
      if (req.url === '/stop') {
        if (job.status === 'running') return reply(res, 409, { error: 'Wait for the operation to finish' });
        reply(res, 200, { stopped: true }); setTimeout(() => { closed = true; server.close(); }, 100); return;
      }
      if (job.status === 'running') return reply(res, 409, { error: 'Another operation is in progress' });
      if (req.url === '/refresh') { projects = await discoverProjects(draftRoot); return reply(res, 200, { refreshed: true }); }
      let operation;
      const stamp = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
      if (req.url === '/export') {
        const project = projects.find(p => p.id === body.projectId); if (!project) return reply(res, 400, { error: 'Select a project' });
        if (typeof body.outputRoot !== 'string' || !body.outputRoot.trim()) return reply(res, 400, { error: 'Choose the export destination folder' });
        const suppliedFolder = body.outputRoot.startsWith('file:') ? fileURLToPath(body.outputRoot) : body.outputRoot;
        const folder = path.resolve(suppliedFolder);
        if (!(await fs.stat(folder)).isDirectory()) return reply(res, 400, { error: 'Destination must be a folder' });
        if (body.format && !['zip', 'folder'].includes(body.format)) return reply(res, 400, { error: 'Invalid format' });
        operation = () => exportProject(project.path, path.join(folder, safeName(project.name) + '-' + stamp + (body.format === 'folder' ? '' : '.zip')), { format: body.format || 'zip' });
      } else if (req.url === '/import') {
        let packageFile = String(body.packagePath || '').trim();
        if (packageFile.startsWith('file:')) packageFile = fileURLToPath(packageFile);
        const folder = path.resolve(body.importRoot || importRoot); await fs.stat(folder);
        operation = async () => {
          const manifest = await readManifest(packageFile);
          const name = safeName(manifest.projectName).slice(0, 64);
          return importPackage(packageFile, path.join(folder, name + '-Collect-' + stamp), { layout: libraryMode ? 'library' : 'isolated' });
        };
      } else return reply(res, 404, { error: 'Unknown operation' });
      job = { status: 'running', operation: req.url.slice(1), message: req.url === '/export' ? 'Collecting files and calculating hashes…' : 'Validating and preparing the project…' };
      reply(res, 202, { accepted: true });
      const operationName = req.url.slice(1);
      operation().then(result => { job = { status: 'done', operation: operationName, message: operationName === 'export' ? 'Collection created: ' + result.package : 'Project prepared: ' + result.draft, result }; }).catch(error => { job = { status: 'error', message: error.message }; });
    } catch (error) { if (!res.headersSent) reply(res, 400, { error: error.message }); else res.destroy(); }
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  return { server, token, url: 'http://127.0.0.1:' + server.address().port, get job() { return job; }, get closed() { return closed; }, close: () => new Promise(resolve => server.close(resolve)) };
}
module.exports = { startServer };
