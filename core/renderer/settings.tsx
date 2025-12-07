import { findComponent, patchComponent } from './webpack'
import { TautBridge } from './hepers'
import type { PluginInfo, PluginManager } from './client'

let PATHS: Awaited<ReturnType<typeof TautBridge.getConfigPaths>> | null = null
;(async () => {
  PATHS = await TautBridge.getConfigPaths()
})()

const Tabs = findComponent('Tabs') as React.ComponentType<{
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
}>
const MrkdwnElement = findComponent('MrkdwnElement') as React.ComponentType<{
  text: string
}>

export function addSettingsTab(pluginManager: PluginManager) {
  function TautSettings() {
    const configDir = PATHS ? PATHS.tautDir : '?'
    const [pluginInfo, setPluginInfo] = React.useState(() =>
      pluginManager.getPluginInfo()
    )
    React.useEffect(() => {
      const onChange = (event: CustomEvent<PluginInfo>) => {
        setPluginInfo(event.detail)
      }
      pluginManager.on('pluginInfoChanged', onChange)
      return () => {
        pluginManager.off('pluginInfoChanged', onChange)
      }
    }, [])

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
                  checked={info.enabled}
                  disabled
                  className="c-input_checkbox"
                  style={{ marginRight: '8px', marginTop: '5px' }}
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
        <hr />
        <MrkdwnElement text="Created by <@U06UYA5GMB5>, <https://github.com/jeremy46231/taut#credits|credits>" />
      </div>
    )
  }

  patchComponent(Tabs, (props) => {
    const [isTautSelected, setIsTautSelected] = React.useState(false)

    const tabs = [...props.tabs]
    if (tabs[tabs.length - 1].id === 'advanced') {
      tabs.push({
        'id': 'taut',
        'label': <>Taut</>,
        'content': <TautSettings />,
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
      <Tabs
        __original
        {...props}
        tabs={tabs}
        currentTabId={activeTabId}
        onTabChange={handleTabChange}
      />
    )
  })
}
