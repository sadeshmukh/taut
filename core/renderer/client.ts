// Taut Client (the plugin manager)
// Runs in the browser page context
// Loads and manages plugins via TautAPI

import type {
  TautPlugin,
  TautAPI,
  TautPluginConstructor,
  TautPluginConfig,
} from '../Plugin'

/**
 * Plugin Manager - loads and manages Taut plugins
 */
class PluginManager {
  plugins = new Map<
    string,
    {
      PluginClass: TautPluginConstructor
      instance: TautPlugin
      config: TautPluginConfig
    }
  >()
  api: TautAPI

  constructor() {
    // @ts-ignore
    if (typeof window.TautAPI === 'undefined') {
      throw new Error('[Taut] TautAPI is not available in the renderer context')
    }
    this.api = (window as any).TautAPI as TautAPI
  }

  /**
   * Initialize the plugin manager - load and start all plugins
   */
  async init() {
    console.log('[Taut] PluginManager initializing...')

    this.api.onConfigChange((name, newConfig) => {
      this.updatePluginConfig(name, newConfig)
    })
    await this.api.startPlugins()
  }

  /**
   * Load a plugin
   * Called by code injected by the main process
   * @param name - Plugin name
   * @param PluginClass - Plugin class (constructor)
   * @param config - Plugin configuration
   */
  loadPlugin(
    name: string,
    PluginClass: TautPluginConstructor,
    config: TautPluginConfig
  ) {
    console.log(`[Taut] Loading plugin: ${name}`)

    const existing = this.plugins.get(name)
    if (existing && existing.config.enabled) {
      try {
        existing.instance.stop()
      } catch (err) {
        console.error(`[Taut] Error stopping existing plugin ${name}:`, err)
      }
    }

    try {
      const instance = new PluginClass(this.api, config)
      this.plugins.set(name, { PluginClass, instance, config })
      if (config.enabled) {
        try {
          instance.start()
          console.log(`[Taut] Plugin ${name} started successfully`)
        } catch (err) {
          console.error(`[Taut] Error starting plugin ${name}:`, err)
        }
      }
    } catch (err) {
      console.error(`[Taut] Error loading plugin ${name}:`, err)
    }
  }

  /**
   * Update a plugin's config and start/restart/stop as needed
   * @param name - Plugin name
   * @param newConfig - New plugin configuration
   */
  updatePluginConfig(name: string, newConfig: TautPluginConfig) {
    console.log(`[Taut] Updating config for plugin: ${name}`)

    const existing = this.plugins.get(name)
    if (!existing) {
      console.warn(`[Taut] Plugin ${name} not loaded, cannot update config`)
      return
    }

    if (existing.config.enabled) {
      try {
        existing.instance.stop()
      } catch (err) {
        console.error(`[Taut] Error stopping plugin ${name}:`, err)
      }
    }

    const instance = new existing.PluginClass(this.api, newConfig)
    this.plugins.set(name, {
      PluginClass: existing.PluginClass,
      instance,
      config: newConfig,
    })

    if (newConfig.enabled) {
      try {
        instance.start()
        console.log(
          `[Taut] Plugin ${name} started successfully with new config`
        )
      } catch (err) {
        console.error(
          `[Taut] Error starting plugin ${name} with new config:`,
          err
        )
      }
    }

    console.log(`[Taut] Plugin ${name} config updated`)
  }
}

// Create and initialize the plugin manager
const pluginManager = new PluginManager()
// @ts-ignore
window.__tautPluginManager = pluginManager
pluginManager.init()
