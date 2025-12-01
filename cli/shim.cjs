// Entrypoint for the app.asar shim that is patched into Slack's resources directory

const os = require('os')
const path = require('path')

// This function is duplicated in helpers.js, keep in sync
function osConfigDir() {
  switch (process.platform) {
    case 'win32':
      return process.env.APPDATA || 'C:\\Program Files'

    case 'darwin': {
      const home = os.homedir()
      return path.join(home, 'Library', 'Application Support')
    }

    case 'linux':
    default: {
      const xdgConfigDir = process.env.XDG_CONFIG_HOME
      if (xdgConfigDir) return xdgConfigDir

      const home = os.homedir()
      return path.join(home, '.config')
    }
  }
}
const configDir = path.join(osConfigDir(), 'taut')

// Load the Taut main process script
const mainJs = path.join(configDir, 'core', 'main', 'main.cjs')
require(mainJs)

// Load the original Slack app
// @ts-ignore
require('../_app.asar')
