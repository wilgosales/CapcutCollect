'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const yazl = require('yazl');
const { pipeline } = require('node:stream/promises');
const { createWriteStream } = require('node:fs');
const root = path.resolve(__dirname, '..');
const files = ['package.json','package-lock.json','README.md','LICENSE','THIRD_PARTY_NOTICES.md','RELEASE_NOTES.md','CONTRIBUTING.md','SECURITY.md','.gitignore','.gitattributes','Iniciar-CapCut-Collect.cmd','Iniciar-CapCut-Collect.ps1','assets/icon.png','assets/icon.ico','scripts/build-win.cjs','scripts/make-icon.ps1','scripts/prepare-github.cjs'];
const directories = ['src','desktop','ui','tests','docs','.github','third-party-licenses'];
async function hash(file) { const digest = crypto.createHash('sha256'); for await (const data of require('node:fs').createReadStream(file)) digest.update(data); return digest.digest('hex'); }
async function walk(dir) {
 const result=[];
 for(const entry of await fs.readdir(dir,{withFileTypes:true})) { const file=path.join(dir,entry.name); if(entry.isSymbolicLink())throw Error('Links are not allowed in the release snapshot'); if(entry.isDirectory())result.push(...await walk(file)); else if(entry.isFile())result.push(file); }
 return result.sort();
}
async function main() {
 const pkg=JSON.parse(await fs.readFile(path.join(root,'package.json'),'utf8'));
 if(pkg.license!=='MIT')throw Error('Expected the selected MIT license');
 const base=path.join(root,'github-ready');const repository=path.join(base,'repository');const release=path.join(base,'release','v'+pkg.version);
 if(require('node:fs').existsSync(repository)||require('node:fs').existsSync(release))throw Error('github-ready output already exists. Preserve or move it before preparing another snapshot.');
 const installerName='CapCut-Collect-Setup-'+pkg.version+'-win-x64.exe';
 const installer=path.join(root,'dist','v'+pkg.version,installerName);await fs.access(installer);
 const selected=[...files];for(const directory of directories)for(const file of await walk(path.join(root,directory)))selected.push(path.relative(root,file).split(path.sep).join('/'));
 const unique=[...new Set(selected)].sort();let bytes=0;
 for(const relative of unique) {
  const source=path.join(root,relative);const stat=await fs.lstat(source);if(!stat.isFile()||stat.isSymbolicLink())throw Error('Non-regular source file: '+relative);bytes+=stat.size;
  if(/\.(?:cjs|js|qml|html|md|json|ya?ml|ps1|cmd)$/.test(relative)) {
   const text=await fs.readFile(source,'utf8');
   if(/[A-Za-z]:[\\/]Users[\\/][^\\/\s]+/i.test(text))throw Error('Personal absolute path in public source: '+relative);
   if(/gh[pousr]_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{32,}/.test(text))throw Error('Possible credential in public source: '+relative);
  }
 }
 if(bytes>25*1024*1024)throw Error('Source snapshot is unexpectedly large; inspect the allowlist');
 await fs.mkdir(repository,{recursive:true});await fs.mkdir(release,{recursive:true});
 for(const relative of unique){const target=path.join(repository,relative);await fs.mkdir(path.dirname(target),{recursive:true});await fs.copyFile(path.join(root,relative),target,require('node:fs').constants.COPYFILE_EXCL);}
 const checks=unique.map(relative=>({file:relative}));
 for(const record of checks)record.sha256=await hash(path.join(repository,record.file));
 await fs.writeFile(path.join(release,'SOURCE_MANIFEST.json'),JSON.stringify({version:pkg.version,files:checks},null,2)+'\n');
 const sourceName='CapCut-Collect-'+pkg.version+'-source.zip';const zip=new yazl.ZipFile();const done=pipeline(zip.outputStream,createWriteStream(path.join(release,sourceName),{flags:'wx'}));
 for(const relative of unique)zip.addFile(path.join(repository,relative),'capcut-collect/'+relative);zip.end();await done;
 await fs.copyFile(installer,path.join(release,installerName),require('node:fs').constants.COPYFILE_EXCL);
 for(const file of ['RELEASE_NOTES.md','THIRD_PARTY_NOTICES.md','LICENSE'])await fs.copyFile(path.join(root,file),path.join(release,file));
 const validation=path.join(root,'dist','v'+pkg.version,'VALIDATION.md');if(require('node:fs').existsSync(validation))await fs.copyFile(validation,path.join(release,'VALIDATION.md'));
 const releaseFiles=(await fs.readdir(release)).filter(file=>file!=='SHA256SUMS.txt').sort();
 const sums=[];for(const file of releaseFiles)sums.push(await hash(path.join(release,file))+'  '+file);
 await fs.writeFile(path.join(release,'SHA256SUMS.txt'),sums.join('\n')+'\n');
 console.log(JSON.stringify({version:pkg.version,repository,release,sourceFiles:unique.length,sourceBytes:bytes,releaseFiles:[...releaseFiles,'SHA256SUMS.txt']},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
