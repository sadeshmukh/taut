// Shinigami Eyes plugin for Taut
// Shows Hackatime trust level indicators next to user names in Slack
// Author: @ImShyMike :3

import { TautPlugin, type TautPluginConfig, type TautAPI } from '../core/Plugin'

const API_URL = 'https://hackatime.hackclub.com/api/admin/v1/execute'
const CACHE_KEY = 'shinigami_trust_levels'
const CACHE_TIMESTAMP_KEY = 'shinigami_trust_levels_timestamp'
const CACHE_DURATION = 24 * 60 * 60 * 1000 // 24 hours

const TRUST_EMOJI = ['🔵', '🔴', '🟢', '🟡', '⚠️']

const TRUST_EMOJI_MAP: Record<string, string | null> = {
  blue: '🔵',
  red: '🔴',
  green: '🟢',
  yellow: '🟡',
}

type ShinigamiConfig = TautPluginConfig & {
  apiToken?: string
}

export default class ShinigamiEyes extends TautPlugin {
  config: ShinigamiConfig

  trustLevels: Record<string, number> = {}
  currentTooltip: HTMLDivElement | null = null
  isLoadingTooltip = false
  observer: MutationObserver | null = null

  // Bound event handlers for cleanup
  boundHandleTrustHover: (event: MouseEvent) => void
  boundHandleTrustLeave: (event: MouseEvent) => void

  constructor(api: TautAPI, config: TautPluginConfig) {
    super(api, config)
    this.config = config as ShinigamiConfig
    this.boundHandleTrustHover = this.handleTrustHover.bind(this)
    this.boundHandleTrustLeave = this.handleTrustLeave.bind(this)
  }

  start(): void {
    this.log('Starting Shinigami Eyes...')

    if (!this.config.apiToken) {
      this.log('Warning: No API token configured. Set apiToken in config.jsonc')
      return
    }

    this.initializeTrustLevels().then(() => {
      this.extractSlackUsers()

      // Set up mutation observer for new messages
      this.observer = new MutationObserver(() => this.extractSlackUsers())
      this.observer.observe(document.body, { childList: true, subtree: true })

      this.log('Loaded successfully!')
    })
  }

  stop(): void {
    this.log('Stopping...')

    // Disconnect the observer
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }

    // Remove any active tooltip
    this.hideTooltip()

    // Clean up all modified buttons
    const trustedButtons = document.querySelectorAll<HTMLButtonElement>(
      'button.c-message__sender_button[data-trusted="true"]'
    )
    trustedButtons.forEach((btn) => {
      btn.removeEventListener('mouseenter', this.boundHandleTrustHover)
      btn.removeEventListener('mouseleave', this.boundHandleTrustLeave)

      // Reset cursor style
      btn.style.cursor = ''

      // Remove the emoji prefix from the button text
      const firstChild = btn.firstChild
      if (firstChild && firstChild.nodeType === Node.TEXT_NODE) {
        const text = firstChild.textContent || ''
        // Match any trust emoji followed by a space at the start
        const emojiPattern = /^(🔵|🔴|🟢|🟡|⚠️) /
        if (emojiPattern.test(text)) {
          firstChild.remove()
        }
      }

      // Remove the data attribute
      delete btn.dataset.trusted
    })

    // Clear trust levels cache from memory
    this.trustLevels = {}
  }

  // Cache Management

  isCacheValid(): boolean {
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY)
    if (!timestamp) return false

    const now = Date.now()
    const cacheTime = parseInt(timestamp, 10)
    return now - cacheTime < CACHE_DURATION
  }

  loadCachedTrustLevels(): boolean {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached && this.isCacheValid()) {
        this.trustLevels = JSON.parse(cached)
        this.log(
          'Loaded trust levels from cache:',
          Object.keys(this.trustLevels).length,
          'users'
        )
        return true
      }
    } catch (e) {
      this.log('Error loading cached trust levels:', e)
    }
    return false
  }

  saveTrustLevelsToCache(data: Record<string, number>): void {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString())
      this.log(
        'Saved trust levels to cache:',
        Object.keys(data).length,
        'users'
      )
    } catch (e) {
      this.log('Error saving trust levels to cache:', e)
    }
  }

  // API Fetching

  async fetchTrustLevelsFromAPI(): Promise<void> {
    const apiToken = this.config.apiToken
    if (!apiToken) {
      this.log('Cannot fetch trust levels: No API token configured')
      return
    }

    this.log('Fetching fresh trust levels from API...')
    const allUsers: Record<string, number> = {}

    try {
      for (let start = 1; start <= 20000; start += 1000) {
        const end = start + 999
        const query = `
          SELECT json_agg(json_build_object('id', slack_uid, 'trust_level', trust_level)) as users
          FROM users
          WHERE id BETWEEN ${start} AND ${end}
        `

        const response = await fetch(API_URL, {
          method: 'POST',
          headers: {
            'authorization': `Bearer ${apiToken}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({ query }),
        })

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }

        const data = await response.json()

        try {
          const usersData = data.rows?.[0]?.users?.[1]
          const users = usersData ? JSON.parse(usersData) : []

          for (const user of users) {
            if (user.id) {
              allUsers[user.id] = user.trust_level
            }
          }
        } catch (parseError) {
          this.log(`Error parsing chunk ${start}-${end}:`, parseError)
        }

        this.log(
          `Processed chunk ${start}-${end}, total users: ${Object.keys(allUsers).length}`
        )

        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      this.log(
        'Successfully fetched trust levels:',
        Object.keys(allUsers).length,
        'users'
      )

      this.trustLevels = allUsers
      this.saveTrustLevelsToCache(allUsers)

      // Reset existing trusted buttons so they get re-processed
      const trustedButtons = document.querySelectorAll<HTMLButtonElement>(
        'button.c-message__sender_button[data-trusted="true"]'
      )
      trustedButtons.forEach((btn) => {
        btn.dataset.trusted = 'false'
        btn.innerHTML = btn.innerHTML.replace(/^[🔵🔴🟢🟡⚠️]\s/, '')
      })

      this.extractSlackUsers()
    } catch (error) {
      this.log('Error fetching trust levels from API:', error)
    }
  }

  async initializeTrustLevels(): Promise<void> {
    if (!this.loadCachedTrustLevels()) {
      this.log('No valid cache found, fetching from API...')
      await this.fetchTrustLevelsFromAPI()
    }
  }

  // Trust Level Rendering

  async setTrustLevel(btn: HTMLButtonElement, slackId: string): Promise<void> {
    const trust = this.trustLevels[slackId] ?? 4
    this.renderTrust(btn, trust)
  }

  renderTrust(btn: HTMLButtonElement, trust: number): void {
    if (btn.dataset.trusted === 'true') return

    const emoji = TRUST_EMOJI[trust] || TRUST_EMOJI[4]
    if (emoji) {
      btn.insertAdjacentText('afterbegin', emoji + ' ')
      btn.dataset.trusted = 'true'

      if (trust === 1 || trust === 3) {
        btn.style.cursor = 'help'
        btn.addEventListener('mouseenter', this.boundHandleTrustHover)
        btn.addEventListener('mouseleave', this.boundHandleTrustLeave)
      }
    }
  }

  // Tooltip Handling

  async handleTrustHover(event: MouseEvent): Promise<void> {
    const btn = event.currentTarget as HTMLButtonElement
    const slackId = btn.getAttribute('data-message-sender')

    if (!slackId || this.isLoadingTooltip || this.currentTooltip) return

    await this.showAuditLogsTooltip(btn, slackId)
  }

  handleTrustLeave(event: MouseEvent): void {
    setTimeout(() => {
      if (this.currentTooltip && !this.currentTooltip.matches(':hover')) {
        this.hideTooltip()
      }
    }, 200)
  }

  async fetchAuditLogs(slackId: string): Promise<Record<string, any>[] | null> {
    const apiToken = this.config.apiToken
    if (!apiToken) return null

    try {
      const userQuery = `SELECT id FROM users WHERE slack_uid = '${slackId}' LIMIT 1`

      const userResponse = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query: userQuery }),
      })

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user: ${userResponse.status}`)
      }

      const userData = await userResponse.json()
      const userId = userData.rows?.[0]?.id?.[1]

      if (!userId) {
        return null
      }

      const logsQuery = `
        SELECT 
          tl.id,
          tl.previous_trust_level,
          tl.new_trust_level,
          tl.reason,
          tl.notes,
          tl.created_at,
          u.username as changed_by_username,
          u.slack_username as changed_by_slack_username
        FROM trust_level_audit_logs tl
        JOIN users u ON tl.changed_by_id = u.id
        WHERE tl.user_id = ${userId}
        ORDER BY tl.created_at DESC
        LIMIT 5
      `

      const logsResponse = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${apiToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query: logsQuery }),
      })

      if (!logsResponse.ok) {
        throw new Error(`Failed to fetch logs: ${logsResponse.status}`)
      }

      const logsData = await logsResponse.json()
      return logsData.rows || []
    } catch (error) {
      this.log('Error fetching audit logs:', error)
      return null
    }
  }

  async showAuditLogsTooltip(
    btn: HTMLButtonElement,
    slackId: string
  ): Promise<void> {
    this.isLoadingTooltip = true

    const rect = btn.getBoundingClientRect()
    this.createLoadingTooltip(rect)

    const logs = await this.fetchAuditLogs(slackId)

    this.hideTooltip()

    if (!logs || logs.length === 0) {
      this.createNoLogsTooltip(rect)
    } else {
      this.createAuditLogsTooltip(rect, logs)
    }

    this.isLoadingTooltip = false
  }

  createLoadingTooltip(rect: DOMRect): void {
    const tooltip = document.createElement('div')
    tooltip.className = 'trust-audit-tooltip'
    tooltip.style.cssText = `
      position: fixed;
      top: ${rect.bottom + 5}px;
      left: ${rect.left}px;
      background: #1a1d21;
      border: 1px solid #4a5568;
      border-radius: 8px;
      padding: 12px;
      z-index: 99999;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      color: #e5e7eb;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `

    tooltip.innerHTML = '<div>Loading audit logs...</div>'

    document.body.appendChild(tooltip)
    this.currentTooltip = tooltip

    tooltip.addEventListener('mouseleave', () => {
      this.hideTooltip()
    })
  }

  createNoLogsTooltip(rect: DOMRect): void {
    const tooltip = document.createElement('div')
    tooltip.className = 'trust-audit-tooltip'
    tooltip.style.cssText = `
      position: fixed;
      top: ${rect.bottom + 5}px;
      left: ${rect.left}px;
      background: #1a1d21;
      border: 1px solid #4a5568;
      border-radius: 8px;
      padding: 12px;
      z-index: 99999;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      color: #9ca3af;
      font-size: 13px;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `

    tooltip.innerHTML = '<div>No trust level changes found</div>'

    document.body.appendChild(tooltip)
    this.currentTooltip = tooltip

    tooltip.addEventListener('mouseleave', () => {
      this.hideTooltip()
    })
  }

  createAuditLogsTooltip(rect: DOMRect, logs: Record<string, any>[]): void {
    const tooltip = document.createElement('div')
    tooltip.className = 'trust-audit-tooltip'
    tooltip.style.cssText = `
      position: fixed;
      top: ${rect.bottom + 5}px;
      left: ${rect.left}px;
      background: #1a1d21;
      border: 1px solid #4a5568;
      border-radius: 8px;
      padding: 12px;
      z-index: 99999;
      max-width: 400px;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.5);
      color: #e5e7eb;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    `

    const logsHtml = logs
      .map((log: Record<string, any>) => {
        const prevLevel = log.previous_trust_level?.[1]
        const newLevel = log.new_trust_level?.[1]
        const createdAt = log.created_at?.[1]
        const reason = log.reason?.[1]
        const changedBySlack = log.changed_by_slack_username?.[1]
        const changedByUsername = log.changed_by_username?.[1]

        const prevEmoji = TRUST_EMOJI_MAP[String(prevLevel)] || '⚪'
        const newEmoji = TRUST_EMOJI_MAP[String(newLevel)] || '⚪'
        const date = new Date(createdAt).toLocaleDateString('en-US', {
          month: 'short',
          day: 'numeric',
          hour: '2-digit',
          minute: '2-digit',
        })
        const changedBy = changedBySlack || changedByUsername || 'Unknown'

        return `
          <div style="padding: 6px 0; border-bottom: 1px solid #374151; font-size: 13px;">
            <div style="color: #e5e7eb; margin-bottom: 2px;">
              ${prevEmoji} → ${newEmoji}
              <span style="color: #9ca3af; font-size: 11px; margin-left: 8px;">${date}</span>
            </div>
            <div style="color: #9ca3af; font-size: 11px;">
              by ${this.escapeHtml(changedBy)}
            </div>
            ${
              reason
                ? `<div style="color: #d1d5db; font-size: 11px; margin-top: 2px;">${this.escapeHtml(
                    reason
                  )}</div>`
                : ''
            }
          </div>
        `
      })
      .join('')

    tooltip.innerHTML = `
      <div style="color: #f3f4f6; font-weight: 600; margin-bottom: 8px; font-size: 14px;">
        Trust Level History
      </div>
      ${logsHtml}
    `

    document.body.appendChild(tooltip)
    this.currentTooltip = tooltip

    tooltip.addEventListener('mouseleave', () => {
      this.hideTooltip()
    })
  }

  hideTooltip(): void {
    if (this.currentTooltip) {
      document.body.removeChild(this.currentTooltip)
      this.currentTooltip = null
    }
  }

  escapeHtml(text: string): string {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  // User Extraction

  extractSlackUsers(): void {
    const senderButtons = document.querySelectorAll<HTMLButtonElement>(
      'button.c-message__sender_button:not([data-trusted="true"])'
    )

    senderButtons.forEach((btn) => {
      const slackId = btn.getAttribute('data-message-sender')
      if (slackId) {
        this.setTrustLevel(btn, slackId)
      }
    })
  }
}
