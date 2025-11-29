// @ts-ignore
globalThis.self = globalThis
const {
  /** @type {(wasmPath: string) => Promise<void>} */ initEsbuild,
  /** @type {(entryPath: string) => Promise<string>} */ bundle,
  /** @type {() => Promise<void>} */ stopEsbuild,
  // @ts-ignore
} = require('./deps/deps.bundle.js')
const fs = require('node:fs')
const path = require('node:path')

// build all the plugins in the ./plugins directory
async function getPlugins() {
  const plugins = []
  try {
    console.log('!!! bundling plugins')
    const esbuildInitPromise = initEsbuild(
      path.join(__dirname, 'deps/esbuild.wasm')
    )

    const pluginsConfigPath = path.join(__dirname, 'plugins.json')
    let enabledPlugins = null
    try {
      if (fs.existsSync(pluginsConfigPath)) {
        const config = JSON.parse(fs.readFileSync(pluginsConfigPath, 'utf8'))
        if (Array.isArray(config.enabled)) {
          enabledPlugins = new Set(config.enabled)
        }
      }
    } catch (e) {
      console.error('Error reading plugins.json', e)
    }

    const pluginFiles = (
      await fs.promises.readdir(path.join(__dirname, 'plugins'), {
        withFileTypes: true,
      })
    )
      .filter((dirent) => {
        if (!dirent.isFile()) return false
        if (enabledPlugins) {
          return enabledPlugins.has(dirent.name)
        }
        return true
      })
      .map((dirent) => path.join(dirent.parentPath, dirent.name))
    console.log('!!! found plugin files:', pluginFiles)

    await esbuildInitPromise
    for (const file of pluginFiles) {
      console.log('!!! bundling plugin:', file)
      const bundled = await bundle(file)
      console.log('!!! bundled plugin:', file, bundled.slice(0, 100))
      plugins.push({ name: path.basename(file), code: bundled })
    }
    await stopEsbuild()
    console.log('!!! finished bundling plugins')
  } catch (err) {
    console.error('!!! error bundling plugins:', err)
  }
  return plugins
}

module.exports = { getPlugins }
