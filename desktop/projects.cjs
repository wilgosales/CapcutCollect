'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { discoverProjects, exportProject, resolveDraftPath, inside, safeName } = require('../src/collect.cjs');
async function catalog(root) {
  const projects = await discoverProjects(root);
  return Promise.all(projects.map(async project => {
    let title = project.name, cover;
    try { const meta = JSON.parse((await fs.readFile(path.join(project.path, 'draft_meta_info.json'), 'utf8')).replace(/^\uFEFF/, '')); if (typeof meta.draft_name === 'string' && meta.draft_name.trim()) title = meta.draft_name; if (typeof meta.draft_cover === 'string') cover = resolveDraftPath(project.path, meta.draft_cover); } catch {}
    let thumbnail = null;
    for (const candidate of [...new Set([cover, path.join(project.path, 'draft_cover.jpg'), path.join(project.path, 'draft_cover.png')].filter(Boolean))]) {
      try {
        if (!inside(project.path, candidate) || !inside(await fs.realpath(project.path), await fs.realpath(candidate))) continue;
        const ext = path.extname(candidate).toLowerCase(), mime = {'.jpg':'image/jpeg','.jpeg':'image/jpeg','.png':'image/png','.webp':'image/webp'}[ext];
        const stat = await fs.stat(candidate); if (!mime || !stat.isFile() || stat.size > 4 * 1024 * 1024) continue;
        thumbnail = 'data:' + mime + ';base64,' + (await fs.readFile(candidate)).toString('base64'); break;
      } catch {}
    }
    return { id: project.id, name: title, modifiedAt: project.modifiedAt, thumbnail };
  }));
}
async function exportMany(projects, destination, format, onProgress = () => {}) {
  if (!['zip', 'folder'].includes(format) || !projects.length) throw Error('Select projects and a valid format');
  const results = [];
  for (let i = 0; i < projects.length; i++) {
    const project = projects[i]; onProgress({ current: i + 1, total: projects.length, name: project.name });
    const output = path.join(destination, safeName(project.name).slice(0, 100) + '-' + Date.now() + '-' + crypto.randomBytes(3).toString('hex') + (format === 'zip' ? '.zip' : ''));
    try { results.push({ id: project.id, name: project.name, ok: true, result: await exportProject(project.path, output, { format, onProgress: detail => onProgress({ ...detail, current: i + 1, total: projects.length, name: project.name }) }) }); }
    catch (error) { results.push({ id: project.id, name: project.name, ok: false, error: error.message }); }
  }
  return { results, succeeded: results.filter(r => r.ok).length, failed: results.filter(r => !r.ok).length };
}
module.exports = { catalog, exportMany };
