#!/usr/bin/env node
// Taut CLI Entrypoint
// Command-line interface for installing and updating Taut

import path from 'node:path'
import readline from 'node:readline/promises'
import { install, uninstall, PATCH_VERSION } from './patch.js'
import {
  findSlackInstall,
  getSlackPaths,
  getElectronBinary,
  getBinaryFuses,
  getAsarInfo,
  askYesNo,
} from './helpers.js'
import { exists, existsSync } from 'node:fs'

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

  const displayPath =
    process.platform === 'darwin'
      ? path.join(resourcesDir, '..', '..')
      : path.join(resourcesDir, '..')
  console.log(`📍 Found Slack at ${displayPath}`)

  if (action !== 'status') {
    // Show current patch status (unless status command was used, which shows more details)
    const appAsar = path.join(resourcesDir, 'app.asar')
    const appAsarInfo = await getAsarInfo(appAsar)

    if (appAsarInfo && appAsarInfo.name === 'taut-shim') {
      const isUpToDate = appAsarInfo.patchVersion === PATCH_VERSION
      const statusText = isUpToDate
        ? ''
        : `, outdated, latest is v${PATCH_VERSION}`
      console.log(
        `   Taut installed: Yes (shim v${
          appAsarInfo.patchVersion ?? '?'
        }${statusText})`
      )
    } else {
      console.log('   Taut installed: No')
    }
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
      const answer = await askYesNo(`Install Taut?`)
      if (answer) {
        await install(resourcesDir)
      } else {
        console.log('❌ Installation cancelled by user.')
      }
    } finally {
      rl.close()
    }
  } else if (action === 'uninstall') {
    await uninstall(resourcesDir)
  } else if (action === 'status') {
    // Check asar files and their versions

    /**
     * @param {string} label
     * @param {string} asarPath
     */
    const printAppAsarInfo = async (label, asarPath) => {
      if (!existsSync(asarPath)) {
        console.log(`${label}: Not present`)
        return
      }
      const asarInfo = await getAsarInfo(asarPath)

      if (asarInfo && asarInfo.name === 'taut-shim') {
        const isUpToDate = asarInfo.patchVersion === PATCH_VERSION
        const statusText = isUpToDate ? 'up to date' : 'outdated'
        console.log(
          `${label}: Taut shim v${asarInfo.patchVersion ?? '?'} (${statusText})`
        )
        return
      }
      if (existsSync(path.join(resourcesDir, 'inject.js'))) {
        // This app.asar likely has Snail injected
        // https://github.com/espcaa/snail/blob/main/app/logic/install.go#L87
        console.log(
          `${label}: Snail + Slack v${asarInfo?.version || '<unknown>'}`
        )
        console.log(`${label}  https://github.com/espcaa/snail`)
        console.log(
          `${label}  (Taut may be compatible with Snail, but this configuration is not officially supported)`
        )
        return
      }
      if (asarInfo && asarInfo.name === 'slack-desktop') {
        console.log(`${label}: Slack v${asarInfo.version}`)
        return
      }
      console.log(`${label}: Unknown app ${asarInfo?.name || '<no name>'}`)
      if (asarInfo?.version)
        console.log(`${label}  version ${asarInfo.version}`)
    }

    const appAsar = path.join(resourcesDir, 'app.asar')
    printAppAsarInfo('app.asar', appAsar)
    const backupAsar = path.join(resourcesDir, '_app.asar')
    printAppAsarInfo('_app.asar', backupAsar)

    const fuses = await getBinaryFuses(getElectronBinary(resourcesDir))
    const enabledFuses = Object.entries(fuses ?? {})
      .filter(([fuse, enabled]) => enabled)
      .map(([fuse, enabled]) => fuse)

    console.log(
      `Electron fuses: ${
        enabledFuses.length > 0 ? enabledFuses.join(', ') : 'none'
      }`
    )
    console.log()
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
