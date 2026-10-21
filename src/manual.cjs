'use strict';
const MANUAL_FILE = 'instruction import manual.txt';
function createManualInstructions(manifest) {
  const folder = String(manifest.projectFolder || 'Capcut Project').replace(/[\r\n]/g, ' ');
  return '\uFEFF' + `HOW TO OPEN THE PROJECT IN CAPCUT

1. If you received a ZIP, choose "Extract All" in Windows File Explorer.
On a Mac, double-click the ZIP in Finder to extract it.
If you received an uncompressed folder, open it directly.

2. Close CapCut and copy the entire "${folder}" folder into your CapCut project library.
On Windows, paste this address into File Explorer:
%LOCALAPPDATA%\\CapCut\\User Data\\Projects\\com.lveditor.draft
On a Mac, use the project library configured in your CapCut installation.
Do not replace an existing folder.

3. Open CapCut. It may detect the project automatically; restart it if the list does not refresh.
If CapCut asks you to relink media, select the files in the "Assets" folder included in this collection.
Some files and native CapCut resources remain inside "${folder}".
Keep both folders in a permanent location and do not move the files after relinking.

4. Check video and audio playback, then save the project.

If the project does not appear or conflicts with an existing copy, use Import in CapCut Collect to update paths and project identity automatically.
Manual discovery was tested on CapCut for Windows 9.6.0.4097; behavior on Mac and other versions may vary.
`.replace(/\r?\n/g, '\r\n');
}
module.exports = { MANUAL_FILE, createManualInstructions };
