# `core/renderer/`

The renderer process code, runs in the Chromium renderer process in the main
world alongside the Slack frontend. Responsible for:

- Communicating with the preload script via the `window.TautAPI` object
- Loading and managing Taut plugins
  - Accepting new plugin code injected by the main process
  - Instantiating and initializing plugins
  - Loading, reloading, and unloading plugins as the config changes

Environment: Bundled by esbuild, Electron renderer process main world (Chromium,
alongside Slack frontend), ESM

- `core/renderer/client.js`: Entrypoint, bundled and executed in the renderer
  main world by [`main.cjs`](../main/main.cjs).
