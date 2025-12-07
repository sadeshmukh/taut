# `cli/`

The CLI for Taut, responsible for installing and updating Taut.

Environment: Node.js ESM, run via `npx taut-cli`

- `cli.js`: Entrypoint, the CLI interface
- `patch.js`: Main logic for patching Slack and installing Taut
- `helpers.js`: Generic helper functions (platform detection, paths, etc.)
- `shim.cjs`: Injected into `app.asar` to load Taut's main process code
- `windows-access.ps1`: PowerShell script to obtain write access to Slack on
  Windows
- `default-config.jsonc`: Default config file, copied on first install
- `default-user.css`: Default user CSS file, copied on first install
