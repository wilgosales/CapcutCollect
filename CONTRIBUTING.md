# Contributing

Use Windows x64 and Node.js 24. Install dependencies with `npm ci`, run `npm test`, and launch with `npm run desktop`. The Windows CI workflow runs the same tests and builds an installer.

Use synthetic fixtures in tests. Do not commit real drafts, media, collected ZIPs, credentials, or local diagnostic reports. Keep structural/native-resource compatibility when updating path rewriting. Test both ZIP and folder round trips, including a missing dependency and native generated audio.

Submit a pull request with the observed problem, resulting behavior, and validation. Contributions to original project code are made under the MIT License; third-party components retain their licenses.
