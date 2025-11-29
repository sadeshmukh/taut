// Taut Preload Script (The Bridge)
// Injected into the renderer process as a custom preload script by main.cjs
// Exposes TautAPI to the renderer and loads the original Slack preload

const { contextBridge, ipcRenderer } = require('electron')
/** @import { TautPluginConfig } from './main.cjs' */

console.log('[Taut] Preload loaded')

/** @typedef {typeof TautAPI} TautAPI */

// user.css style element management
const TAUT_USER_CSS_ID = 'taut-user-css-style'

/** @type {string} */
let currentUserCss = ''

/** @type {MutationObserver | null} */
let userCssObserver = null

/**
 * Get or create the user.css style element
 * @returns {HTMLStyleElement}
 */
function getOrCreateUserCssStyle() {
  let style = document.getElementById(TAUT_USER_CSS_ID)
  if (!style) {
    style = document.createElement('style')
    style.id = TAUT_USER_CSS_ID
    style.textContent = currentUserCss
    document.head.appendChild(style)
    console.log('[Taut] Created user.css style element')
  }
  return /** @type {HTMLStyleElement} */ (style)
}

/**
 * Ensure the user.css style element exists and has correct content
 */
function ensureUserCssStyle() {
  const style = getOrCreateUserCssStyle()
  if (style.textContent !== currentUserCss) {
    style.textContent = currentUserCss
  }
}

/**
 * Start observing for user.css element removal
 */
function startUserCssObserver() {
  if (userCssObserver) return

  // Observe document.head for child removal
  userCssObserver = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      const removedNodes = Array.from(mutation.removedNodes)
      for (const node of removedNodes) {
        if (node instanceof HTMLElement && node.id === TAUT_USER_CSS_ID) {
          console.log('[Taut] user.css style was removed, restoring...')
          ensureUserCssStyle()
          return
        }
      }
    }
  })

  // Start observing when head is ready
  if (document.head) {
    userCssObserver.observe(document.head, { childList: true })
  }
}

/**
 * Update the user.css content
 * @param {string} css - The new CSS content
 */
function updateUserCss(css) {
  currentUserCss = css
  
  // Wait for DOM to be ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      ensureUserCssStyle()
      startUserCssObserver()
    }, { once: true })
  } else {
    ensureUserCssStyle()
    startUserCssObserver()
  }
}

// Listen for user.css changes from main process
ipcRenderer.on('taut:user-css-changed', (event, css) => {
  console.log('[Taut] Received user.css update')
  updateUserCss(css)
})

// Re-inject styles on page navigation (did-navigate)
// The preload script runs fresh on each navigation, but we store CSS in memory
// Also handle the case where head is replaced
const headObserver = new MutationObserver(() => {
  if (document.head && !document.getElementById(TAUT_USER_CSS_ID)) {
    ensureUserCssStyle()
    startUserCssObserver()
  }
})

// Start observing document for head changes
if (document.documentElement) {
  headObserver.observe(document.documentElement, { childList: true })
}

// Expose TautAPI to the renderer world
const TautAPI = {
  /**
   * Ask the main process to start sending plugins and configs
   * @returns {Promise<void>}
   */
  startPlugins: () => ipcRenderer.invoke('taut:start-plugins'),

  /**
   * Subscribe to config changes with a callback
   * @param {(name: string, newConfig: TautPluginConfig) => void} callback - Callback to invoke on config changes
   */
  onConfigChange: (callback) => {
    ipcRenderer.on(
      'taut:config-changed',
      /**
       * @param {Electron.IpcRendererEvent} event
       * @param {string} name - Plugin name
       * @param {TautPluginConfig} newConfig - New plugin configuration
       */
      (event, name, newConfig) => {
        callback(name, newConfig)
      }
    )
  },

  /**
   * Log to stdout, not the browser console
   * @param {...any} args - Arguments to log
   */
  logMain: (...args) => {
    console.log('[Taut]', ...args)
  },
}
contextBridge.exposeInMainWorld('TautAPI', TautAPI)

// Request and eval the original Slack preload script from the main process
;(async () => {
  try {
    const originalPreload = await ipcRenderer.invoke(
      'taut:get-original-preload'
    )
    if (originalPreload) {
      console.log('[Taut] Evaluating original Slack preload script')
      eval(originalPreload)
    }
  } catch (err) {
    console.error('[Taut] Failed to load original preload:', err)
  }
})()
