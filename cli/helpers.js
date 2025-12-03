import fs from 'node:fs/promises'
import { existsSync, constants, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync, spawn } from 'node:child_process'
import readline from 'node:readline'
import { extractFile } from '@electron/asar'
import { fileURLToPath } from 'node:url'
import { FuseV1Options, getCurrentFuseWire, FuseState } from '@electron/fuses'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// This function is duplicated in shim.cjs, keep in sync
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
export const configDir = path.join(osConfigDir(), 'taut')

/**
 * Prompts the user with a yes/no question
 * @param {string} question - The question to ask
 * @returns {Promise<boolean>} True if the user answered yes (or default)
 */
export async function askYesNo(question) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  })

  return new Promise((resolve) => {
    rl.question(`${question} [Y/n]: `, (answer) => {
      rl.close()
      resolve(
        answer === '' || ['y', 'yes'].includes(answer.trim().toLowerCase())
      )
    })
  })
}

/**
 * Extracts version information from an asar archive's package.json
 * @param {string} asarPath - The path to the asar file
 * @returns {Promise<{name: string, version: string, patchVersion?: number} | null>} The name, version, and optional patchVersion, or null if not found
 */
export async function getAsarInfo(asarPath) {
  if (!existsSync(asarPath)) return null

  try {
    const pkgBuffer = extractFile(asarPath, 'package.json')
    const pkgContent = pkgBuffer.toString('utf8')
    const pkg = JSON.parse(pkgContent)
    return {
      name: pkg.name || 'unknown',
      version: pkg.version || 'unknown',
      patchVersion:
        typeof pkg.patchVersion === 'number' ? pkg.patchVersion : undefined,
    }
  } catch {
    // Ignore errors
    return null
  }
}

/**
 * @typedef {Record<keyof typeof import('@electron/fuses').FuseV1Options, boolean>} Fuses
 */

/**
 * Retrieves the Electron fuse configuration from a binary
 * @param {string} binaryPath - The path to the Electron binary
 * @returns {Promise<Fuses | null>} The fuse configuration, or null if not found
 */
export async function getBinaryFuses(binaryPath) {
  if (!existsSync(binaryPath)) return null

  try {
    const wire = await getCurrentFuseWire(binaryPath)

    // If wire is empty or has no data, return null
    if (!wire) return null

    /** @type {Partial<Fuses>} */
    const fuses = {}

    // Extract fuse states from the wire config object
    for (const [name, index] of Object.entries(FuseV1Options)) {
      if (typeof index !== 'number') continue
      const fuseEnabled = wire[index] === FuseState.ENABLE
      fuses[/** @type {keyof Fuses} */ (name)] = fuseEnabled
    }

    return /** @type {Fuses} */ (fuses)
  } catch {
    return null
  }
}

/**
 * Gets possible Slack installation paths on Windows
 * If needed, uses admin to give the needed permissions to the current user
 * @returns {string[]} Array of potential resource directory paths
 */
function getWindowsSlackPaths() {
  const programFiles =
    process.env['ProgramFiles'] || process.env['ProgramW6432']
  if (!programFiles) return []
  const windowsApps = path.join(programFiles, 'WindowsApps')
  try {
    if (!existsSync(windowsApps)) return []
    const entries = readdirSync(windowsApps)
    const slackPkgs = entries
      .filter((e) => e.startsWith('com.tinyspeck.slackdesktop_'))
      .sort()
      .reverse()

    if (slackPkgs.length > 0) {
      return slackPkgs.map((pkg) =>
        path.join(windowsApps, pkg, 'app', 'resources')
      )
    }
  } catch {
    // If we can't read WindowsApps, we need to obtain permissions first
    windowsObtainPermissions()
    // Retry after obtaining permissions
    const entries = readdirSync(windowsApps)
    const slackPkgs = entries
      .filter((e) => e.startsWith('com.tinyspeck.slackdesktop_'))
      .sort()
      .reverse()
    if (slackPkgs.length > 0) {
      return slackPkgs.map((pkg) =>
        path.join(windowsApps, pkg, 'app', 'resources')
      )
    }
  }

  return []
}

/**
 * Runs the windows-access.ps1 script to obtain permissions
 * for accessing the WindowsApps directory where Slack is installed
 */
export function windowsObtainPermissions() {
  if (process.platform !== 'win32') return

  const scriptPath = path.join(__dirname, 'windows-access.ps1')
  const currentUser = process.env.USERNAME || ''

  // The script self-elevates via Start-Process -Verb RunAs internally
  const result = spawnSync(
    'powershell.exe',
    [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      scriptPath,
      ...(currentUser ? ['-User', currentUser] : []),
    ],
    { stdio: 'inherit' }
  )

  if (result.error) {
    throw new Error(`Failed to spawn PowerShell: ${result.error.message}`)
  }

  if (result.status !== 0) {
    throw new Error(
      `Failed to obtain permissions (exit code ${result.status}). User may have declined elevation.`
    )
  }
}

/**
 * Gets all possible Slack installation paths for the current platform
 * @returns {string[]} Array of potential resource directory paths
 */
export function getSlackPaths() {
  if (process.platform === 'darwin') {
    return [
      '/Applications/Slack.app/Contents/Resources',
      path.join(os.homedir(), 'Applications/Slack.app/Contents/Resources'),
    ]
  }
  if (process.platform === 'win32') {
    return getWindowsSlackPaths()
  }
  if (process.platform === 'linux') {
    return [
      '/usr/lib/slack/resources',
      '/usr/share/slack/resources',
      '/opt/slack/resources',
      path.join(os.homedir(), '.local/share/slack/resources'),
      // Flatpak
      '/var/lib/flatpak/app/com.slack.Slack/current/active/files/extra/resources',
      path.join(
        os.homedir(),
        '.local/share/flatpak/app/com.slack.Slack/current/active/files/extra/resources'
      ),
      // Snap (though might not work due to confinement)
      '/snap/slack/current/usr/lib/slack/resources',
    ]
  }
  return []
}

/**
 * Finds the first valid Slack installation path
 * @returns {Promise<string | null>} The resources directory path, or null if not found
 */
export async function findSlackInstall() {
  const paths = getSlackPaths()
  for (const p of paths) {
    // TODO: this doesn't detect broken installs with no app.asar
    const appAsar = path.join(p, 'app.asar')
    if (existsSync(appAsar)) {
      return p
    }
  }
  return null
}

/**
 * Checks if the current process has write access to a directory
 * @param {string} dir - The directory path to check
 * @returns {Promise<boolean>} True if write access is available
 */
export async function checkWriteAccess(dir) {
  try {
    await fs.access(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Checks if Slack is currently running
 * @returns {boolean} True if Slack is running
 */
export function isSlackRunning() {
  try {
    if (process.platform === 'win32') {
      const result = execFileSync(
        'tasklist',
        ['/FI', 'IMAGENAME eq slack.exe'],
        {
          encoding: 'utf8',
        }
      )
      return result.toLowerCase().includes('slack.exe')
    } else if (process.platform === 'darwin') {
      const result = execFileSync('pgrep', ['-x', 'Slack'], {
        encoding: 'utf8',
      })
      return result.trim().length > 0
    } else {
      const result = execFileSync('pgrep', ['-x', 'slack'], {
        encoding: 'utf8',
      })
      return result.trim().length > 0
    }
  } catch {
    return false
  }
}

/**
 * Attempts to kill the Slack process
 * @returns {Promise<boolean>} True if Slack was successfully killed or wasn't running
 */
export async function killSlack() {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/F', '/IM', 'slack.exe'], { stdio: 'ignore' })
    } else if (process.platform === 'darwin') {
      execFileSync('pkill', ['-x', 'Slack'], { stdio: 'ignore' })
    } else {
      // Linux and others
      execFileSync('pkill', ['-x', 'slack'], { stdio: 'ignore' })
    }
    await new Promise((resolve) => setTimeout(resolve, 2000))
    return true
  } catch {
    return false
  }
}

/**
 * Launches Slack
 * @param {string} resourcesDir - The Slack resources directory path
 */
export async function launchSlack(resourcesDir) {
  console.log('🚀 Launching Slack...')
  if (process.platform === 'darwin') {
    const appPath = path.resolve(resourcesDir, '..', '..')
    spawnSync('open', [appPath])
  } else {
    const binary = getElectronBinary(resourcesDir)
    spawn(binary, [], { detached: true, stdio: 'ignore' }).unref()
  }
}

/**
 * Checks if Slack has been patched by Taut
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<boolean>} True if the backup asar exists (indicating patched state)
 */
export async function isPatched(resourcesDir) {
  const backup = path.join(resourcesDir, '_app.asar')
  return existsSync(backup)
}

/**
 * Checks if the Slack installation is from the Mac App Store
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<boolean>} True if the installation is from the Mac App Store
 */
export async function isMacAppStoreInstall(resourcesDir) {
  if (process.platform !== 'darwin') return false
  const masReceiptPath = path.join(resourcesDir, '..', '_MASReceipt', 'receipt')
  try {
    await fs.access(masReceiptPath, constants.F_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Checks if the Slack installation has MacOS app sandboxing enabled
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<boolean>} True if sandboxing is enabled
 */
export async function isMacSandboxed(resourcesDir) {
  if (process.platform !== 'darwin') return false
  // codesign -d --entitlements - /Applications/Slack.app
  const appPath = path.resolve(resourcesDir, '..', '..')
  try {
    const result = execFileSync(
      'codesign',
      ['-d', '--entitlements', '-', appPath],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }
    )
    const sandboxRegex =
      /\t\[Key] com\.apple\.security\.app-sandbox\n\t\[Value]\n\t\t\[Bool] true\n/
    return sandboxRegex.test(result)
  } catch {
    return false
  }
}

/**
 * Checks if the Slack installation is in a broken state
 * A broken state occurs when the backup exists but the main asar is missing
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<boolean>} True if the installation is broken
 */
export async function isBroken(resourcesDir) {
  const appAsar = path.join(resourcesDir, 'app.asar')
  const backup = path.join(resourcesDir, '_app.asar')
  // Broken: backup exists but original doesn't
  return existsSync(backup) && !existsSync(appAsar)
}

/**
 * Gets the path to the Slack/Electron binary for the current platform
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {string} The path to the Slack executable
 */
export function getElectronBinary(resourcesDir) {
  if (process.platform === 'darwin') {
    // macOS: Resources -> MacOS/Slack
    return path.resolve(resourcesDir, '..', 'MacOS', 'Slack')
  } else if (process.platform === 'win32') {
    // Windows: resources -> slack.exe (one level up)
    return path.resolve(resourcesDir, '..', 'slack.exe')
  } else {
    // Linux: resources -> slack (one level up)
    return path.resolve(resourcesDir, '..', 'slack')
  }
}
