'use strict';
const path = require('node:path');
const { exportProject, importPackage, discoverProjects } = require('./collect.cjs');
const { startServer } = require('./server.cjs');
const workspace = path.resolve(__dirname, '..');
function options(args) { const result = {}; for (let i = 0; i < args.length; i += 2) { if (!args[i].startsWith('--') || !args[i + 1]) throw Error('Use options in --name value format'); result[args[i].slice(2)] = args[i + 1]; } return result; }
async function main() {
  const [command, ...args] = process.argv.slice(2); const opts = options(args);
  const root = opts['draft-root'] || process.env.CAPCUT_DRAFT_ROOT || path.join(process.env.USERPROFILE || require('node:os').homedir(), 'AppData', 'Local', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft');
  if (command === 'list') return discoverProjects(root);
  if (command === 'export') { if (!opts.project || !opts.output) throw Error('Use export --project FOLDER --output FILE.zip'); return exportProject(opts.project, opts.output, { format: opts.format || 'zip' }); }
  if (command === 'import') { if (!opts.package || !opts.destination) throw Error('Use import --package FILE.zip --destination NEW_FOLDER'); return importPackage(opts.package, opts.destination, { layout: opts.layout || 'isolated' }); }
  if (command === 'serve' || command === 'integrate') {
    const backend = await startServer({ draftRoot: root, outputRoot: opts.output || path.join(workspace, 'Colecoes'), importRoot: opts.destination || root });
    async function stop() { await backend.close(); process.exitCode = 0; }
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
    if (command === 'integrate') {
      try { await require('./integrate.cjs').integrate({ pid: Number(opts.pid), backend }); }
      catch (error) { await backend.close(); throw error; }
    }
    console.log('CapCut Collect running at ' + backend.url + '. Close from the panel or press Ctrl+C.');
    if (command === 'serve') console.log('HTTP diagnostics: token ' + backend.token);
    return;
  }
  console.log('CapCut Collect\n  list [--draft-root FOLDER]\n  export --project FOLDER --output FILE.zip\n  import --package FILE.zip --destination NEW_FOLDER\n  integrate --pid PID [--draft-root FOLDER] [--output FOLDER] [--destination FOLDER]');
}
main().then(result => { if (result) console.log(JSON.stringify(result, null, 2)); }).catch(error => { console.error('CapCut Collect: ' + error.message); process.exitCode = 1; });
