#!/usr/bin/env node
import path from 'node:path'
import readline from 'node:readline/promises'
import {
  findSlackInstall,
  getSlackPaths,
  install,
  uninstall,
  getElectronBinary,
  getBinaryFuses,
  getAsarInfo,
  PATCH_VERSION,
} from './patch.js'

/**
 * Main entry point for the Taut CLI installer
 * Handles install, uninstall, and status commands for patching Slack
 * @returns {Promise<void>}
 */
async function main() {
  const args = process.argv.slice(2)
  const action = args[0]
  const customPath = args[1]

  console.log('🔌 Taut Installer')
  console.log()

  /** @type {string | null} */
  let resourcesDir = customPath || null
  if (!resourcesDir) {
    resourcesDir = await findSlackInstall()
  }

  if (!resourcesDir) {
    console.error('❌ Could not find Slack installation.')
    console.error('   Searched paths:')
    for (const p of getSlackPaths()) {
      console.error(`   - ${p}`)
    }
    console.error('')
    console.error('   You can specify a custom path:')
    console.error('   npx taut-installer install /path/to/slack/resources')
    process.exit(1)
  }

  console.log(`📍 Found Slack at: ${resourcesDir}`)
  console.log()

  // Show current patch status
  const appAsar = path.join(resourcesDir, 'app.asar')
  const appAsarInfo = await getAsarInfo(appAsar)

  if (appAsarInfo && appAsarInfo.name === 'taut-shim') {
    const isUpToDate = appAsarInfo.patchVersion === PATCH_VERSION
    const statusText = isUpToDate
      ? 'up to date'
      : `outdated, latest is v${PATCH_VERSION}`
    console.log(
      `   Installed: Taut patch v${
        appAsarInfo.patchVersion ?? '?'
      } (${statusText})`
    )
  } else {
    console.log('   Installed: No')
  }
  console.log()

  if (action === 'install') {
    await install(resourcesDir)
  } else if (!action) {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    })
    try {
      const answer = await rl.question(
        `Install Taut to ${resourcesDir}? [Y/n] `
      )
      if (answer === '' || /^\s*(y|yes)$/i.test(answer)) {
        console.log()
        await install(resourcesDir)
      } else {
        console.log('Aborted.')
      }
    } finally {
      rl.close()
    }
  } else if (action === 'uninstall') {
    await uninstall(resourcesDir)
  } else if (action === 'status') {
    // Check asar files and their versions

    // app.asar line
    if (appAsarInfo && appAsarInfo.name === 'taut-shim') {
      const isUpToDate = appAsarInfo.patchVersion === PATCH_VERSION
      const statusText = isUpToDate ? 'up to date' : 'outdated'
      console.log(
        `app.asar: ✅ Taut patch v${
          appAsarInfo.patchVersion ?? '?'
        } (${statusText})`
      )
    } else if (appAsarInfo && appAsarInfo.name === 'slack-desktop') {
      console.log(`app.asar: ✅ Slack v${appAsarInfo.version} (not patched)`)
    } else {
      console.log(`app.asar: ❌ Unknown or missing`)
    }

    const backupAsar = path.join(resourcesDir, '_app.asar')
    const backupAsarInfo = await getAsarInfo(backupAsar)

    // _app.asar line
    if (backupAsarInfo && backupAsarInfo.name === 'taut-shim') {
      console.log(
        `_app.asar: ⚠️  Taut patch v${
          backupAsarInfo.patchVersion ?? '?'
        } (broken, should be Slack!)`
      )
    } else if (backupAsarInfo && backupAsarInfo.name === 'slack-desktop') {
      console.log(`_app.asar: ✅ Slack v${backupAsarInfo.version}`)
    } else if (appAsarInfo && appAsarInfo.name === 'taut-shim') {
      console.log(`_app.asar: ❌ Missing (broken state!)`)
    } else {
      console.log(`_app.asar: ➖ Not present (not patched)`)
    }

    console.log('')

    const fuses = await getBinaryFuses(getElectronBinary(resourcesDir))
    const enabledFuses = Object.entries(fuses ?? {})
      .filter(([fuse, enabled]) => enabled)
      .map(([fuse, enabled]) => fuse)

    console.log(
      `Electron fuses: ${
        enabledFuses.length > 0 ? enabledFuses.join(', ') : 'none'
      }`
    )
  } else {
    console.log('Usage: npx taut-installer [command] [path]')
    console.log()
    console.log('Commands:')
    console.log('  install    Install or update Taut (default)')
    console.log('  uninstall  Remove Taut')
    console.log('  status     Show current status')
    console.log()
    console.log('Examples:')
    console.log('  npx taut-installer')
    console.log('  npx taut-installer install')
    console.log('  npx taut-installer uninstall')
    console.log('  npx taut-installer install /custom/path/to/resources')
  }
}

main().catch((err) => {
  console.error('❌ Error:', err.message)
  if (process.env.DEBUG) {
    console.error(err.stack)
  }
  process.exit(1)
})
