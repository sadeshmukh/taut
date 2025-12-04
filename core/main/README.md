# `core/main/`

The main process code, runs in the Electron main process before Slack starts.
Responsible for:

- Monkey patching Electron APIs to inject the preload script and renderer code
  (plus other tweaks like enabling devtools and bypassing CORS)
- Reading and watching the config dir for changes
- Building plugins with esbuild (running in WASM)
- Communicating with the preload script via IPC
- Injecting built plugins into the renderer to load them (bypassing the CSP)

Environment: Electron main process (Node.js + Electron APIs), CommonJS

- `core/main/main.cjs`: Entrypoint, imported by
  [`cli/shim.cjs`](../../cli/shim.cjs) in the patched app.asar. Loads the other
  modules.
- `core/main/patch.cjs`: Electron monkey-patching: BrowserWindow proxy,
  Module.\_load override, CORS bypass, custom app menu, and React DevTools
  installation
- `core/main/plugins.cjs`: Plugin manager: discovery, bundling with esbuild,
  config/CSS watching, and IPC handlers for communicating with the renderer
- `core/main/helpers.cjs`: Shared utilities and constants
- `core/main/deps.ts`: ESM TypeScript module which exports functions that use
  NPM dependencies, bundled by Bun into `deps/`
- `core/main/deps/`: .gitignore'd directory where Bun outputs the bundled
  dependencies as CommonJS files when running `bun run build`
  - `deps/deps.bundle.js`: The CommonJS bundled dependencies file
  - `deps/esbuild.wasm`: The esbuild WASM binary used to build plugins
