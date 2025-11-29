// Main renderer process entrypoint
// Injected into the renderer process as a custom preload script by inject.cjs

const { ipcRenderer } = require('electron')

console.log('!!! preload loaded')

// Request and eval the original Slack preload script from the main process
;(async () => {
  const originalPreload = await ipcRenderer.invoke('taut:get-original-preload')
  if (originalPreload) {
    console.log('!!! evaluating original preload script')
    eval(originalPreload)
  }

  const plugins = await ipcRenderer.invoke('taut:get-plugins')
  for (const plugin of plugins) {
    console.log('!!! executing plugin:', plugin.name)
    try {
      eval(plugin.code)
    } catch (err) {
      console.error('!!! error executing plugin:', plugin.name, err)
    }
  }
})()
