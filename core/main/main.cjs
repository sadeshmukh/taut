// Taut Main Process
// Wraps Electron modules to inject custom behavior into Slack
// Loaded by the app.asar shim patched into Slack

console.log('[Taut] Starting Taut')

const { promises: fs, watchFile, watch, readFileSync } = require('fs')
const path = require('path')
const Module = require('module')
const electron = require('electron')

// @ts-ignore
globalThis.self = globalThis
/** @type {typeof import('./deps.js')} */
const deps = require('./deps/deps.bundle.js')
const { initEsbuild, bundle, stopEsbuild, parseJSONC } = deps

// Path to the taut directory (where this file lives when installed)
const TAUT_DIR = path.join(__dirname, '..', '..')
const PLUGINS_DIR = path.join(TAUT_DIR, 'plugins')
const USER_PLUGINS_DIR = path.join(TAUT_DIR, 'user-plugins')
const CONFIG_PATH = path.join(TAUT_DIR, 'config.jsonc')
const USER_CSS_PATH = path.join(TAUT_DIR, 'user.css')
const ESBUILD_WASM_PATH = path.join(
  TAUT_DIR,
  'core',
  'main',
  'deps',
  'esbuild.wasm'
)
const PRELOAD_JS_PATH = path.join(TAUT_DIR, 'core', 'preload', 'preload.js')
const CLIENT_JS_PATH = path.join(TAUT_DIR, 'core', 'renderer', 'client.js')

const esbuildInitialized = initEsbuild(ESBUILD_WASM_PATH)

/** Supported plugin file extensions */
const PLUGIN_EXTENSIONS = [
  '.js',
  '.cjs',
  '.mjs',
  '.jsx',
  '.ts',
  '.cts',
  '.mts',
  '.tsx',
]

/**
 * Cache for the original Slack preload script contents
 * @type {string | null}
 */
let originalPreloadContents = null

/**
 * @typedef {{ enabled: boolean } & Record<string, unknown>} TautPluginConfig
 */
/**
 * @typedef {Object} TautConfig
 * @property {Record<string, TautPluginConfig | undefined>} plugins
 */

/** @type {TautConfig} */
let config = { plugins: {} }

/**
 * Check if a path exists without throwing an exception
 * @param {string} filePath
 * @returns {Promise<boolean>}
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath)
    return true
  } catch {
    return false
  }
}

/**
 * Read the config file, or return default config if it doesn't exist
 * @returns {Promise<TautConfig>}
 */
async function readConfig() {
  try {
    if (await fileExists(CONFIG_PATH)) {
      const contents = await fs.readFile(CONFIG_PATH, 'utf8')
      return parseJSONC(contents)
    }
  } catch (err) {
    console.error('[Taut] Failed to read config:', err)
  }
  return { plugins: {} }
}

/**
 * Bundle a plugin file and send it to the renderer process
 * @param {string} filePath - Absolute path to the plugin file
 * @returns {Promise<void>}
 */
async function bundleAndSendPlugin(filePath) {
  const name = getPluginName(filePath)
  const pluginConfig = config.plugins[name] || { enabled: false }

  try {
    await esbuildInitialized
    const iife = await bundle(filePath)

    const code = `globalThis.__tautPluginManager.loadPlugin(${JSON.stringify(
      name
    )}, ${iife}.default, ${JSON.stringify(pluginConfig)})`
    if (!BROWSER) {
      throw new Error('Browser window not initialized')
    }
    await BROWSER.webContents.executeJavaScript(code)
    console.log(`[Taut] Plugin ${name} sent successfully`)
  } catch (err) {
    console.error(`[Taut] Failed to bundle plugin ${name}:`, err)
  }
}

/**
 * Check if a file has a valid plugin extension
 * @param {string} filename
 * @returns {boolean}
 */
function isValidPluginFile(filename) {
  const ext = path.extname(filename)
  return PLUGIN_EXTENSIONS.includes(ext)
}

/**
 * Start watching config file for changes
 */
function watchConfig() {
  console.log('[Taut] Watching config file:', CONFIG_PATH)
  watchFile(CONFIG_PATH, async () => {
    console.log('[Taut] Config file changed')
    const newConfig = await readConfig()
    const oldPluginConfigs = config.plugins || {}
    const newPluginConfigs = newConfig.plugins || {}

    // Check each plugin to see if its config changed
    const allPluginNames = new Set([
      ...Object.keys(oldPluginConfigs),
      ...Object.keys(newPluginConfigs),
    ])

    for (const name of allPluginNames) {
      const oldPluginConfig = oldPluginConfigs[name] || { enabled: false }
      const newPluginConfig = newPluginConfigs[name] || { enabled: false }

      if (!deepEqual(oldPluginConfig, newPluginConfig)) {
        console.log(`[Taut] Config changed for plugin: ${name}`)
        if (BROWSER) {
          BROWSER.webContents.send('taut:config-changed', name, newPluginConfig)
        }
      }
    }

    config = newConfig
  })
}

/**
 * Read the user.css file
 * @returns {Promise<string>} The user.css contents, or empty string if not found
 */
async function readUserCss() {
  try {
    if (await fileExists(USER_CSS_PATH)) {
      return await fs.readFile(USER_CSS_PATH, 'utf8')
    }
  } catch (err) {
    console.error('[Taut] Failed to read user.css:', err)
  }
  return ''
}

/**
 * Send user.css to the renderer
 */
async function sendUserCss() {
  const css = await readUserCss()
  if (BROWSER) {
    console.log('[Taut] Sending user.css')
    BROWSER.webContents.send('taut:user-css-changed', css)
  }
}

/**
 * Start watching user.css file for changes
 */
function watchUserCss() {
  console.log('[Taut] Watching user.css file:', USER_CSS_PATH)
  watchFile(USER_CSS_PATH, async () => {
    console.log('[Taut] user.css file changed')
    await sendUserCss()
  })
}

/**
 * Start watching a plugin directory for new/updated files
 * @param {string} dir - Directory to watch
 */
async function watchPluginDir(dir) {
  try {
    if (!(await fileExists(dir))) {
      console.log(`[Taut] Plugin directory does not exist, creating: ${dir}`)
      await fs.mkdir(dir, { recursive: true })
    }

    console.log('[Taut] Watching plugin directory:', dir)
    watch(dir, async (eventType, filename) => {
      if (!filename || !isValidPluginFile(filename)) return

      const filePath = path.join(dir, filename)
      console.log(`[Taut] Plugin file ${eventType}: ${filename}`)

      await handlePluginFileChange(filePath)
    })
  } catch (err) {
    console.error(`[Taut] Failed to watch plugin dir ${dir}:`, err)
  }
}

/**
 * Scan directories and generate a map of active plugins
 * Prioritizes user plugins over core plugins
 * Prioritizes extensions based on PLUGIN_EXTENSIONS order
 * @returns {Promise<Map<string, string>>} Map of plugin name -> absolute file path
 */
async function getPluginMap() {
  const pluginMap = new Map()

  // Helper to process a directory
  /**
   * @param {string} dir
   */
  const processDir = async (dir) => {
    if (!(await fileExists(dir))) return

    const files = await fs.readdir(dir)
    const pluginsInDir = new Map() // name -> { extIndex, path }

    for (const file of files) {
      const ext = path.extname(file)
      const extIndex = PLUGIN_EXTENSIONS.indexOf(ext)
      if (extIndex === -1) continue

      const name = path.basename(file, ext)
      const filePath = path.resolve(dir, file)

      // If we haven't seen this plugin in this dir yet, or if this file has higher priority extension
      // (lower index) than what we've seen, store it
      if (
        !pluginsInDir.has(name) ||
        pluginsInDir.get(name).extIndex > extIndex
      ) {
        pluginsInDir.set(name, { extIndex, path: filePath })
      }
    }

    // Add to main map
    for (const [name, info] of pluginsInDir) {
      pluginMap.set(name, info.path)
    }
  }

  // Process core first, then user (so user overrides)
  await processDir(PLUGINS_DIR)
  await processDir(USER_PLUGINS_DIR)

  return pluginMap
}

/**
 * Handle file changes in plugin directories
 * @param {string} changedFilePath - Absolute path to the changed file
 */
async function handlePluginFileChange(changedFilePath) {
  const oldPluginMap = currentPluginMap
  const newPluginMap = await getPluginMap()
  currentPluginMap = newPluginMap

  /** @type {Set<string>} */
  const pluginsToLoad = new Set()

  // If the changed file is the active version, load it
  const changedName = getPluginName(changedFilePath)
  const activePath = newPluginMap.get(changedName)
  if (activePath === changedFilePath) {
    pluginsToLoad.add(activePath)
  } else {
    console.log(
      `[Taut] Changed file ${changedFilePath} is not the active version for plugin ${changedName}, skipping load`
    )
  }

  // Any other differences
  for (const [name, newPath] of newPluginMap) {
    const oldPath = oldPluginMap.get(name)
    if (oldPath !== newPath) {
      pluginsToLoad.add(newPath)
      console.log(
        `[Taut] Plugin resolution changed for ${name}: ${oldPath} -> ${newPath}`
      )
    }
  }

  // Bundle and send all affected plugins
  for (const filePath of pluginsToLoad) {
    await bundleAndSendPlugin(filePath)
  }
}

/** @type {Map<string, string>} */
let currentPluginMap = new Map()

/**
 * Get plugin name from file path
 * @param {string} filePath
 * @returns {string}
 */
function getPluginName(filePath) {
  return path.basename(filePath, path.extname(filePath))
}

// IPC Handlers

// Handler: Get all plugins (scans, compiles, returns code + config)
electron.ipcMain.handle('taut:start-plugins', async () => {
  console.log('[Taut] Starting plugins')
  try {
    // Read and store config
    config = await readConfig()

    // Generate initial plugin map
    currentPluginMap = await getPluginMap()
    const pluginFiles = [...currentPluginMap.values()]

    console.log(
      `[Taut] Found ${pluginFiles.length} plugin files:`,
      pluginFiles,
      PLUGINS_DIR,
      USER_PLUGINS_DIR
    )

    for (const filePath of pluginFiles) {
      await bundleAndSendPlugin(filePath)
    }

    // Start watching for changes
    watchConfig()
    watchUserCss()
    watchPluginDir(PLUGINS_DIR)
    watchPluginDir(USER_PLUGINS_DIR)

    // Send initial user.css
    await sendUserCss()

    console.log(`[Taut] Started plugins`)
  } catch (err) {
    console.error('[Taut] Failed to get plugins:', err)
    return []
  }
})

// Handler: Get original preload contents (for preload.js)
electron.ipcMain.handle('taut:get-original-preload', () => {
  return originalPreloadContents
})

/**
 * Hold the primary Slack BrowserWindow so we can inject scripts once ready
 * @type {electron.BrowserWindow | undefined}
 */
let BROWSER

const proxiedBrowserWindow = new Proxy(electron.BrowserWindow, {
  /**
   * @param {typeof electron.BrowserWindow} target
   * @param {[Electron.BrowserWindowConstructorOptions]} arguments
   * @returns {electron.BrowserWindow}
   */
  construct(target, [ options ]) {
    console.log('[Taut] Constructing BrowserWindow')
    if (!options.webPreferences) {
      options.webPreferences = {}
    }
    options.webPreferences.devTools = true

    // Read and cache the original preload script contents
    const originalPreloadPath = options.webPreferences.preload || ''
    if (originalPreloadPath) {
      try {
        // Needs to be sync because we want to get this ready before giving control back to Slack
        originalPreloadContents = readFileSync(originalPreloadPath, 'utf8')
        console.log('[Taut] Cached original preload from:', originalPreloadPath)
      } catch (err) {
        console.error('[Taut] Failed to read original preload:', err)
        originalPreloadContents = null
      }
    }

    // Use our custom preload
    options.webPreferences.preload = PRELOAD_JS_PATH

    const instance = new target(options)
    BROWSER = instance

    // Inject client.js on page load
    instance.webContents.on('did-finish-load', async () => {
      try {
        if (await fileExists(CLIENT_JS_PATH)) {
          const clientJs = await fs.readFile(CLIENT_JS_PATH, 'utf8')
          console.log('[Taut] Injecting client.js')
          await instance.webContents.executeJavaScript(clientJs)
        } else {
          console.error('[Taut] client.js not found at:', CLIENT_JS_PATH)
        }
      } catch (err) {
        console.error('[Taut] Failed to inject client.js:', err)
      }
    })

    return instance
  },
})

/** @typedef {(request: string, parent: Module, isMain: boolean) => object} ModuleLoadFunction */
/** @type {ModuleLoadFunction} */
// @ts-ignore
const originalLoad = Module._load
/** @type {ModuleLoadFunction} */
// @ts-ignore
Module._load = function(request, parent, isMain) {
  // only intercept 'electron'
  const originalExports = originalLoad.apply(this, [request, parent, isMain])
  if (request === 'electron') {
    console.log('[Taut] electron module loaded, wrapping in a Proxy')
    const newExports = new Proxy(originalExports, {
      get(target, prop, receiver) {
        if (prop === 'BrowserWindow') {
          console.log('[Taut] Returning proxied BrowserWindow')
          return proxiedBrowserWindow
        }
        return Reflect.get(target, prop, receiver)
      },
    })
    return newExports
  }
  return originalExports
}

// Allow all CORS requests by setting ACAO header to https://app.slack.com
// Doesn't modifiy requests from iframes for security but also to not break them
electron.app.whenReady().then(() => {
  /**
   * Stores the origin for each request ID
   * @type {Map<number, {origin: string | null, requestedMethod: string | null, requestedHeaders: string | null}>}
   **/
  const requestMap = new Map()

  electron.session.defaultSession.webRequest.onBeforeSendHeaders(
    (details, callback) => {
      const getHeader = (/** @type {string} */ headerName) => {
        const foundKey = Object.keys(details.requestHeaders).find(
          (key) => key.toLowerCase() === headerName.toLowerCase()
        )
        return foundKey ? details.requestHeaders[foundKey] : null
      }
      requestMap.set(details.id, {
        origin: getHeader('origin'),
        requestedMethod: getHeader('access-control-request-method'),
        requestedHeaders: getHeader('access-control-request-headers'),
      })
      // Clean up after 5 minutes to avoid memory leaks
      setTimeout(() => requestMap.delete(details.id), 5 * 60 * 1000)

      callback({})
    }
  )
  electron.session.defaultSession.webRequest.onHeadersReceived(
    (details, callback) => {
      const responseHeaders = details.responseHeaders || {}
      let shouldModify = false

      if (details.frame) {
        try {
          const frameOrigin = new URL(details.frame.url).origin
          if (frameOrigin === 'https://app.slack.com') {
            shouldModify = true
          }
        } catch {
          // Ignore URL parsing errors
        }
      }

      if (shouldModify) {
        const requestInfo = requestMap.get(details.id)
        requestMap.delete(details.id)

        // Remove existing headers (case-insensitive)
        const deleteHeader = (/** @type {string} */ headerName) => {
          Object.keys(responseHeaders).forEach((key) => {
            if (key.toLowerCase() === headerName.toLowerCase()) {
              delete responseHeaders[key]
            }
          })
        }
        deleteHeader('Access-Control-Allow-Origin')
        deleteHeader('Access-Control-Allow-Methods')
        deleteHeader('Access-Control-Allow-Headers')
        deleteHeader('Access-Control-Expose-Headers')
        deleteHeader('Vary')
        deleteHeader('X-Frame-Options')

        const responseHeaderNames = Object.keys(responseHeaders).join(', ')

        responseHeaders['Access-Control-Allow-Origin'] = [
          requestInfo?.origin ?? 'https://app.slack.com',
        ]
        if (requestInfo?.requestedMethod) {
          responseHeaders['Access-Control-Allow-Methods'] = [
            requestInfo.requestedMethod,
          ]
        }
        if (requestInfo?.requestedHeaders) {
          responseHeaders['Access-Control-Allow-Headers'] = [
            requestInfo.requestedHeaders,
          ]
        }
        responseHeaders['Access-Control-Expose-Headers'] = [responseHeaderNames]
        responseHeaders['Vary'] = ['Origin']
      }
      callback({ responseHeaders })
    }
  )
})

// Custom application menu with Taut options
electron.Menu.setApplicationMenu(
  electron.Menu.buildFromTemplate(
    /** @type {electron.MenuItemConstructorOptions[]} */ ([
      ...(process.platform === 'darwin' ? [{ role: 'appMenu' }] : []),
      { role: 'fileMenu' },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      { role: 'windowMenu' },
      {
        label: 'Taut',
        submenu: [
          {
            label: 'About Taut',
            click: async () => {
              await electron.shell.openExternal(
                'https://github.com/jeremy46231/taut'
              )
            },
          },
          { type: 'separator' },
          {
            role: 'toggleDevTools',
            accelerator: 'CmdOrCtrl+Alt+I',
          },
          { role: 'reload' },
          { role: 'forceReload' },
          {
            label: 'Quit',
            role: 'quit',
          },
        ],
      },
      {
        role: 'help',
        submenu: [
          {
            label: 'Open #taut',
            click: async () => {
              await electron.shell.openExternal(
                'slack://channel?team=T0266FRGM&id=C0A057686SF'
              )
            },
          },
          {
            label: 'Open Taut GitHub',
            click: async () => {
              await electron.shell.openExternal(
                'https://github.com/jeremy46231/taut'
              )
            },
          },
        ],
      },
    ])
  )
)
// Redirect for Menu.setApplicationMenu to be a no-op
electron.Menu.setApplicationMenu = () => {}

/**
 * Deep equality for JSON-serializable values
 * @param {unknown} left - first value to compare
 * @param {unknown} right - second value to compare
 * @returns {boolean} true if values are deeply equal
 */
function deepEqual(left, right) {
  if (left === right) return true
  if (Number.isNaN(left) && Number.isNaN(right)) return true
  if (left == null || right == null) return false
  if (typeof left !== typeof right) return false
  if (typeof left !== 'object') return left === right

  if (Array.isArray(left) && Array.isArray(right)) {
    if (left.length !== right.length) return false
    for (let i = 0; i < left.length; i++) {
      if (!deepEqual(left[i], right[i])) return false
    }
    return true
  }
  if (Array.isArray(left) !== Array.isArray(right)) return false

  let keyCount = 0
  for (const key in left) {
    if (Object.prototype.hasOwnProperty.call(left, key)) {
      keyCount++
      if (!Object.prototype.hasOwnProperty.call(right, key)) return false
      // @ts-ignore
      if (!deepEqual(left[key], right[key])) return false
    }
  }
  return Object.keys(right).length === keyCount
}
