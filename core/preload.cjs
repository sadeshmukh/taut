// Taut Preload Script (The Bridge)
// Injected into the renderer process as a custom preload script by main.cjs
// Exposes TautAPI to the renderer and loads the original Slack preload

const { contextBridge, ipcRenderer } = require('electron')
/** @import { TautPluginConfig } from './main.cjs' */

console.log('[Taut] Preload loaded')

/** @typedef {typeof TautAPI} TautAPI */

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
