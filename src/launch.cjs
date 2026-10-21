'use strict';
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const path = require('node:path');
const { startServer } = require('./server.cjs');
const { integrate } = require('./integrate.cjs');
async function main() {
  const query = "@(Get-CimInstance Win32_Process -Filter \"Name='CapCut.exe'\" | Where-Object { $_.CommandLine -and $_.CommandLine -notmatch '--type=' } | ForEach-Object { $_.ProcessId }) | ConvertTo-Json -Compress";
  const { stdout } = await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', query], { windowsHide: true });
  const parsed = stdout.trim() ? JSON.parse(stdout) : [];
  const pids = Array.isArray(parsed) ? parsed : [parsed];
  if (pids.length !== 1) throw Error('Open one CapCut instance and leave the home screen visible.');
  const workspace = path.resolve(__dirname, '..');
  const draftRoot = process.env.CAPCUT_DRAFT_ROOT || path.join(process.env.USERPROFILE, 'AppData', 'Local', 'CapCut', 'User Data', 'Projects', 'com.lveditor.draft');
  const backend = await startServer({ draftRoot, outputRoot: path.join(workspace, 'Colecoes'), importRoot: draftRoot });
  try { await integrate({ pid: pids[0], backend }); }
  catch (error) { await backend.close(); throw error; }
  const stop = () => backend.close();
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
  console.log('CapCut Collect connected. Use Close in the panel to stop.');
}
main().catch(error => { console.error('CapCut Collect: ' + error.message); process.exitCode = 1; });
