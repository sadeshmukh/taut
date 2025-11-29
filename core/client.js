// Taut Client (the plugin manager)
// Runs in the browser page context
// Loads and manages plugins via TautAPI

;(function () {
  'use strict'

  /** @import { TautAPI } from './preload.cjs' */
  /** @import { TautPlugin, TautPluginConstructor } from './Plugin' */

  /**
   * Plugin Manager - loads and manages Taut plugins
   */
  class PluginManager {
    constructor() {
      /** @type {Map<string, any>} */
      this.plugins = new Map()

      // @ts-ignore
      if (typeof window.TautAPI === 'undefined') {
        throw new Error('TautAPI is not available in the renderer context')
      }
      /** @type {TautAPI} */
      // @ts-ignore
      this.api = window.TautAPI
    }

    /**
     * Initialize the plugin manager - load and start all plugins
     */
    async init() {
      console.log('[Taut] PluginManager initializing...')

      await this.api.startPlugins()
    }

    /**
     * Load a single plugin
     * @param {string} name - Plugin name
     * @param {TautPluginConstructor} PluginClass - Plugin class (constructor)
     * @param {object} config - Plugin configuration
     */
    async loadPlugin(name, PluginClass, config) {
      console.log(`[Taut] Loading plugin: ${name}`)

      if (this.plugins.has(name)) {
        this.stopPlugin(name)
        this.plugins.delete(name)
      }

      try {
        /** @type {TautPlugin} */
        const instance = new PluginClass(this.api, config)
        this.plugins.set(name, instance)

        if (typeof instance.start === 'function') {
          instance.start()
        }
        
        console.log(`[Taut] Plugin ${name} started successfully`)
      } catch (err) {
        console.error(`[Taut] Error loading plugin ${name}:`, err)
        throw err
      }
    }

    /**
     * Stop all plugins
     */
    stopAll() {
      for (const [name, instance] of this.plugins) {
        try {
          if (typeof instance.stop === 'function') {
            instance.stop()
          }
          console.log(`[Taut] Plugin ${name} stopped`)
        } catch (err) {
          console.error(`[Taut] Error stopping plugin ${name}:`, err)
        }
      }
      this.plugins.clear()
    }

    /**
     * Stop a specific plugin
     * @param {string} name - Plugin name
     */
    stopPlugin(name) {
      const instance = this.plugins.get(name)
      if (instance) {
        try {
          if (typeof instance.stop === 'function') {
            instance.stop()
          }
          console.log(`[Taut] Plugin ${name} stopped`)
        } catch (err) {
          console.error(`[Taut] Error stopping plugin ${name}:`, err)
        }
      }
    }
  }

  // Create and initialize the plugin manager
  const pluginManager = new PluginManager()
  // @ts-ignore
  window.__tautPluginManager = pluginManager
  pluginManager.init()
})()
