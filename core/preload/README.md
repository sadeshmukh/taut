# `core/preload/`

The preload script, runs in the Chromium renderer process in the isolated
preload world. Responsible for:

- Communicating with the main process via IPC
- Updating a `<style>` tag with the contents of `user.css`
- Making `window.TautAPI` available to the renderer process, allowing the
  renderer code to communicate with the main process
- Fetching Slack's original preload script and `eval`ing it

Environment: Electron renderer process preload script (Chromium, DOM access +
limited Electron APIs including IPC), browser

- `core/preload/preload.js`: Loaded by the Electron main process via the
  `preload` option when creating the BrowserWindow, as patched by
  [`main.cjs`](../main/main.cjs).
