// Taut CLI Patch Module
// Core logic for patching Slack to inject Taut
// Handles asar extraction, code injection, and fuse flipping

import fs from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { spawnSync } from 'node:child_process'
import { createPackage } from '@electron/asar'
import { fileURLToPath } from 'node:url'
import { flipFuses, FuseVersion, FuseV1Options } from '@electron/fuses'
import {
  configDir,
  askYesNo,
  getAsarInfo,
  getBinaryFuses,
  windowsObtainPermissions,
  checkWriteAccess,
  isSlackRunning,
  killSlack,
  launchSlack,
  isPatched,
  isMacAppStoreInstall,
  isMacSandboxed,
  isBroken,
  getElectronBinary,
} from './helpers.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/**
 * Current patch version. Increment this when the shim/loader logic changes
 * in a way that requires re-patching the Slack binary
 * @type {number}
 */
export const PATCH_VERSION = 3

/**
 * Creates backups of the original Slack files before patching
 * Backs up app.asar and app.asar.unpacked
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<void>}
 * @throws {Error} If backup fails (will attempt rollback)
 */
async function backup(resourcesDir) {
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
 * Disables the Electron ASAR integrity check fuse in the Slack binary
 * This is necessary to allow loading modified asar files
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<void>}
 */
async function disableIntegrityCheck(resourcesDir) {
  const executablePath = getElectronBinary(resourcesDir)

  if (!existsSync(executablePath)) {
    console.warn('⚠️  Could not find Slack binary at:', executablePath)
    console.warn('   Skipping fuse patching. This may cause issues.')
    return
  }

  const fuses = await getBinaryFuses(executablePath)
  if (fuses && fuses.EnableEmbeddedAsarIntegrityValidation === false) {
    console.log('ℹ️  ASAR integrity check already disabled.')
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
 * Builds the Taut shim asar that loads our code before the original Slack app
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<void>}
 */
async function buildShim(resourcesDir) {
  const appAsar = path.join(resourcesDir, 'app.asar')
  const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'taut-shim-'))

  try {
    // Write shim files
    await fs.writeFile(
      path.join(tmpDir, 'package.json'),
      JSON.stringify({
        name: 'taut-shim',
        productName: 'Slack',
        main: 'index.js',
        version: `${PATCH_VERSION}.0.0`,
        patchVersion: PATCH_VERSION,
      })
    )
    await fs.copyFile(
      path.join(__dirname, 'shim.cjs'),
      path.join(tmpDir, 'index.js')
    )

    // Pack the shim
    console.log('📦 Packing shim asar...')
    await createPackage(tmpDir, appAsar)
  } finally {
    // Cleanup temp dir
    await fs.rm(tmpDir, { recursive: true, force: true })
  }
}

/**
 * Resigns the Slack app binary on macOS after patching
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<void>}
 */
async function resign(resourcesDir) {
  if (process.platform !== 'darwin') {
    return
  }
  const appPath = path.resolve(resourcesDir, '..', '..')
  console.log('🔏 Resigning Slack app...')

  const codesign = spawnSync(
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

  if (codesign.error || codesign.status !== 0) {
    if (codesign.stderr) console.error(codesign.stderr)
    console.error(
      `❌ codesign failed${
        codesign.error
          ? `: ${codesign.error.message}`
          : ` with exit code ${codesign.status}`
      }`
    )
  }

  const xattr = spawnSync('xattr', ['-d', 'com.apple.quarantine', appPath], {
    encoding: 'utf8',
  })

  if (xattr.error || xattr.status !== 0) {
    const stderr = xattr.stderr || ''
    if (!stderr.includes('No such xattr: com.apple.quarantine')) {
      if (stderr) console.error(stderr)
      console.error('❌ xattr failed')
    }
    // If the message was that the attribute doesn't exist, that's normal
  }

  // Reset macOS privacy permissions for Slack, as any current permissions
  // are now invalid, which can lead to confusion
  const permissions = ['ScreenCapture', 'Microphone', 'Camera']
  for (const permission of permissions) {
    const tccutil = spawnSync(
      'tccutil',
      ['reset', permission, 'com.tinyspeck.slackmacgap'],
      { encoding: 'utf8' }
    )

    if (tccutil.error || tccutil.status !== 0) {
      if (tccutil.stderr) console.error(tccutil.stderr)
      console.error(
        `❌ tccutil reset ${permission} failed${
          tccutil.error
            ? `: ${tccutil.error.message}`
            : ` with exit code ${tccutil.status}`
        }`
      )
    }
  }

  console.log('✅ Resign complete.')
}

/**
 * Copies the Taut core and plugins JS files to the config directory
 * Also creates default config.jsonc and user.css if they don't exist
 * @returns {Promise<void>}
 */
export async function copyJsToConfigDir() {
  console.log('📋 Copying Taut files to config directory...')

  const coreSourceDir = path.join(__dirname, '..', 'core')
  const pluginsSourceDir = path.join(__dirname, '..', 'plugins')

  const coreDestDir = path.join(configDir, 'core')
  const pluginsDestDir = path.join(configDir, 'plugins')
  const userPluginsDestDir = path.join(configDir, 'user-plugins')
  const configFilePath = path.join(configDir, 'config.jsonc')

  // Remove old core directory and copy fresh
  try {
    await fs.rm(coreDestDir, { recursive: true, force: true })
  } catch {}
  await fs.mkdir(coreDestDir, { recursive: true })
  await fs.cp(coreSourceDir, coreDestDir, { recursive: true })

  // Remove old plugins directory and copy fresh
  try {
    await fs.rm(pluginsDestDir, { recursive: true, force: true })
  } catch {}
  await fs.mkdir(pluginsDestDir, { recursive: true })
  await fs.cp(pluginsSourceDir, pluginsDestDir, { recursive: true })

  // Create user-plugins directory if it doesn't exist
  if (!existsSync(userPluginsDestDir)) {
    await fs.mkdir(userPluginsDestDir, { recursive: true })
  }

  // Create default config.jsonc if it doesn't exist
  if (!existsSync(configFilePath)) {
    const defaultConfigPath = path.join(__dirname, 'default-config.jsonc')
    await fs.copyFile(defaultConfigPath, configFilePath)
  }

  // Create default user.css if it doesn't exist
  const userCssPath = path.join(configDir, 'user.css')
  if (!existsSync(userCssPath)) {
    const defaultUserCssPath = path.join(__dirname, 'default-user.css')
    await fs.copyFile(defaultUserCssPath, userCssPath)
  }

  console.log('✅ Taut files copied successfully!')
}

/**
 * Applies the Taut patch to Slack (internal)
 * This will backup original files, build a shim, disable integrity checks,
 * and re-sign the app (on macOS). Does NOT copy JS files
 * @param {string} resourcesDir - The Slack resources directory path
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
 * Checks common preconditions for install/uninstall operations
 * Kills Slack if running, checks write access, and checks for broken installs
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<boolean>} True if Slack was running and killed
 */
async function checkPatchPreconditions(resourcesDir) {
  if (await isMacAppStoreInstall(resourcesDir)) {
    console.error(
      '❌ Mac App Store installation detected. Taut cannot be installed on MAS versions of Slack.'
    )
    console.error(
      '   Please uninstall Slack, then reinstall it from https://slack.com/downloads/instructions/mac?ddl=1&build=mac'
    )
    process.exit(1)
  }
  if (await isMacSandboxed(resourcesDir)) {
    console.error(
      '❌ MacOS app sandboxing detected. Taut cannot be installed on sandboxed versions of Slack.'
    )
    console.error(
      '   Please uninstall Slack, then reinstall it from https://slack.com/downloads/instructions/mac?ddl=1&build=mac'
    )
    process.exit(1)
  }

  if (!(await checkWriteAccess(resourcesDir))) {
    if (process.platform === 'win32') {
      // Try to obtain permissions
      try {
        windowsObtainPermissions()
      } catch (err) {
        console.error('❌ Failed to obtain permissions:', err)
        process.exit(1)
      }

      // Re-check access
      if (!(await checkWriteAccess(resourcesDir))) {
        console.error('❌ Permission denied even after obtaining permissions.')
        process.exit(1)
      }
    } else if (process.platform === 'darwin') {
      console.error(
        '❌ Permission denied. Go to Settings > Privacy & Security > Full Disk Access and grant your terminal app access.'
      )
      process.exit(1)
    } else if (process.platform === 'linux') {
      console.error('❌ Permission denied. Try running with sudo.')
      process.exit(1)
    } else {
      console.error('❌ Permission denied.')
      process.exit(1)
    }
  }

  if (await isBroken(resourcesDir)) {
    console.error(
      '❌ Detected broken Slack installation. Please reinstall Slack.'
    )
    process.exit(1)
  }

  let wasRunning = false
  if (isSlackRunning()) {
    const shouldKill = await askYesNo(
      '⚠️  Slack is currently running. Close it now?'
    )
    if (!shouldKill) {
      console.log('❌ Please close Slack and try again.')
      process.exit(1)
    }

    console.log('⏳ Closing Slack...')
    const killed = await killSlack()
    // Double-check
    if (!killed || isSlackRunning()) {
      console.error('❌ Could not close Slack. Please close it manually.')
      process.exit(1)
    }
    wasRunning = true
  }

  return wasRunning
}

/**
 * Installs or updates Taut on the Slack installation
 * If the patch is missing or outdated, it will apply the patch
 * Always copies the JS files to the config directory
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<void>}
 */
export async function install(resourcesDir) {
  const appAsar = path.join(resourcesDir, 'app.asar')
  const asarInfo = await getAsarInfo(appAsar)

  // Check if we need to apply/update the patch
  const needsPatch =
    !asarInfo ||
    asarInfo.name !== 'taut-shim' ||
    asarInfo.patchVersion !== PATCH_VERSION

  let slackWasRunning = false
  if (needsPatch) {
    slackWasRunning = await checkPatchPreconditions(resourcesDir)

    if (asarInfo?.name === 'taut-shim') {
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

  // Temporary, move old config dir to new location
  if (process.platform === 'darwin') {
    try {
      await fs.rename(
        path.join(os.homedir(), 'Library', 'Preferences', 'taut'),
        configDir
      )
      console.log('ℹ️  Moved old config directory to new location.')
    } catch {}
  }

  console.log()
  await copyJsToConfigDir()

  console.log()
  console.log('✅ Taut installed successfully!')
  console.log('   Config directory:', configDir)

  if (slackWasRunning) {
    const shouldReopen = await askYesNo(
      '🚀 Slack was closed during installation. Reopen it now?'
    )
    if (shouldReopen) {
      await launchSlack(resourcesDir)
    }
  }
}

/**
 * Removes the Taut patch from Slack, restoring original files (internal)
 * @param {string} resourcesDir - The Slack resources directory path
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
 * Uninstalls Taut from Slack, restoring original files
 * @param {string} resourcesDir - The Slack resources directory path
 * @returns {Promise<void>}
 */
export async function uninstall(resourcesDir) {
  const slackWasRunning = await checkPatchPreconditions(resourcesDir)
  await removePatch(resourcesDir)
  console.log('✅ Taut uninstalled successfully!')

  if (slackWasRunning) {
    const shouldReopen = await askYesNo(
      '🚀 Slack was closed during uninstallation. Reopen it now?'
    )
    if (shouldReopen) {
      await launchSlack(resourcesDir)
    }
  }
}
