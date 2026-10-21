<p align="center"><img src="assets/icon.png" width="120" alt="CapCut Collect icon"></p>

# CapCut Collect

**Collect and move your CapCut Desktop projects with their media.**

Windows x64 beta · Free and open source · MIT

An independent community tool. Not affiliated with, endorsed by, or distributed by CapCut.

## Download and install

Open this repository's **Releases**, choose **v0.6.0-beta.1**, and download `CapCut-Collect-Setup-0.6.0-beta.1-win-x64.exe`.

Run the installer, then open **CapCut Collect** from the shortcut. Node.js is included; end users do not need to install development tools. This beta is unsigned, so Windows may show a publisher warning. Use `SHA256SUMS.txt` to verify the download.

**Windows only.** There is no supported macOS installer yet. The optional internal panel has been validated only on **CapCut 9.6.0.4097 / Qt 6.2.2**. Project format changes in other versions may require updates.

## Export

1. Save your project in CapCut before collecting it.
2. In **Export**, find your project by name or thumbnail. The list is ordered newest first.
3. Click **ZIP** or **Folder** on a project, or select multiple projects and use the batch buttons.
4. Choose the destination once. Each project gets a separate collection.

The centered task panel shows the real processing stage, project in the batch, file counts when available, and elapsed time. Failed projects are reported individually.

```text
Collection/
├── Original folder name_project/
│   ├── draft_content.json
│   ├── draft_meta_info.json
│   ├── collect-manifest.json
│   └── other project files and native resources
├── Assets/
│   └── media files directly in this folder
└── instruction import manual.txt
```

Ordinary media is collected into a flat Assets folder with unique names. Native CapCut resources, including generated audio in `Resources/audioAlg`, keep their original names and structure inside the project. Effects that rely on directories also retain their structure.

Only the exported copy is edited. Its existing creation/modification timestamps are updated. The manifest records file hashes, references, and adjustments. It can contain the sender's original file paths: review a collection before sharing it publicly.

## Import

1. Open **Import** and choose **ZIP** or **Folder**.
2. Collect verifies the files, creates a new project in your CapCut library, and updates media paths throughout the draft and timeline files.
3. Restart CapCut if the project list does not refresh, then check video and audio playback.

Existing projects are not overwritten. Imported copies receive a new project identity; internal material/segment IDs are preserved. Collect does not directly edit CapCut's global index or automatically open projects. Legacy `.capcollect` packages are accepted.

Recipients without Collect can follow the short text tutorial included in each collection. Manual discovery/relinking may vary by CapCut version; use Collect import if a project does not appear.

## Optional panel inside CapCut

Save and close projects and leave CapCut on its home screen. Expand **CapCut integration** in Collect and select **Enable CapCut panel**.

The experimental integration uses Frida to create a temporary QML panel in memory. It does not patch CapCut's executable files. The loader rejects unsupported CapCut/Qt versions. Native instrumentation can fail or crash the host, so the standalone app is the default workflow. The internal panel currently has a simpler layout than the standalone app.

## Build from source

Use Windows x64 and Node.js 24 LTS. Builds need internet access to fetch dependencies, Electron, and packaging tools.

```powershell
npm ci
node node_modules/electron/install.js
npm test
npm run desktop
npm run build:win
```

The Windows installer is written to `dist/v0.6.0-beta.1/`. `npm run build:win` never publishes a release and disables automatic signing identity discovery. To regenerate the Windows icon from the supplied PNG:

```powershell
powershell -NoProfile -File scripts/make-icon.ps1
```

See [release preparation](docs/RELEASING.md) for packaging and GitHub upload instructions. The GitHub Actions workflow tests and builds Windows artifacts; it does not publish a release.

## CLI

```powershell
node src/cli.cjs list
node src/cli.cjs export --project "C:\Projects\Draft" --output "D:\Collections\Project.zip"
node src/cli.cjs export --project "C:\Projects\Draft" --output "D:\Collections\Project" --format folder
node src/cli.cjs import --package "D:\Collections\Project.zip" --destination "D:\Imported\NewDraft" --layout library
```

The import destination must be new, with an existing parent. Without `--layout library`, CLI import uses an isolated layout. Use `CAPCUT_DRAFT_ROOT` to point to a different project library.

## Validation and limits

Tests cover ZIP/folder round trips, hashes, numeric precision, reference rewriting, native audio structure, legacy package recovery, timestamp updates, thumbnails, batch failures, and authenticated local HTTP. Symlink tests may be skipped when Windows does not grant the required privilege.

This is a beta, not a universal CapCut format implementation. Cloud assets, fonts, store effects, hidden dependencies, and future project versions need further validation. SHA-256 checks integrity, not authorship. Save and retain your source projects until you have verified playback in the destination.

The standalone collector works locally. Optional integration uses authenticated loopback HTTP. Collections and media are not sent to an external service by the app.

## License

Original CapCut Collect code is available under the [MIT License](LICENSE). Dependencies retain their own licenses; see [third-party notices](THIRD_PARTY_NOTICES.md). CapCut names and trademarks remain the property of their respective owners.
