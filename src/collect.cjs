'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const { pipeline } = require('node:stream/promises');
const { Transform } = require('node:stream');
const json = require('jsonc-parser');
const yazl = require('yazl');
const yauzl = require('yauzl');
const { MANUAL_FILE, createManualInstructions } = require('./manual.cjs');

const packagePath = (name, folder = 'Capcut Project') => name === 'collect-manifest.json' ? folder + '/collect-manifest.json' : name.replace(/^Project\//, folder + '/');
const internalPath = name => name.replace(/^(?:Capcut Project|[^/]+_project)\//, 'Project/');
const MAX_JSON = 32 * 1024 * 1024;
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
async function hashFile(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}
function inside(root, file) {
  const relative = path.relative(root, file);
  return relative === '' || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative));
}
function archivePath(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || value.startsWith('/') || /^[a-z]:/i.test(value)) throw Error('Invalid package path');
  const parts = value.split('/');
  if (parts.some(p => !p || p === '.' || p === '..' || /[:<>"|?*\x00-\x1f]/.test(p) || /[. ]$/.test(p) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p))) throw Error('Unsafe package path: ' + value);
  return value;
}
function safeName(value) {
  return value.normalize('NFC').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[. ]+$/g, '').slice(0, 150) || 'Project';
}
function resolveDraftPath(root, value) {
  // Observed after CapCut saved the imported draft. This is not a normal relative path.
  const marker = /^##_draftpath_placeholder_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}_##[\\/]/i;
  if (marker.test(value)) {
    const resolved = path.resolve(root, value.replace(marker, ''));
    if (!inside(root, resolved)) throw Error('Draft placeholder points outside the project');
    return resolved;
  }
  return path.resolve(root, value);
}
async function assertNoLinks(file) {
  const absolute = path.resolve(file);
  const parts = absolute.slice(path.parse(absolute).root.length).split(path.sep).filter(Boolean);
  let current = path.parse(absolute).root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = await fsp.lstat(current);
    if (stat.isSymbolicLink()) throw Error('Links/junctions are not supported: ' + current);
  }
}
async function walkFiles(root) {
  await assertNoLinks(root);
  const files = [];
  async function visit(dir) {
    for (const item of await fsp.readdir(dir, { withFileTypes: true })) {
      const file = path.join(dir, item.name);
      if (item.isSymbolicLink()) throw Error('Link/junction found: ' + file);
      if (item.isDirectory()) await visit(file);
      else if (item.isFile()) files.push(file);
      else throw Error('Unsupported file type: ' + file);
    }
  }
  await visit(root);
  return files.sort();
}
function parseDocument(text, label) {
  const errors = [];
  const tree = json.parseTree(text.replace(/^\uFEFF/, ' '), errors, { disallowComments: true, allowTrailingComma: false });
  if (!tree || errors.length) throw Error('Invalid JSON: ' + label);
  return tree;
}
function stringLeaves(tree) {
  const rows = [];
  function visit(node, parts) {
    if (node.type === 'object') for (const prop of node.children || []) visit(prop.children[1], [...parts, prop.children[0].value]);
    else if (node.type === 'array') (node.children || []).forEach((item, i) => visit(item, [...parts, i]));
    else if (node.type === 'string') rows.push({ parts, value: node.value, offset: node.offset, length: node.length });
  }
  visit(tree, []);
  return rows;
}
function rewrite(text, updates, label) {
  const tree = parseDocument(text, label);
  const edits = updates.map(update => {
    const node = json.findNodeAtLocation(tree, update.parts);
    const numericDate = update.parts.length === 1 && ['tm_draft_create', 'tm_draft_modified'].includes(update.parts[0]) && node?.type === 'number' && Number.isSafeInteger(update.after);
    if (!node || (node.type !== 'string' && !numericDate) || node.value !== update.before) throw Error('Field mismatch: ' + label + ' ' + JSON.stringify(update.parts));
    return { offset: node.offset, length: node.length, text: JSON.stringify(update.after) };
  }).sort((a, b) => b.offset - a.offset);
  for (let i = 0; i < edits.length; i++) {
    if (i && edits[i].offset + edits[i].length > edits[i - 1].offset) throw Error('Overlapping edits');
    const edit = edits[i];
    text = text.slice(0, edit.offset) + edit.text + text.slice(edit.offset + edit.length);
  }
  parseDocument(text, label);
  return text;
}
function pathField(parts, value) {
  if (!value) return false;
  const key = String(parts.at(-1));
  if (['draft_fold_path', 'draft_root_path'].includes(key)) return false;
  return /^(path|file_path|draft_cover|media_path|res_path|error_path|production_path|matrix_path|origin_path|source_video_path|source_cover_path)$/i.test(key)
    || /_path$/i.test(key)
    || (/^(image|album_image)$/i.test(key) && /[\\/]|\.(png|jpe?g|webp|bmp|gif)$/i.test(value));
}
function category(file) {
  const ext = path.extname(file).toLowerCase();
  if (['.mp4', '.mov', '.mkv', '.avi', '.webm', '.mxf'].includes(ext)) return 'Videos';
  if (['.mp3', '.wav', '.aac', '.m4a', '.flac', '.ogg'].includes(ext)) return 'Audios';
  if (['.png', '.jpg', '.jpeg', '.webp', '.bmp', '.gif', '.svg'].includes(ext)) return 'Imagens';
  return 'Outros';
}
async function readDocument(file) {
  const stat = await fsp.stat(file);
  if (!/\.(json|bak|tmp)$/i.test(file) || stat.size === 0) return null;
  if (stat.size > MAX_JSON) throw Error('Document exceeds the 32 MB limit: ' + file);
  const text = await fsp.readFile(file, 'utf8');
  if (!/^\s*[\[{]/.test(text.replace(/^\uFEFF/, ''))) {
    if (/\.json$/i.test(file)) throw Error('Unrecognized JSON: ' + file);
    return null;
  }
  return { text, tree: parseDocument(text, file) };
}
async function planProject(source, options = {}) {
  options.onProgress?.({ phase: 'scan', message: 'Scanning project files…' });
  source = path.resolve(source);
  if (!(await fsp.stat(path.join(source, 'draft_content.json'))).isFile()) throw Error('Folder is missing draft_content.json');
  // Regenerate our guide on recollection instead of nesting an outdated copy.
  const originalFiles = (await walkFiles(source)).filter(file => {
    const relative = path.relative(source, file).toLowerCase();
    return relative !== MANUAL_FILE.toLowerCase() && relative !== 'collect-manifest.json' && !/^collect-import-report(?:\.source)?\.json$/.test(relative);
  });
  const entries = new Map();
  const documents = new Map();
  const references = [];
  const metadata = [];
  let scannedFiles = 0;
  for (const file of originalFiles) {
    options.onProgress?.({ phase: 'scan', message: 'Checking project files and hashes…', file: path.basename(file), completed: scannedFiles++, fileTotal: originalFiles.length });
    const name = archivePath('Project/' + path.relative(source, file).split(path.sep).join('/'));
    entries.set(name, { source: file, sha256: await hashFile(file), size: (await fsp.stat(file)).size });
    const doc = await readDocument(file);
    if (doc) documents.set(name, doc);
  }
  const resourceDirectories = [];
  const protectedPaths = new Set([...documents.keys()].map(name => entries.get(name).source.toLowerCase()));
  for (const [, doc] of documents) for (const leaf of stringLeaves(doc.tree)) {
    if (!pathField(leaf.parts, leaf.value)) continue;
    try {
      const resolved = resolveDraftPath(source, leaf.value);
      if (String(leaf.parts.at(-1)).toLowerCase() === 'draft_cover') protectedPaths.add(resolved.toLowerCase());
      if (fs.existsSync(resolved) && (await fsp.stat(resolved)).isDirectory()) resourceDirectories.push(resolved);
    } catch {}
  }
  const activePaths = new Set();
  for (const [name, doc] of documents) {
    if (!/(^|\/)draft_content\.json$/i.test(name)) continue;
    for (const leaf of stringLeaves(doc.tree)) if (pathField(leaf.parts, leaf.value)) {
      try { const resolved = resolveDraftPath(source, leaf.value); if (fs.existsSync(resolved)) activePaths.add(resolved.toLowerCase()); } catch {}
    }
  }
  const adjustments = [];
  const clearedPaths = [];
  const external = new Map();
  for (const [name, doc] of documents) {
    for (const leaf of stringLeaves(doc.tree)) {
      const key = String(leaf.parts.at(-1));
      if (leaf.parts.length === 1 && ['draft_fold_path', 'draft_root_path'].includes(key)) {
        metadata.push({ file: name, parts: leaf.parts, original: leaf.value, portable: key === 'draft_fold_path' ? '.' : '..', kind: key });
        continue;
      }
      if (!pathField(leaf.parts, leaf.value)) continue;
      options.onProgress?.({ phase: 'resolve', message: 'Locating media and checking dependencies…', file: path.basename(leaf.value) });
      if (/^(https?:|data:|qrc:|file:)/i.test(leaf.value)) throw Error('Non-local resource is not supported yet: ' + name + ' ' + key);
      let resolved = resolveDraftPath(source, leaf.value);
      if (!fs.existsSync(resolved) && !path.isAbsolute(leaf.value)) resolved = path.resolve(path.dirname(entries.get(name).source), leaf.value);
      if (!fs.existsSync(resolved)) {
        const parent = json.findNodeAtLocation(doc.tree, leaf.parts.slice(0, -1));
        const flag = parent && json.findNodeAtLocation(parent, ['flag']);
        if (leaf.parts.at(-2) === 'matting' && key === 'path' && flag?.type === 'number' && flag.value === 0) {
          clearedPaths.push({ file: name, parts: leaf.parts, before: leaf.value, after: '' });
          adjustments.push({ kind: 'disabled-matting', file: name, parts: leaf.parts, original: leaf.value, replacement: '', reason: 'Matting disabled (flag 0), cache missing; cleared only in the copy.' });
          continue;
        }
        // Patch snapshots may still name the parent draft of a duplicated project.
        // Require the exact relative path AND a reference in a current draft, never basename matching.
        if (/\/attachment\/patch\/mini_draft\.json$/i.test(name)) {
          const suffix = leaf.value.replace(/\\/g, '/').match(/\/com\.lveditor\.draft\/[^/]+\/(.+)$/i)?.[1];
          if (suffix) {
            const candidate = path.resolve(source, suffix);
            if (inside(source, candidate) && activePaths.has(candidate.toLowerCase()) && fs.existsSync(candidate)) {
              resolved = candidate;
              adjustments.push({ kind: 'relocated-patch-resource', file: name, parts: leaf.parts, original: leaf.value, replacement: path.relative(source, candidate).split(path.sep).join('/'), reason: 'Exact internal path exists and is referenced in the current draft.' });
            }
          }
        }
      }
      await assertNoLinks(resolved).catch(() => { throw Error('Required dependency missing or unsupported link: ' + leaf.value + ' in ' + name); });
      const stat = await fsp.stat(resolved);
      let target;
      const mediaFile = stat.isFile() && /\.(mp4|mov|mkv|avi|webm|mxf|mp3|wav|aac|m4a|flac|ogg|png|jpe?g|webp|bmp|gif|svg)$/i.test(resolved);
      const nativeResource = resolved.replace(/\\/g, '/').match(/(?:^|\/)(Resources\/audioAlg(?:\/.*)?)$/i)?.[1];
      const generatedInternal = inside(source, resolved) && /^Resources\//i.test(path.relative(source, resolved).split(path.sep).join('/'));
      const protectedFile = generatedInternal || protectedPaths.has(resolved.toLowerCase()) || resourceDirectories.some(dir => inside(dir, resolved));
      if (inside(source, resolved) && (!mediaFile || protectedFile)) target = 'Project/' + path.relative(source, resolved).split(path.sep).join('/');
      else {
        if (!external.has(resolved)) {
          const prefix = digest(resolved).slice(0, 16) + '-' + safeName(path.basename(resolved));
          // File dependencies are flat. Resource directories keep their structure inside the project.
          const destination = nativeResource ? 'Project/' + nativeResource : stat.isDirectory() ? 'Project/CollectResources/' + prefix : 'Assets/' + prefix;
          external.set(resolved, destination);
          const mediaFiles = stat.isDirectory() ? await walkFiles(resolved) : [resolved];
          if (!mediaFiles.length) throw Error('Empty resource directory: ' + resolved);
          for (const media of mediaFiles) {
            const entryName = archivePath(destination + (stat.isDirectory() ? '/' + path.relative(resolved, media).split(path.sep).join('/') : ''));
            const mediaHash = await hashFile(media);
            const existing = [...entries].find(([name]) => name.toLowerCase() === entryName.toLowerCase());
            if (existing && existing[1].sha256 !== mediaHash) throw Error('Native resource collision; renaming is unsafe: ' + entryName);
            entries.set(entryName, { source: media, sha256: mediaHash, size: (await fsp.stat(media)).size });
          }
          if (inside(source, resolved) && stat.isFile()) entries.delete('Project/' + path.relative(source, resolved).split(path.sep).join('/'));
        }
        target = external.get(resolved);
      }
      archivePath(target);
      references.push({ file: name, parts: leaf.parts, original: leaf.value, target, portable: path.posix.relative('Project', target), directory: stat.isDirectory() });
    }
  }
  // Detect Windows case collisions before ZIP creation, including when running on another OS.
  const cases = new Set();
  for (const name of entries.keys()) {
    if (cases.has(name.toLowerCase())) throw Error('Package name collision: ' + name);
    cases.add(name.toLowerCase());
  }
  const exportedTime = Date.now() * 1000;
  for (const [name, doc] of documents) {
    const updates = [...references, ...metadata].filter(r => r.file === name).map(r => ({ parts: r.parts, before: r.original, after: r.portable }));
    if (name === 'Project/draft_meta_info.json') for (const field of ['tm_draft_create', 'tm_draft_modified']) {
      const date = json.findNodeAtLocation(doc.tree, [field]);
      if (date?.type === 'number') {
        updates.push({ parts: [field], before: date.value, after: exportedTime });
        adjustments.push({ kind: 'export-date', file: name, parts: [field], original: date.value, replacement: exportedTime });
      }
    }
    updates.push(...clearedPaths.filter(r => r.file === name).map(({ parts, before, after }) => ({ parts, before, after })));
    if (updates.length) {
      const entry = entries.get(name);
      entry.originalSha256 = entry.sha256;
      entry.buffer = Buffer.from(rewrite(doc.text, updates, name));
      entry.sha256 = digest(entry.buffer);
      entry.size = entry.buffer.length;
    }
  }
  let projectName = path.basename(source);
  try { const meta = JSON.parse(await fsp.readFile(path.join(source, 'draft_meta_info.json'), 'utf8')); projectName = meta.draft_name || projectName; } catch {}
  const manifest = { format: 'capcut-collect', version: 1, createdAt: new Date().toISOString(), projectName, draft: 'Project', projectFolder: safeName(path.basename(source)) + '_project', references, metadata, collectionAdjustments: adjustments };
  const manual = Buffer.from(createManualInstructions(manifest), 'utf8');
  entries.set(MANUAL_FILE, { buffer: manual, sha256: digest(manual), size: manual.length });
  manifest.files = [...entries].map(([name, entry]) => ({ path: name, size: entry.size, sha256: entry.sha256 }));
  return { source, entries, manifest };
}
function physicalManifest(manifest) {
  const result = structuredClone(manifest); result.version = 3; result.draft = manifest.projectFolder;
  for (const record of result.files) record.path = packagePath(record.path, result.draft);
  for (const ref of [...result.references, ...result.metadata]) { ref.file = packagePath(ref.file, result.draft); if (ref.target) ref.target = packagePath(ref.target, result.draft); }
  return result;
}
function canonicalManifest(manifest) {
  if (!manifest || !((manifest.version === 2 && manifest.draft === 'Capcut Project') || (manifest.version === 3 && typeof manifest.draft === 'string' && /^[^/\\]+_project$/.test(manifest.draft)))) return manifest;
  archivePath(manifest.draft);
  manifest.projectFolder = manifest.draft;
  manifest.version = 1; manifest.draft = 'Project';
  for (const record of manifest.files || []) record.path = internalPath(record.path);
  for (const ref of [...(manifest.references || []), ...(manifest.metadata || [])]) { ref.file = internalPath(ref.file); if (ref.target) ref.target = internalPath(ref.target); }
  return manifest;
}
async function exportProject(source, outputFile, options = {}) {
  if (options.format === 'folder') return exportFolder(source, outputFile, options);
  source = path.resolve(source); outputFile = path.resolve(outputFile);
  if (!outputFile.toLowerCase().endsWith('.zip')) throw Error('Use the .zip extension');
  if (inside(source, outputFile)) throw Error('The package must be outside the original draft');
  await assertNoLinks(path.dirname(outputFile));
  if (fs.existsSync(outputFile)) throw Error('The destination package already exists');
  const plan = await planProject(source, options);
  const temporary = outputFile + '.partial-' + crypto.randomUUID();
  try {
    options.onProgress?.({ phase: 'compress', message: 'Writing ZIP archive…' });
    const zip = new yazl.ZipFile();
    zip.on('error', error => zip.outputStream.destroy(error));
    const output = fs.createWriteStream(temporary, { flags: 'wx' });
    const completion = pipeline(zip.outputStream, output);
    zip.addBuffer(Buffer.from(JSON.stringify(physicalManifest(plan.manifest), null, 2)), packagePath('collect-manifest.json', plan.manifest.projectFolder));
    zip.addEmptyDirectory('Assets');
    for (const [name, entry] of plan.entries) {
      if (entry.buffer) zip.addBuffer(entry.buffer, packagePath(name, plan.manifest.projectFolder));
      else zip.addFile(entry.source, packagePath(name, plan.manifest.projectFolder), { compress: !/^Assets\//.test(name) });
    }
    zip.end();
    await completion;
    options.onProgress?.({ phase: 'verify', message: 'Verifying source files…' });
    for (const entry of plan.entries.values()) if (entry.source && await hashFile(entry.source) !== (entry.originalSha256 || entry.sha256)) throw Error('Source changed during export: ' + entry.source);
    // COPYFILE_EXCL refuses overwrite without requiring hard-link privileges.
    options.onProgress?.({ phase: 'finish', message: 'Finalizing ZIP and checking its hash…' });
    await fsp.copyFile(temporary, outputFile, fs.constants.COPYFILE_EXCL);
    await fsp.unlink(temporary);
    return { package: outputFile, files: plan.entries.size, references: plan.manifest.references.length, sha256: await hashFile(outputFile), name: plan.manifest.projectName, adjustments: plan.manifest.collectionAdjustments };
  } catch (error) { await fsp.rm(temporary, { force: true }); throw error; }
}
async function exportFolder(source, destination, options = {}) {
  source = path.resolve(source); destination = path.resolve(destination);
  if (inside(source, destination)) throw Error('The package must be outside the original draft');
  await assertNoLinks(path.dirname(destination));
  if (fs.existsSync(destination)) throw Error('The destination package already exists');
  const plan = await planProject(source, options);
  const stage = destination + '.partial-' + crypto.randomUUID();
  try {
    await fsp.mkdir(path.join(stage, 'Assets'), { recursive: true });
    await fsp.mkdir(path.join(stage, plan.manifest.projectFolder));
    let copied = 0;
    for (const [name, entry] of plan.entries) {
      options.onProgress?.({ phase: 'copy', message: 'Copying files and verifying hashes…', file: path.basename(name), completed: copied++, fileTotal: plan.entries.size });
      const target = path.join(stage, packagePath(name, plan.manifest.projectFolder));
      await fsp.mkdir(path.dirname(target), { recursive: true });
      if (entry.buffer) await fsp.writeFile(target, entry.buffer, { flag: 'wx' });
      else await fsp.copyFile(entry.source, target, fs.constants.COPYFILE_EXCL);
      if (await hashFile(target) !== entry.sha256) throw Error('Integrity check failed: ' + name);
    }
    for (const entry of plan.entries.values()) if (entry.source && await hashFile(entry.source) !== (entry.originalSha256 || entry.sha256)) throw Error('Source changed during export');
    await fsp.writeFile(path.join(stage, packagePath('collect-manifest.json', plan.manifest.projectFolder)), JSON.stringify(physicalManifest(plan.manifest), null, 2));
    if (fs.existsSync(destination)) throw Error('The destination already exists');
    options.onProgress?.({ phase: 'finish', message: 'Finalizing project…' });
    await fsp.rename(stage, destination);
    return { package: destination, format: 'folder', files: plan.entries.size, references: plan.manifest.references.length, name: plan.manifest.projectName, adjustments: plan.manifest.collectionAdjustments };
  } catch (error) { await fsp.rm(stage, { recursive: true, force: true }); throw error; }
}
function openZip(file) { return new Promise((resolve, reject) => yauzl.open(file, { lazyEntries: true, strictFileNames: true, validateEntrySizes: true }, (err, zip) => err ? reject(err) : resolve(zip))); }
function openEntry(zip, entry) { if (entry.source) return Promise.resolve(fs.createReadStream(entry.source)); return new Promise((resolve, reject) => zip.openReadStream(entry, (err, stream) => err ? reject(err) : resolve(stream))); }
async function visitZip(file, visitor) {
  if ((await fsp.stat(file)).isDirectory()) {
    for (const source of await walkFiles(file)) {
      const name = archivePath(path.relative(file, source).split(path.sep).join('/'));
      await visitor(null, { source, uncompressedSize: (await fsp.stat(source)).size }, internalPath(name) === 'Project/collect-manifest.json' ? 'collect-manifest.json' : internalPath(name));
    }
    return;
  }
  const zip = await openZip(file);
  let count = 0; let total = 0; const names = new Set();
  try {
    await new Promise((resolve, reject) => {
      zip.on('error', reject); zip.on('end', resolve);
      zip.on('entry', entry => {
        (async () => {
          if (++count > 200000 || (total += entry.uncompressedSize) > 500 * 1024 ** 3) throw Error('Package exceeds extraction limits');
          if (entry.fileName.endsWith('/')) { if (!['Assets/', 'Capcut Project/'].includes(entry.fileName) && !/^[^/]+_project\/$/.test(entry.fileName)) throw Error('Unexpected ZIP directory'); zip.readEntry(); return; }
          const physical = archivePath(entry.fileName);
          const canonical = internalPath(physical);
          const name = canonical === 'Project/collect-manifest.json' ? 'collect-manifest.json' : canonical;
          if (names.has(name.toLowerCase())) throw Error('Duplicate entry: ' + name);
          names.add(name.toLowerCase());
          const unixType = (entry.externalFileAttributes >>> 16) & 0xf000;
          if (unixType && unixType !== 0x8000) throw Error('Non-regular ZIP entry: ' + name);
          await visitor(zip, entry, name);
          zip.readEntry();
        })().catch(reject);
      });
      zip.readEntry();
    });
  } finally { zip.close(); }
}
async function readManifest(file) {
  let manifest;
  await visitZip(file, async (zip, entry, name) => {
    if (name !== 'collect-manifest.json') return;
    if (entry.uncompressedSize > MAX_JSON) throw Error('Manifest exceeds the size limit');
    const stream = await openEntry(zip, entry); const chunks = []; let bytes = 0;
    for await (const chunk of stream) { bytes += chunk.length; if (bytes > MAX_JSON) throw Error('Manifest exceeds the size limit'); chunks.push(chunk); }
    manifest = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  });
  manifest = canonicalManifest(manifest);
  validateManifest(manifest);
  return manifest;
}
function validateManifest(m) {
  if (!m || m.format !== 'capcut-collect' || m.version !== 1 || m.draft !== 'Project' || typeof m.projectName !== 'string' || !Array.isArray(m.files) || !Array.isArray(m.references) || !Array.isArray(m.metadata)) throw Error('Incompatible manifest');
  const names = new Set(); const folded = new Set();
  for (const file of m.files) {
    archivePath(file.path);
    if ((!/^(Project|Assets)\//.test(file.path) && file.path !== MANUAL_FILE) || !/^[a-f0-9]{64}$/.test(file.sha256) || !Number.isSafeInteger(file.size) || file.size < 0 || names.has(file.path) || folded.has(file.path.toLowerCase())) throw Error('Invalid manifest file');
    names.add(file.path); folded.add(file.path.toLowerCase());
  }
  if (!names.has('Project/draft_content.json')) throw Error('Package is missing draft_content.json');
  const fields = new Set();
  for (const ref of [...m.references, ...m.metadata]) {
    if (!names.has(ref.file) || !ref.file.startsWith('Project/') || !Array.isArray(ref.parts) || !ref.parts.length || ref.parts.some(p => !(typeof p === 'string' || (Number.isSafeInteger(p) && p >= 0))) || typeof ref.portable !== 'string') throw Error('Invalid reference');
    const key = JSON.stringify([ref.file, ref.parts]); if (fields.has(key)) throw Error('Duplicate field'); fields.add(key);
  }
  for (const ref of m.references) {
    archivePath(ref.target);
    if (ref.portable !== path.posix.relative('Project', ref.target) || typeof ref.directory !== 'boolean' || (!ref.directory && !names.has(ref.target)) || (ref.directory && ![...names].some(n => n.startsWith(ref.target + '/'))) || !pathField(ref.parts, ref.portable)) throw Error('Invalid reference target');
  }
  for (const ref of m.metadata) if (ref.parts.length !== 1 || !['draft_fold_path', 'draft_root_path'].includes(ref.kind) || ref.parts[0] !== ref.kind || ref.portable !== (ref.kind === 'draft_fold_path' ? '.' : '..')) throw Error('Invalid location metadata');
}
async function importPackage(packageFile, destination, options = {}) {
  const libraryMode = options.layout === 'library';
  packageFile = path.resolve(packageFile); destination = path.resolve(destination);
  const directoryPackage = (await fsp.stat(packageFile)).isDirectory();
  if (!directoryPackage && !/\.(zip|capcollect)$/i.test(packageFile)) throw Error('Select a .zip package');
  await assertNoLinks(packageFile); await assertNoLinks(path.dirname(destination));
  if (fs.existsSync(destination)) throw Error('The destination directory already exists; choose a new folder');
  options.onProgress?.({ phase: 'validate', message: 'Reading collection and verifying its integrity…' });
  const packageHash = directoryPackage ? null : await hashFile(packageFile);
  const manifest = await readManifest(packageFile);
  const nativeTargets = new Map();
  for (const ref of manifest.references) {
    if (ref.directory || typeof ref.original !== 'string') continue;
    const suffix = ref.original.replace(/\\/g, '/').match(/(?:^|\/)Resources\/audioAlg\/(.+)$/i)?.[1];
    if (!suffix || !ref.target.startsWith('Assets/')) continue;
    const restored = archivePath('Project/Resources/audioAlg/' + suffix);
    if (nativeTargets.has(ref.target) && nativeTargets.get(ref.target) !== restored) throw Error('Conflicting native references in package');
    nativeTargets.set(ref.target, restored);
  }
  const mappedPath = name => {
    name = nativeTargets.get(name) || name;
    if (!libraryMode || !name.startsWith('Project/')) return name;
    const relative = name.slice(8);
    return relative.toLowerCase() === 'collect-import-report.json' ? 'collect-import-report.source.json' : relative;
  };
  const mappedNames = new Set();
  for (const record of manifest.files) {
    const mapped = mappedPath(record.path);
    archivePath(mapped);
    if (mappedNames.has(mapped.toLowerCase()) || (libraryMode && mapped.toLowerCase() === 'collect-import-report.json')) throw Error('Collision in library layout: ' + mapped);
    mappedNames.add(mapped.toLowerCase());
  }
  const expected = new Map(manifest.files.map(f => [f.path, f]));
  const stage = path.join(path.dirname(destination), '.collect-stage-' + crypto.randomUUID());
  await fsp.mkdir(stage);
  const modifications = [];
  try {
    let extracted = 0;
    await visitZip(packageFile, async (zip, entry, name) => {
      if (name === 'collect-manifest.json') return;
      options.onProgress?.({ phase: 'extract', message: 'Extracting files and verifying hashes…', file: path.basename(name), completed: extracted++, fileTotal: manifest.files.length });
      const record = expected.get(name); if (!record || record.size !== entry.uncompressedSize) throw Error('Undeclared file or size mismatch: ' + name);
      const file = path.join(stage, mappedPath(name)); if (!inside(stage, file)) throw Error('Target is outside the extraction directory');
      await fsp.mkdir(path.dirname(file), { recursive: true });
      const hash = crypto.createHash('sha256'); let size = 0;
      const meter = new Transform({ transform(chunk, encoding, callback) { hash.update(chunk); size += chunk.length; callback(null, chunk); } });
      await pipeline(await openEntry(zip, entry), meter, fs.createWriteStream(file, { flags: 'wx' }));
      if (size !== record.size || hash.digest('hex') !== record.sha256) throw Error('Integrity check failed: ' + name);
      expected.delete(name);
    });
    if (expected.size) throw Error('Incomplete package: ' + [...expected.keys()].join(', '));
    if (!directoryPackage && await hashFile(packageFile) !== packageHash) throw Error('Package changed during import');
    options.onProgress?.({ phase: 'relink', message: 'Updating media paths and timeline references…' });
    const grouped = new Map();
    for (const ref of [...manifest.references, ...manifest.metadata]) {
      const after = (ref.target ? path.join(destination, mappedPath(ref.target)) : ref.kind === 'draft_fold_path' ? (libraryMode ? destination : path.join(destination, 'Project')) : (libraryMode ? path.dirname(destination) : destination)).split(path.sep).join('/');
      const update = { file: ref.file, parts: ref.parts, before: ref.portable, after };
      if (!grouped.has(ref.file)) grouped.set(ref.file, []);
      grouped.get(ref.file).push(update); modifications.push(update);
    }
    let projectIdentity;
    if (libraryMode) {
      const metaFile = 'Project/draft_meta_info.json';
      const metaText = await fsp.readFile(path.join(stage, 'draft_meta_info.json'), 'utf8');
      const tree = parseDocument(metaText, metaFile);
      const id = json.findNodeAtLocation(tree, ['draft_id']);
      if (!id || id.type !== 'string' || !id.value) throw Error('Library import requires draft_id in metadata');
      const newId = crypto.randomUUID().toUpperCase();
      projectIdentity = { before: id.value, after: newId };
      const updates = [{ file: metaFile, parts: ['draft_id'], before: id.value, after: newId }];
      const name = json.findNodeAtLocation(tree, ['draft_name']);
      if (name?.type === 'string') updates.push({ file: metaFile, parts: ['draft_name'], before: name.value, after: manifest.projectName + ' (Collect)' });
      const importedTime = Date.now() * 1000; // CapCut stores draft dates in microseconds.
      for (const field of ['tm_draft_create', 'tm_draft_modified']) {
        const date = json.findNodeAtLocation(tree, [field]);
        if (date?.type === 'number') updates.push({ file: metaFile, parts: [field], before: date.value, after: importedTime });
      }
      if (!grouped.has(metaFile)) grouped.set(metaFile, []);
      grouped.get(metaFile).push(...updates); modifications.push(...updates);
    }
    for (const record of manifest.files) {
      const file = path.join(stage, mappedPath(record.path));
      const doc = await readDocument(file);
      if (grouped.has(record.path)) {
        if (!doc) throw Error('Reference in a non-JSON file');
        await fsp.writeFile(file, rewrite(doc.text, grouped.get(record.path), record.path));
      }
    }
    options.onProgress?.({ phase: 'verify', message: 'Checking all referenced files…' });
    for (const ref of manifest.references) {
      const stat = await fsp.stat(path.join(stage, mappedPath(ref.target)));
      if (ref.directory ? !stat.isDirectory() : !stat.isFile()) throw Error('Reference has no target: ' + ref.target);
    }
    const report = { format: 'capcut-collect-import-report', version: 1, importedAt: new Date().toISOString(), package: packageFile, packageSha256: packageHash, destination, draft: libraryMode ? destination : path.join(destination, 'Project'), layout: libraryMode ? 'library' : 'isolated', files: manifest.files.length, references: manifest.references.length, modifications, idsPreserved: !libraryMode, internalIdsPreserved: true, projectIdentity, globalIndexModified: false, collectionAdjustments: manifest.collectionAdjustments || [], nativeResourceRepairs: [...nativeTargets].map(([from, to]) => ({ from, to: mappedPath(from) })) };
    await fsp.writeFile(path.join(stage, 'collect-import-report.json'), JSON.stringify(report, null, 2));
    if (fs.existsSync(destination)) throw Error('Destination was created during import');
    options.onProgress?.({ phase: 'finish', message: 'Finalizing imported project…' });
    await fsp.rename(stage, destination);
    return report;
  } catch (error) { if (inside(path.dirname(destination), stage) && path.basename(stage).startsWith('.collect-stage-')) await fsp.rm(stage, { recursive: true, force: true }); throw error; }
}
async function discoverProjects(root) {
  const results = [];
  for (const entry of await fsp.readdir(root, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.isSymbolicLink() || entry.name.startsWith('.')) continue;
    const folder = path.join(root, entry.name);
    if (!fs.existsSync(path.join(folder, 'draft_content.json'))) continue;
    let modifiedAt = (await fsp.stat(path.join(folder, 'draft_content.json'))).mtimeMs;
    try {
      const meta = JSON.parse((await fsp.readFile(path.join(folder, 'draft_meta_info.json'), 'utf8')).replace(/^\uFEFF/, ''));
      const timestamp = meta.tm_draft_modified || meta.tm_draft_create;
      if (typeof timestamp === 'number' && Number.isFinite(timestamp) && timestamp > 0) modifiedAt = timestamp / 1000;
    } catch {}
    results.push({ id: digest(folder).slice(0, 24), name: entry.name, path: folder, modifiedAt });
  }
  return results.sort((a, b) => b.modifiedAt - a.modifiedAt || a.name.localeCompare(b.name));
}
module.exports = { exportProject, importPackage, planProject, discoverProjects, hashFile, archivePath, validateManifest, readManifest, rewrite, parseDocument, stringLeaves, inside, safeName, resolveDraftPath };
