// Taut Main Process
// Wraps Electron modules to inject custom behavior into Slack
// Loaded by the app.asar shim patched into Slack

const Module = require('module')
const { promises: fs, watchFile, watch, readFileSync } = require('fs')
const path = require('path')
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
const ESBUILD_WASM_PATH = path.join(TAUT_DIR, 'core', 'main', 'deps', 'esbuild.wasm')
const PRELOAD_JS_PATH = path.join(TAUT_DIR, 'core', 'preload', 'preload.cjs')
const CLIENT_JS_PATH = path.join(TAUT_DIR, 'core', 'renderer', 'client.js')

/** @type {boolean} */
let esbuildInitialized = false

/** Supported plugin file extensions */
const PLUGIN_EXTENSIONS = ['.js', '.cjs', '.mjs', '.ts', '.cts', '.mts']

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

      // Check if file exists (it might have been deleted)
      if (!(await fileExists(filePath))) {
        console.log(`[Taut] Plugin file deleted: ${filename}`)
        return
      }

      if (!esbuildInitialized) {
        await initEsbuild(ESBUILD_WASM_PATH)
        esbuildInitialized = true
      }

      await bundleAndSendPlugin(filePath)
    })
  } catch (err) {
    console.error(`[Taut] Failed to watch plugin dir ${dir}:`, err)
  }
}

/**
 * Scan a directory for plugin files
 * @param {string} dir
 * @returns {Promise<string[]>} Array of absolute paths to plugin files
 */
async function scanPluginDir(dir) {
  /** @type {string[]} */
  const plugins = []
  try {
    if (!(await fileExists(dir))) return plugins
    const files = await fs.readdir(dir)
    for (const file of files) {
      const ext = path.extname(file)
      if (PLUGIN_EXTENSIONS.includes(ext)) {
        plugins.push(path.join(dir, file))
      }
    }
  } catch (err) {
    console.error(`[Taut] Failed to scan plugin dir ${dir}:`, err)
  }
  return plugins
}

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
    // Initialize esbuild if not already done
    if (!esbuildInitialized) {
      await initEsbuild(ESBUILD_WASM_PATH)
      esbuildInitialized = true
    }

    // Read and store config
    config = await readConfig()

    // Scan both plugin directories
    const [corePlugins, userPlugins] = await Promise.all([
      scanPluginDir(PLUGINS_DIR),
      scanPluginDir(USER_PLUGINS_DIR),
    ])
    const pluginFiles = [...corePlugins, ...userPlugins]
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

// Handler: Get original preload contents (for preload.cjs)
electron.ipcMain.handle('taut:get-original-preload', () => {
  return originalPreloadContents
})

/**
 * Hold the primary Slack BrowserWindow so we can inject scripts once ready
 * @type {electron.BrowserWindow | undefined}
 */
let BROWSER

/**
 * List of module name patterns to intercept and wrap
 * @type {RegExp[]}
 */
const modules = [/^electron.*$/]

/**
 * Map of function paths to their redirect handlers
 * @type {Map<string, Function>}
 */
const redirected = new Map()

// Redirect BrowserWindow constructor to inject our preload and setup CSP stripping
redirected.set(
  '<electron>.BrowserWindow.<constructor>',
  /**
   * @param {typeof electron.BrowserWindow} target
   * @param {[electron.BrowserWindowConstructorOptions?]} args
   * @param {Function} newTarget
   * @returns {electron.BrowserWindow}
   */
  (target, [options], newTarget) => {
    console.log('[Taut] Constructing BrowserWindow')
    if (typeof options !== 'object') {
      options = {}
    }
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

    BROWSER = Reflect.construct(target, [options], newTarget)
    if (!BROWSER) {
      throw new Error('Failed to create BrowserWindow')
    }

    // Inject client.js on page load
    BROWSER.webContents.on('did-finish-load', async () => {
      try {
        if (await fileExists(CLIENT_JS_PATH)) {
          const clientJs = await fs.readFile(CLIENT_JS_PATH, 'utf8')
          console.log('[Taut] Injecting client.js')
          await BROWSER?.webContents.executeJavaScript(clientJs)
        } else {
          console.error('[Taut] client.js not found at:', CLIENT_JS_PATH)
        }
      } catch (err) {
        console.error('[Taut] Failed to inject client.js:', err)
      }
    })

    return BROWSER
  }
)

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
redirected.set(
  '<electron>.Menu.setApplicationMenu',
  /**
   * Redirect for Menu.setApplicationMenu to be a no-op
   * @param {Function} target - The original setApplicationMenu function
   * @param {any} thisArg - The this context
   * @param {[electron.Menu | null]} argArray - Function arguments
   */
  (target, thisArg, argArray) => {}
)

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

// Proxy wrapper code

/** Marker that allows us to detect and unwrap our Proxy instances. */
const PROXIED = Symbol('taut:proxied')
/**
 * Detects if a value is a Proxy created by our wrap function
 * @param {any} val
 * @returns {boolean}
 */
function isProxied(val) {
  if (!(typeof val === 'object' || typeof val === 'function')) return false
  const prototype = Reflect.getPrototypeOf(val)
  return (
    Reflect.has(val, PROXIED) && !(prototype && Reflect.has(prototype, PROXIED))
  )
}
/**
 * Unwraps a value if it is a Proxy created by our wrap function
 * @param {any} val
 * @returns {any}
 */
function unproxy(val) {
  return isProxied(val) ? val[PROXIED] : val
}
/**
 * Converts a property key to a string for logging
 * @param {string|symbol} p
 * @returns {string}
 */
function prop(p) {
  return typeof p === 'symbol' ? p.toString() : p
}

/**
 * Recursively wraps objects in a Proxy, keeping track of the access path in `log`
 * Based on the access path, function calls and constructors can be redirected
 * @template T
 * @param {T} obj - The object or function to wrap
 * @param {string} log - The current access path for logging and redirect lookup
 * @returns {T} The wrapped proxy or the original value if not wrappable
 */
function wrap(obj, log) {
  if (
    !((typeof obj === 'object' && obj !== null) || typeof obj === 'function')
  ) {
    return obj
  }

  return new Proxy(obj, {
    get(target, p, receiver) {
      const newLog = `${log}.${prop(p)}`

      if (p === PROXIED) return target

      receiver = unproxy(receiver)
      const val = Reflect.get(target, p, receiver)
      const desc = Reflect.getOwnPropertyDescriptor(target, p)
      if (desc && desc.configurable === false && desc.writable === false) {
        return val
      }

      return wrap(val, newLog)
    },

    has(target, p) {
      if (p === PROXIED) return true
      return Reflect.has(target, p)
    },

    set(target, p, newValue, receiver) {
      return Reflect.set(target, p, newValue, unproxy(receiver))
    },

    apply(target, thisArg, argArray) {
      const handler = redirected.get(log)
      const normalizedThis = unproxy(thisArg)
      if (handler) {
        // @ts-ignore - handler types are dynamic
        return handler(target, normalizedThis, argArray)
      }
      // @ts-ignore - target is known to be callable at this point
      return Reflect.apply(target, normalizedThis, argArray)
    },

    construct(target, argArray, newTarget) {
      try {
        const constructorLog = `${log}.<constructor>`
        if (redirected.has(constructorLog)) {
          const handler = redirected.get(constructorLog)
          if (handler) {
            // @ts-ignore - handler types are dynamic
            return handler(target, argArray, newTarget)
          }
        }
        // @ts-ignore - target is known to be constructable at this point
        return Reflect.construct(target, argArray, newTarget)
      } catch (err) {
        console.warn(`taut loader construct ${log} failed`, err)
      }
    },
  })
}

// @ts-ignore - Module._load is an internal Node.js API
const oldLoad = Module._load

/**
 * Override for Module._load to wrap electron modules before they are exposed
 * @param {string} request - The module request string
 * @param {NodeJS.Module} parent - The parent module
 * @param {boolean} isMain - Whether this is the main module
 * @returns {any} The module exports, potentially wrapped
 */
function _load(request, parent, isMain) {
  // @ts-ignore - using arguments for proper this binding
  const exports = oldLoad.apply(this, arguments)
  if (modules.some((x) => x.test(request))) {
    return wrap(exports, `<${request}>`)
  }
  return exports
}

// @ts-ignore - Module._load is an internal Node.js API
Module._load = _load
