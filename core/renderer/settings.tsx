// Taut Settings Tab
// Adds a "Taut" tab to Slack's Preferences dialog
// Shows installed plugins, config info, and credits

import { findComponent, patchComponent } from './react'
import { TautBridge } from './helpers'
import type { PluginInfo, PluginManager } from './client'

let PATHS: Awaited<ReturnType<typeof TautBridge.getConfigPaths>> | null = null
;(async () => {
  PATHS = await TautBridge.getConfigPaths()
})()

const MrkdwnElement = findComponent<{
  text: string
}>('MrkdwnElement')

export function addSettingsTab(pluginManager: PluginManager) {
  patchComponent<{
    tabs: {
      'label': React.ReactElement
      'content': React.ReactElement
      'svgIcon': {
        name: string
      }
      'id'?: string
      'aria-labelledby'?: string
      'aria-label'?: string
    }[]
    onTabChange?: (id: string, e: React.UIEvent) => void
    currentTabId?: string
  }>('Tabs', (OriginalTabs) => (props) => {
    const [isTautSelected, setIsTautSelected] = React.useState(false)

    const tabs = [...props.tabs]
    if (tabs[tabs.length - 1].id === 'advanced') {
      tabs.push({
        'id': 'taut',
        'label': <>Taut</>,
        'content': <TautSettings pluginManager={pluginManager} />,
        'svgIcon': { name: 'code' },
        'aria-label': 'taut',
      })
    }

    const handleTabChange = (id: string, e: React.UIEvent) => {
      if (id === 'taut') {
        setIsTautSelected(true)
      } else {
        setIsTautSelected(false)
        // Pass original events back to the app
        if (props.onTabChange) props.onTabChange(id, e)
      }
    }

    const activeTabId = isTautSelected ? 'taut' : props.currentTabId

    return (
      <OriginalTabs
        {...props}
        tabs={tabs}
        currentTabId={activeTabId}
        onTabChange={handleTabChange}
      />
    )
  })
}

function TautSettings({ pluginManager }: { pluginManager: PluginManager }) {
  const configDir = PATHS ? PATHS.tautDir : '?'
  const configFile = PATHS ? PATHS.config : '?'

  return (
    <div>
      <div
        style={{
          fontWeight: 'bold',
          marginBottom: '8px',
        }}
      >
        Taut Settings
      </div>
      <MrkdwnElement text="<#C0A057686SF> | <https://github.com/jeremy46231/taut|Repository>" />
      <MrkdwnElement text={`Config Directory: \`${configDir}\``} />
      <hr />
      <PluginList pluginManager={pluginManager} />
      <MrkdwnElement
        text={`To change settings, edit \`${configFile}\` and save to apply. Editing config here will be available in a future update.`}
      />
      <hr />
      <MrkdwnElement text="Created by <@U06UYA5GMB5>, <https://github.com/jeremy46231/taut#credits|credits>" />
    </div>
  )
}

function PluginList({ pluginManager }: { pluginManager: PluginManager }) {
  const [pluginInfo, setPluginInfo] = React.useState(() =>
    pluginManager.getPluginInfo()
  )
  const [togglingPlugins, setTogglingPlugins] = React.useState<Set<string>>(
    () => new Set()
  )

  const pluginInfoRef = React.useRef(pluginInfo)
  React.useEffect(() => {
    pluginInfoRef.current = pluginInfo
  })

  const timeoutsRef = React.useRef<Map<string, ReturnType<typeof setTimeout>>>(
    new Map()
  )

  React.useEffect(() => {
    const onChange = (event: CustomEvent<PluginInfo>) => {
      const newPluginInfo = event.detail
      const oldPluginInfo = pluginInfoRef.current

      setTogglingPlugins((prev) => {
        const next = new Set(prev)
        for (const id of prev) {
          const oldP = oldPluginInfo.find((p) => p.id === id)
          const newP = newPluginInfo.find((p) => p.id === id)
          if (oldP && newP && oldP.enabled !== newP.enabled) {
            next.delete(id)
            const timeout = timeoutsRef.current.get(id)
            if (timeout) {
              clearTimeout(timeout)
              timeoutsRef.current.delete(id)
            }
          }
        }
        return next
      })
      setPluginInfo(newPluginInfo)
    }
    pluginManager.on('pluginInfoChanged', onChange)
    return () => {
      pluginManager.off('pluginInfoChanged', onChange)
    }
  }, [])

  const handleToggle = async (id: string, enabled: boolean) => {
    setTogglingPlugins((prev) => new Set(prev).add(id))
    TautBridge.setPluginEnabled(id, enabled)

    const existingTimeout = timeoutsRef.current.get(id)
    if (existingTimeout) {
      clearTimeout(existingTimeout)
    }

    // Timeout to prevent stuck toggles
    const timeout = setTimeout(() => {
      setTogglingPlugins((prev) => {
        const next = new Set(prev)
        next.delete(id)
        return next
      })
      timeoutsRef.current.delete(id)
    }, 5000)
    timeoutsRef.current.set(id, timeout)
  }

  return (
    <>
      <div
        style={{ marginTop: '16px', marginBottom: '8px', fontWeight: 'bold' }}
      >
        Installed Plugins:
      </div>
      <ul style={{ marginLeft: '0' }}>
        {pluginInfo.map((info, index) => (
          <li key={index} style={{ marginBottom: '12px', listStyle: 'none' }}>
            <label style={{ display: 'flex', alignItems: 'start' }}>
              <input
                type="checkbox"
                // if currently toggling, it's going to be the inverse value, show that
                checked={
                  !togglingPlugins.has(info.id) ? info.enabled : !info.enabled
                }
                disabled={togglingPlugins.has(info.id)}
                onChange={(e) => handleToggle(info.id, e.target.checked)}
                className="c-input_checkbox"
                style={{
                  marginRight: '8px',
                  marginTop: '5px',
                }}
              />
              <div>
                <span style={{ fontWeight: 'bold' }}>{info.name}</span>
                <div>
                  <MrkdwnElement text={info.description} />
                </div>
                <div>
                  <small>
                    <MrkdwnElement text={`Authors: ${info.authors}`} />
                  </small>
                </div>
              </div>
            </label>
          </li>
        ))}
      </ul>
    </>
  )
}
