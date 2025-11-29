// Taut Main Process
// Wraps Electron modules to inject custom behavior into Slack
// Loaded by the app.asar shim patched into Slack

const Module = require('module')
const fs = require('fs')
const path = require('path')
const electron = require('electron')

// @ts-ignore
globalThis.self = globalThis
/** @type {typeof import('./deps.ts')} */
const deps = require('./deps/deps.bundle.js')
const { initEsbuild, bundle, stopEsbuild, parseJSONC } = deps

// Path to the taut directory (where this file lives when installed)
const TAUT_DIR = path.join(__dirname, '..')
const PLUGINS_DIR = path.join(TAUT_DIR, 'plugins')
const USER_PLUGINS_DIR = path.join(TAUT_DIR, 'user-plugins')
const CONFIG_PATH = path.join(TAUT_DIR, 'config.jsonc')
const WASM_PATH = path.join(TAUT_DIR, 'core', 'deps', 'esbuild.wasm')
const CLIENT_JS_PATH = path.join(TAUT_DIR, 'core', 'client.js')

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
 * @typedef {Object} TautConfig
 * @property {Record<string, ({ enabled: boolean } & Record<string, unknown>) | unknown>} plugins
 */

/**
 * Read the config file, or return default config if it doesn't exist
 * @returns {TautConfig}
 */
function readConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      const contents = fs.readFileSync(CONFIG_PATH, 'utf8')
      return parseJSONC(contents)
    }
  } catch (err) {
    console.error('[Taut] Failed to read config:', err)
  }
  return { plugins: {} }
}

/**
 * Scan a directory for plugin files
 * @param {string} dir
 * @returns {string[]} Array of absolute paths to plugin files
 */
function scanPluginDir(dir) {
  /** @type {string[]} */
  const plugins = []
  try {
    if (!fs.existsSync(dir)) return plugins
    const files = fs.readdirSync(dir)
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
      await initEsbuild(WASM_PATH)
      esbuildInitialized = true
    }

    const config = readConfig()
    const pluginConfigs = config.plugins || {}

    // Scan both plugin directories
    const pluginFiles = [
      ...scanPluginDir(PLUGINS_DIR),
      ...scanPluginDir(USER_PLUGINS_DIR),
    ]
    console.log(
      `[Taut] Found ${pluginFiles.length} plugin files:`,
      pluginFiles,
      PLUGINS_DIR,
      USER_PLUGINS_DIR
    )

    for (const filePath of pluginFiles) {
      const name = getPluginName(filePath)
      const pluginConfig = pluginConfigs[name]

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
        originalPreloadContents = fs.readFileSync(originalPreloadPath, 'utf8')
        console.log('[Taut] Cached original preload from:', originalPreloadPath)
      } catch (err) {
        console.error('[Taut] Failed to read original preload:', err)
        originalPreloadContents = null
      }
    }

    // Use our custom preload
    options.webPreferences.preload = require.resolve('./preload.cjs')

    BROWSER = Reflect.construct(target, [options], newTarget)
    if (!BROWSER) {
      throw new Error('Failed to create BrowserWindow')
    }

    // Inject client.js on page load
    BROWSER.webContents.on('did-finish-load', async () => {
      try {
        if (fs.existsSync(CLIENT_JS_PATH)) {
          const clientJs = fs.readFileSync(CLIENT_JS_PATH, 'utf8')
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
