# Taut

`npx taut-cli` - Client mod for Slack :D

> Join [#taut](https://hackclub.slack.com/archives/C0A057686SF) on the
> [Hack Club Slack](https://hackclub.com/slack)!

Setup:

- Run `npx taut-cli` to install Taut
- Open the Taut config directory, printed after installation, in your favorite
  code editor
  - Windows: `%APPDATA%\taut`
  - macOS: `~/Library/Application Support/taut`
- Edit files in the config directory, and Slack will hot reload with your
  changes!
- Update Taut by running `npx taut-cli` again

Things to do:

- Open devtools with `Ctrl+Shift+I` or `Cmd+Option+I`
- Access the Taut settings tab in Preferences to see installed plugins and
  config info
- Use plugins by setting `"enabled": true` in `config.jsonc` and saving the file
- Write your own CSS to style Slack in `user.css` (updates in the app when you
  save)
- See built-in plugins in the `plugins/` directory and write your own in
  `user-plugins/` (the `plugins/` directory is overwritten on update)

<details><summary>Windows notes</summary>

- The config directory is at `%APPDATA%\taut`
- You'll need to accept the UAC prompt when running for the first time or after
  reinstalling Slack.
  - Slack is distributed as a MISX, which are installed by TrustedInstaller, so
    Taut runs [`windows-access.ps1`](./cli/windows-access.ps1) to give you write
    access to Slack's installation directory.

</details>

<details><summary>macOS notes</summary>

- The config directory is at `~/Library/Application Support/taut`
- Taut is incompatible with the App Store version of Slack, uninstall it and
  download from
  [Slack's website](https://slack.com/downloads/instructions/mac?ddl=1&build=mac).
  - This is because the App Store version of Slack is sandboxed, preventing Taut
    from accessing the config directory.
- If you uninstall and reinstall Taut, or rarely after certain Taut updates,
  Slack will prompt you for your password to restore its access to the keychain.
  Select "Always Allow".
  - This happens because, every time the Slack.app is modified, our ad-hoc code
    signature is different from the previous one and macOS treats it as a new
    app.

</details>

<details><summary>Linux notes</summary>

- The config directory is at `~/.config/taut`
- In theory, Taut can support Linux, but nobody has tested and made it work. PRs
  welcome!

</details>

## Development

PRs are very welcome! You should join the
[#taut](https://hackclub.slack.com/archives/C0A057686SF) channel on the
[Hack Club Slack](https://hackclub.com/slack) (high school or younger only). I'm
[@Jeremy](https://hackclub.slack.com/team/U06UYA5GMB5), say hi :D

The project uses [Bun](https://bun.sh/) for development, but npm works too if
you prefer it. After installing (`bun i`) and building the deps
(`bun run build`), you can run the cli from source (`bun taut-cli`). It uses the
same config directory, and if you're only editing [`plugins/`](./plugins/), Taut
will even hot reload them when you install!

```sh
# Also works with npm
bun i && bun run build

bun taut-cli install
```

## Credits

- Invisible Forward plugin based on [Cyril](https://github.com/CyrilSLi)'s
  [userscript](https://greasyfork.org/en/scripts/526439-forward-slack-messages-files-and-later-items-to-channels-and-threads-using-an-invisible-link)
- Shinigami Eyes plugin by [ShyMike](https://github.com/ImShyMike) and
  [Scooter](https://github.com/scooterthedev)
- IdvStatus plugin by [Sahil](https://github.com/sadeshmukh)
- Oneko plugin based on [adryd](https://github.com/adryd325)'s
  [oneko.js](https://github.com/adryd325/oneko.js)

## License

MIT License
