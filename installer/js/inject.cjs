// Wraps Electron modules to inject custom behavior into Slack
// Loaded by the app.asar shim patched into Slack

const Module = require('module')
const fs = require('fs')
const electron = require('electron')

const { getPlugins } = require('./plugins.cjs')

/**
 * Cache for the original Slack preload script contents
 * @type {string | null}
 */
let originalPreloadContents = null

// IPC handler for renderer to request original preload contents
electron.ipcMain.handle('taut:get-original-preload', () => {
  return originalPreloadContents
})

// IPC handler for renderer to request plugins
electron.ipcMain.handle('taut:get-plugins', async () => {
  return await getPlugins()
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
 * Keys are in the format '<module>.ClassName.<constructor>' or '<module>.ClassName.methodName'
 * @type {Map<string, Function>}
 */
const redirected = new Map()
// Inject our script
redirected.set(
  '<electron>.BrowserWindow.<constructor>',
  /**
   * Redirect for BrowserWindow constructor to inject our script
   * @param {typeof electron.BrowserWindow} target - The original BrowserWindow constructor
   * @param {[electron.BrowserWindowConstructorOptions?]} args - Constructor arguments
   * @param {Function} newTarget - The new.target value
   * @returns {electron.BrowserWindow} The constructed BrowserWindow instance
   */
  (target, [options], newTarget) => {
    console.log('!!! constructing window', options)
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
        console.log('!!! read original preload from', originalPreloadPath)
      } catch (err) {
        console.error('!!! failed to read original preload', err)
        originalPreloadContents = null
      }
    }

    options.webPreferences.preload = require.resolve('./preload.cjs')

    console.log('!!! final opts', options)

    BROWSER = Reflect.construct(target, [options], newTarget)
    if (!BROWSER) {
      throw new Error('Failed to create BrowserWindow')
    }

    return BROWSER
  }
)

// redirected.set(
//   '<electron>.app.enableSandbox',
//   /**
//    * Redirect for app.enableSandbox to be a no-op
//    * @param {Function} target - The original enableSandbox function
//    * @param {any} thisArg - The this context
//    * @param {[]} argArray - Function arguments
//    */
//   (target, thisArg, argArray) => {
//     console.log('!!! app.enableSandbox called - no-op')
//   }
// )

// // contextBridge is incompatible with nodeIntegration: true
// // we fake it instead
// redirected.set(
//   '<electron>.contextBridge.exposeInMainWorld',
//   /**
//    * Redirect for contextBridge.exposeInMainWorld
//    * @param {Function} target - The original exposeInMainWorld function
//    * @param {any} thisArg - The this context
//    * @param {[string, any]} argArray - Function arguments
//    */
//   (target, thisArg, [apiKey, api]) => {
//     console.log(
//       '!!! contextBridge.exposeInMainWorld called',
//       apiKey
//     )
//     // @ts-ignore
//     global[apiKey] = api
//   }
// )
// redirected.set(
//   '<electron>.contextBridge.exposeInIsolatedWorld',
//   /**
//    * Redirect for contextBridge.exposeInIsolatedWorld
//    * @param {Function} target - The original exposeInIsolatedWorld function
//    * @param {any} thisArg - The this context
//    * @param {[number, string, any]} argArray - Function arguments
//    */
//   (target, thisArg, [worldId, apiKey, api]) => {
//     console.log(
//       '!!! contextBridge.exposeInIsolatedWorld called',
//       worldId,
//       apiKey
//     )
//     // @ts-ignore
//     global[apiKey] = api
//   }
// )
// redirected.set(
//   '<electron>.contextBridge.executeInMainWorld',
//   /**
//    * Redirect for contextBridge.executeInMainWorld
//    * @param {Function} target - The original executeInMainWorld function
//    * @param {any} thisArg - The this context
//    * @param {[{func: Function, args: any[]}]} argArray - Function arguments
//    */
//   (target, thisArg, [{func, args}]) => {
//     console.log(
//       '!!! contextBridge.executeInMainWorld called',
//       func,
//       args
//     )
//     return func(...args)
//   }
// )

// Use a custom application menu to add Taut options
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

// Code to create the Proxy wrappers

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
