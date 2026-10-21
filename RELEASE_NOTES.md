# v0.6.0-beta.1 — Windows beta

First GitHub-ready distribution of CapCut Collect for Windows x64.

## Included

- Export and Import tabs with thumbnails and project search.
- ZIP or uncompressed-folder export, including batch selection.
- Flat Assets folder for ordinary media, unique filenames, and preserved native resources.
- Project folder named after the source folder with `_project` appended.
- Updated timestamps on exported copies and imported projects.
- SHA-256 validation and media/timeline path updates on import.
- Recovery of generated audio paths from packages created by earlier versions.
- Centered task status with processing stages, batch position, and elapsed time.
- English interface and manual import tutorial.
- Application and installer icon supplied by the project maintainer.
- Optional experimental panel for CapCut 9.6.0.4097 / Qt 6.2.2.

## Downloads

- `CapCut-Collect-Setup-0.6.0-beta.1-win-x64.exe`: installer; Node.js included.
- `CapCut-Collect-0.6.0-beta.1-source.zip`: clean source snapshot.
- `SHA256SUMS.txt`: checksums for release files.

## Before testing

This is an unsigned Windows beta. There is no supported macOS build. Preserve your source projects and confirm both video and audio playback after importing. Save and close projects before enabling the experimental internal panel. Do not upload your media, drafts, or unredacted local file paths in public issue reports.

## Validation

Automated tests and runtime/icon checks are recorded in `VALIDATION.md`. Full playback on every CapCut version and machine has not been verified. The release does not include automatic updates.

Independent project; not affiliated with or endorsed by CapCut. Original code: MIT. Third-party licenses are included with the application.
