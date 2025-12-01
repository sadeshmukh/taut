# `core/main/`

The main process code, runs in the Electron main process before Slack starts.
Responsible for:

- Intercepting Electron APIs to inject the preload script and renderer code
  (plus other tweaks like enabling devtools and bypassing CORS)
- Reading and watching the config dir for changes
- Building plugins with esbuild (running in WASM)
- Communicating with the the preload script via IPC
- Injecting built plugins into the renderer to load them (bypassing the CSP)

Environment: Electron main process (Node.js + Electron APIs), CommonJS

- `core/main/main.cjs`: Entrypoint, imported by
  [`cli/shim.cjs`](../../cli/shim.cjs) in the patched app.asar. Synchronously
  after this file is imported, the original Slack code is loaded.
- `core/main/deps.ts`: ESM TypeScript module which exports functions that use
  NPM dependencies, bundled by Bun into `deps/`
- `core/deps/`: .gitignore'd directory where Bun outputs the bundled
  dependencies as CommonJS files when running `bun run build`
  - `core/deps/deps.bundle.cjs`: The CommonJS bundled dependencies file
  - `core/deps/esbuild.wasm`: The esbuild WASM binary used to build plugins
