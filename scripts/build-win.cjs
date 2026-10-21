'use strict';
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, [require.resolve('electron-builder/out/cli/cli.js'), '--win', 'nsis', '--x64', '--publish', 'never', ...process.argv.slice(2)], { cwd: path.resolve(__dirname, '..'), stdio: 'inherit', env: { ...process.env, CSC_IDENTITY_AUTO_DISCOVERY: 'false' }, windowsHide: true });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
