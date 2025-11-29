// Taut Preload Script (The Bridge)
// Injected into the renderer process as a custom preload script by main.cjs
// Exposes TautAPI to the renderer and loads the original Slack preload

const { contextBridge, ipcRenderer } = require('electron')

console.log('[Taut] Preload loaded')

/** @typedef {typeof TautAPI} TautAPI */

// Expose TautAPI to the renderer world
const TautAPI = {
  /**
   * Start the plugins system, ask the main process to send plugins
   * @returns {Promise<void>}
   */
  startPlugins: () => ipcRenderer.invoke('taut:start-plugins'),
  
  /**
   * Log a message (goes to both console and could be extended)
   * @param {...any} args - Arguments to log
   */
  log: (...args) => {
    console.log('[Taut]', ...args)
  },
}
contextBridge.exposeInMainWorld('TautAPI', TautAPI)


// Request and eval the original Slack preload script from the main process
;(async () => {
  try {
    const originalPreload = await ipcRenderer.invoke('taut:get-original-preload')
    if (originalPreload) {
      console.log('[Taut] Evaluating original Slack preload script')
      eval(originalPreload)
    }
  } catch (err) {
    console.error('[Taut] Failed to load original preload:', err)
  }
})()
