import os from 'node:os'
import path from 'node:path'

// This function is duplicated in shim.cjs, keep in sync
function osConfigDir() {
  switch (process.platform) {
    case 'win32':
      return process.env.APPDATA || 'C:\\Program Files'

    case 'darwin': {
      const home = os.homedir() || '~'
      return path.join(home, 'Library', 'Preferences')
    }

    case 'linux':
    default: {
      const xdgConfigDir = process.env.XDG_CONFIG_HOME
      if (xdgConfigDir) return xdgConfigDir

      const home = os.homedir() || '~'
      return path.join(home, '.config')
    }
  }
}
export const configDir = path.join(osConfigDir(), 'taut')
