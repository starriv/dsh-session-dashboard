# Contributing

## Development

Requires Node.js >= 22.15 and npm.

```bash
npm ci
npm run build
npm test
```

`npm test` runs `pretest` first, which rebuilds `client.js` before executing the
Node test suites. Commit the rebuilt `client.js` together with its source changes;
CI verifies that the committed artifact is reproducible.

The plugin is installed from a local checkout with:

```text
plugin_manager install_bundle -> /absolute/path/to/dsh-session-dashboard
```

Path/link installs are development-only and do not receive DSH registry update badges.

## Pull requests

- Keep the Host/client boundary: Host owns reads and aggregation; client owns
  presentation and local view state.
- Add a regression test for any bug fix, especially around auth, zstd decoding,
  usage folding, scope windows and range switching.
- Run `npm test`, `npm pack --dry-run`, and a light/dark screenshot check before
  opening a PR.
- Do not add dependencies without updating `package-lock.json`,
  `THIRD_PARTY_NOTICES.md` and the bundle size/contract checks.
