// Abstract base class for all Taut plugins

import type { TautAPI } from './preload.cjs'

/**
 * Abstract base class that all Taut plugins must extend.
 * Plugins are instantiated in the browser context with access to the TautAPI.
 */
export abstract class TautPlugin {
  protected api: TautAPI
  protected config: object

  /**
   * @param api - The TautAPI instance for plugin communication
   * @param config - The plugin's configuration from config.jsonc
   */
  constructor(api: TautAPI, config: object) {
    this.api = api
    this.config = config
  }

  /**
   * Called when the plugin should start.
   * Subclasses must implement this method.
   */
  abstract start(): void

  /**
   * Called when the plugin should stop and clean up.
   * Subclasses should override this to perform cleanup.
   */
  stop(): void {
    // Default implementation does nothing
  }

  /**
   * Log a message with the plugin's name prefix.
   * @param args - Arguments to log
   */
  protected log(...args: any[]): void {
    console.log(`[${this.constructor.name}]`, ...args)
    this.api.log(`[${this.constructor.name}]`, ...args)
  }
}

export default TautPlugin
export type TautPluginConstructor = new (api: TautAPI, config: object) => TautPlugin
