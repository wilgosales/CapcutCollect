# Release preparation

## Local build

1. Use Windows x64 and Node.js 24. Run `npm ci` and `node node_modules/electron/install.js`.
2. Run `npm test` and review every failure or skipped check.
3. Run `npm run build:win`. It builds locally with `--publish never`; no signing credentials are required for this unsigned beta.
4. Run `npm run prepare:github` after the build. This creates a clean repository snapshot and release attachments under `github-ready/` using an explicit allowlist. Existing preparation output is preserved under `.local-backups/` before regeneration.
5. Test the packaged runtime and inspect the installer icon. Install, launch, import, playback, and uninstall on a separate Windows machine before treating the release as stable.

The builder may encounter a symlink privilege error while extracting its Windows-tool archive because that archive also contains macOS symlinks. On this workstation the Windows-only tool files were extracted into a workspace cache, without changing security settings. On another machine, a normal CI Windows runner can build the installer; do not disable Windows protections to work around packaging failures.

## Files to upload

Use `github-ready/release/v0.6.0-beta.1/` as release attachments, not `dist/win-unpacked` and not the entire development workspace. Attach the installer, clean source ZIP, checksums, release notes, validation report, and third-party notices/licenses. The supplied checksum manifest lists release files, excluding itself.

Use `github-ready/repository/` as the repository contents. It contains no Git history, account identity, real project, media, node_modules, build output, or private reports. Assets includes only the application icons.

## Publish manually

1. Create a GitHub repository under your own account/organization. No remote or account name is embedded in this project.
2. Upload the clean repository contents, including hidden `.github` and `.gitignore` files. Alternatively initialize Git inside the clean repository folder and add your own remote.
3. Create a draft release tagged `v0.6.0-beta.1`. Set it as a **pre-release**.
4. Paste RELEASE_NOTES.md into the release description and attach the release files.
5. Review the files and repository diff before publishing. The local scripts never publish, push, create remote repositories, or create releases.

The Windows GitHub Actions workflow can be started manually. It uploads build artifacts to the workflow run, with read-only repository permissions. Publishing a GitHub Release remains a separate manual step.

## Version changes

Update package.json, package-lock.json, the app badge, release notes, and documentation together. Rebuild and regenerate checksums; do not reuse an old checksum after modifying a binary.
