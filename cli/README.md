# `cli/`

This is the CLI for Taut, responsible for installing and updating Taut.

Environment: Node.js ESM, the `npx taut-cli` command run by the user

- `cli/cli.js`: Entrypoint, the CLI interface
- `cli/patch.js`: The main logic for patching Slack and installing Taut
- `cli/helpers.js`: More generic helper functions
- `cli/windows-access.ps1`: PowerShell script to obtain write access to Slack
- `cli/default-config.jsonc`: The default config file for Taut, copied if the
  user doesn't yet have one
- `cli/default-user.css`: The default user CSS file for Taut, copied if the user
  doesn't yet have one
