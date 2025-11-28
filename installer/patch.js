import fs from 'node:fs/promises'
import { existsSync, constants, readdirSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { execFileSync, spawnSync } from 'node:child_process'
import { createPackage, extractFile } from '@electron/asar'
import { fileURLToPath } from 'node:url'
import {
  flipFuses,
  FuseVersion,
  FuseV1Options,
  getCurrentFuseWire,
  FuseState,
} from '@electron/fuses'
import { configDir } from 'helpers'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Current patch version. Increment this when the shim/loader logic changes
 * in a way that requires re-patching the Slack binary.
 * @type {number}
 */
export const PATCH_VERSION = 0

/**
 * Extracts version information from an asar archive's package.json.
 * @param {string} asarPath - The path to the asar file.
 * @returns {Promise<{name: string, version: string, patchVersion?: number} | null>} The name, version, and optional patchVersion, or null if not found.
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
 * Retrieves the Electron fuse configuration from a binary.
 * @param {string} binaryPath - The path to the Electron binary.
 * @returns {Promise<Fuses | null>} The fuse configuration, or null if not found.
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
 * Gets possible Slack installation paths on Windows.
 * @returns {string[]} Array of potential resource directory paths.
 */
function getWindowsSlackPaths() {
  const localAppData = process.env.LOCALAPPDATA
  if (!localAppData) return []
  const slackBase = path.join(localAppData, 'slack')
  // Windows Slack uses app-X.X.X folders like Discord
  try {
    if (!existsSync(slackBase)) return []
    const entries = readdirSync(slackBase)
    const appDirs = entries
      .filter((e) => e.startsWith('app-'))
      .sort()
      .reverse()
    if (appDirs.length > 0) {
      return [path.join(slackBase, appDirs[0], 'resources')]
    }
  } catch {}
  return []
}

/**
 * Gets all possible Slack installation paths for the current platform.
 * @returns {string[]} Array of potential resource directory paths.
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
 * Finds the first valid Slack installation path.
 * @returns {Promise<string | null>} The resources directory path, or null if not found.
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
 * Checks if the current process has write access to a directory.
 * @param {string} dir - The directory path to check.
 * @returns {Promise<boolean>} True if write access is available.
 */
async function checkWriteAccess(dir) {
  try {
    await fs.access(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/**
 * Checks if Slack is currently running.
 * @returns {boolean} True if Slack is running.
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
 * Attempts to kill the Slack process.
 * @returns {Promise<boolean>} True if Slack was successfully killed or wasn't running.
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
 * Checks if Slack has been patched by Taut.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<boolean>} True if the backup asar exists (indicating patched state).
 */
export async function isPatched(resourcesDir) {
  const backup = path.join(resourcesDir, '_app.asar')
  return existsSync(backup)
}

/**
 * Checks if the Slack installation is in a broken state.
 * A broken state occurs when the backup exists but the main asar is missing.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<boolean>} True if the installation is broken.
 */
export async function isBroken(resourcesDir) {
  const appAsar = path.join(resourcesDir, 'app.asar')
  const backup = path.join(resourcesDir, '_app.asar')
  // Broken: backup exists but original doesn't
  return existsSync(backup) && !existsSync(appAsar)
}

/**
 * Creates backups of the original Slack files before patching.
 * Backs up app.asar and app.asar.unpacked
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 * @throws {Error} If backup fails (will attempt rollback).
 */
export async function backup(resourcesDir) {
  const appAsar = path.join(resourcesDir, 'app.asar')
  const backupAsar = path.join(resourcesDir, '_app.asar')
  const unpacked = path.join(resourcesDir, 'app.asar.unpacked')
  const unpackedBackup = path.join(resourcesDir, '_app.asar.unpacked')

  const renamesDone = []
  try {
    console.log('📦 Backing up original app.asar...')
    await fs.rename(appAsar, backupAsar)
    renamesDone.push([backupAsar, appAsar])

    // Handle .unpacked folder (crucial for native modules)
    if (existsSync(unpacked)) {
      console.log('📦 Backing up app.asar.unpacked...')
      await fs.rename(unpacked, unpackedBackup)
      renamesDone.push([unpackedBackup, unpacked])
    }
  } catch (err) {
    // Rollback on failure
    console.error('❌ Backup failed, rolling back...')
    for (const [from, to] of renamesDone.reverse()) {
      try {
        await fs.rename(from, to)
      } catch {}
    }
    throw err
  }
}

/**
 * Gets the path to the Slack/Electron binary for the current platform.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {string} The path to the Slack executable.
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

/**
 * Disables the Electron ASAR integrity check fuse in the Slack binary.
 * This is necessary to allow loading modified asar files.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 */
export async function disableIntegrityCheck(resourcesDir) {
  const executablePath = getElectronBinary(resourcesDir)

  if (!existsSync(executablePath)) {
    console.warn('⚠️  Could not find Slack binary at:', executablePath)
    console.warn('   Skipping fuse patching. This may cause issues.')
    return
  }

  const fuses = await getBinaryFuses(executablePath)
  if (fuses && fuses.EnableEmbeddedAsarIntegrityValidation === false) {
    console.log('ℹ️   ASAR integrity check already disabled.')
    return
  }

  console.log('🔓 Disabling Electron ASAR integrity check...')

  await flipFuses(executablePath, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: false,
    // [FuseV1Options.EnableCookieEncryption]: false,
    // resetAdHocDarwinSignature: true, // we'll do it later
  })
  console.log('✅ Integrity check disabled.')
}

/**
 * Builds the Taut shim asar that loads our code before the original Slack app.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 */
export async function buildShim(resourcesDir) {
  const appAsar = path.join(resourcesDir, 'app.asar')
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taut-shim-'))

  try {
    // Read the loader from our package
    const loaderSrc = path.join(__dirname, 'loader.js')
    const loaderContent = await fs.readFile(loaderSrc, 'utf8')

    // Write shim files
    await fs.writeFile(path.join(tmpDir, 'loader.js'), loaderContent)

    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'taut',
        main: 'index.js',
        version: `${PATCH_VERSION}.0.0`,
        patchVersion: PATCH_VERSION,
      })
    )

    // The bootstrapper - loads our code then the original app
    const indexContent = `require('./loader.js')`
    await fs.writeFile(path.join(tmpDir, 'index.js'), indexContent)

    // Pack the shim
    console.log('📦 Packing shim asar...')
    await createPackage(tmpDir, appAsar)
  } finally {
    // Cleanup temp dir
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Resigns the Slack app binary on macOS after patching.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 */
export async function resign(resourcesDir) {
  if (process.platform !== 'darwin') {
    return
  }
  const appPath = path.resolve(resourcesDir, '..', '..')
  console.log('🔏 Resigning Slack app...')
  const cs = spawnSync(
    'codesign',
    [
      '--force',
      '--sign',
      '-',
      '--deep',
      '--preserve-metadata=identifier,entitlements',
      appPath,
    ],
    { encoding: 'utf8' }
  )

  if (cs.error || cs.status !== 0) {
    if (cs.stderr) console.error(cs.stderr)
    console.error(
      `❌ codesign failed${
        cs.error ? `: ${cs.error.message}` : ` with exit code ${cs.status}`
      }`
    )
  }

  const xa = spawnSync('xattr', ['-d', 'com.apple.quarantine', appPath], {
    encoding: 'utf8',
  })

  if (xa.error || xa.status !== 0) {
    const stderr = xa.stderr || ''
    if (!stderr.includes('No such xattr: com.apple.quarantine')) {
      if (stderr) console.error(stderr)
      console.error('❌ xattr failed')
    }
    // If the message was that the attribute doesn't exist, that's normal
  }
  console.log('✅ Resign complete.')
}

export async function copyJsToConfigDir() {
  console.log('📋 Copying JS files to config directory...')

  const sourceDir = path.join(__dirname, 'js')
  const destDir = path.join(configDir, 'js')

  try {
    await fs.rm(destDir, { recursive: true, force: true })
  } catch {}
  await fs.mkdir(destDir, { recursive: true })
  const files = await fs.readdir(sourceDir)
  for (const file of files) {
    const srcFile = path.join(sourceDir, file)
    const destFile = path.join(destDir, file)
    await fs.copyFile(srcFile, destFile)
  }
}

/**
 * Applies the Taut patch to Slack (internal).
 * This will backup original files, build a shim, disable integrity checks,
 * and re-sign the app (on macOS). Does NOT copy JS files.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 */
async function applyPatch(resourcesDir) {
  if (await isPatched(resourcesDir)) {
    console.log('ℹ️  Already patched. Removing old patch first...')
    await removePatch(resourcesDir)
    console.log()
  }

  await disableIntegrityCheck(resourcesDir)

  await backup(resourcesDir)
  await buildShim(resourcesDir)

  await resign(resourcesDir)

  console.log('✅ Patch applied successfully!')
}

/**
 * Checks common preconditions for install/uninstall operations.
 * Kills Slack if running, checks write access, and checks for broken installs.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 */
async function checkPreconditions(resourcesDir) {
  if (isSlackRunning()) {
    const killed = await killSlack()
    // Double-check
    if (!killed || isSlackRunning()) {
      console.error('❌ Could not close Slack. Please close it manually.')
      process.exit(1)
    }
  }

  if (!(await checkWriteAccess(resourcesDir))) {
    if (process.platform === 'darwin') {
      console.error(
        '❌ Permission denied. Try running with sudo or grant Full Disk Access.'
      )
    } else if (process.platform === 'linux') {
      console.error('❌ Permission denied. Try running with sudo.')
    } else {
      console.error('❌ Permission denied.')
    }
    process.exit(1)
  }

  if (await isBroken(resourcesDir)) {
    console.error(
      '❌ Detected broken Slack installation. Please reinstall Slack.'
    )
    process.exit(1)
  }
}

/**
 * Installs or updates Taut on the Slack installation.
 * If the patch is missing or outdated, it will apply the patch.
 * Always copies the JS files to the config directory.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 */
export async function install(resourcesDir) {
  await checkPreconditions(resourcesDir)

  const appAsar = path.join(resourcesDir, 'app.asar')
  const asarInfo = await getAsarInfo(appAsar)

  // Check if we need to apply/update the patch
  const needsPatch =
    !asarInfo ||
    asarInfo.name !== 'taut' ||
    asarInfo.patchVersion !== PATCH_VERSION

  if (needsPatch) {
    if (asarInfo?.name === 'taut') {
      console.log(
        `ℹ️  Updating patch from v${
          asarInfo.patchVersion || '?'
        } to v${PATCH_VERSION}...`
      )
    } else {
      console.log('📦 Applying Taut patch...')
    }
    await applyPatch(resourcesDir)
  } else {
    console.log(`ℹ️  Patch v${PATCH_VERSION} is up to date.`)
  }

  console.log()
  await copyJsToConfigDir()

  console.log()
  console.log('✅ Taut installed successfully!')
}

/**
 * Removes the Taut patch from Slack, restoring original files (internal).
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 */
async function removePatch(resourcesDir) {
  if (!(await isPatched(resourcesDir))) {
    console.log('ℹ️  Slack is not patched.')
    return
  }

  const appAsar = path.join(resourcesDir, 'app.asar')
  const appAsarTmp = path.join(resourcesDir, 'app.asar.tmp')
  const backup = path.join(resourcesDir, '_app.asar')
  const unpacked = path.join(resourcesDir, 'app.asar.unpacked')
  const unpackedBackup = path.join(resourcesDir, '_app.asar.unpacked')

  const renamesDone = []
  try {
    // First, restore the original binary
    const binaryPath = getElectronBinary(resourcesDir)
    const binaryBackup = binaryPath + '.bak'

    if (existsSync(binaryBackup)) {
      console.log('📦 Restoring original Slack binary...')
      await fs.rename(binaryBackup, binaryPath)
      renamesDone.push([binaryPath, binaryBackup])
    }

    // Move shim out of the way
    console.log('🗑️  Removing shim...')
    await fs.rename(appAsar, appAsarTmp)
    renamesDone.push([appAsarTmp, appAsar])

    // Restore original
    console.log('📦 Restoring original app.asar...')
    await fs.rename(backup, appAsar)
    renamesDone.push([appAsar, backup])

    // Restore unpacked if it exists
    if (existsSync(unpackedBackup)) {
      console.log('📦 Restoring app.asar.unpacked...')
      await fs.rename(unpackedBackup, unpacked)
    }

    // Delete the shim
    await fs.rm(appAsarTmp, { force: true })
  } catch (err) {
    // Rollback
    console.error('❌ Unpatch failed, rolling back...')
    for (const [from, to] of renamesDone.reverse()) {
      try {
        await fs.rename(from, to)
      } catch {}
    }
    throw err
  }

  console.log('✅ Patch removed successfully!')
}

/**
 * Uninstalls Taut from Slack, restoring original files.
 * @param {string} resourcesDir - The Slack resources directory path.
 * @returns {Promise<void>}
 */
export async function uninstall(resourcesDir) {
  await checkPreconditions(resourcesDir)
  await removePatch(resourcesDir)
  console.log('✅ Taut uninstalled successfully!')
}
