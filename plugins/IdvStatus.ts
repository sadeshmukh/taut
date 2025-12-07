// Shows a red squiggle on users who are not IDV verified
// Author: Sahil (https://github.com/sadeshmukh)

import { TautPlugin, type TautPluginConfig, type TautAPI } from '../core/Plugin'

const IDV_API_URL = 'https://identity.hackclub.com/api/external/check'
const IDV_CACHE_KEY = 'slack_idv_status_v2'
const IDV_CACHE_TIMESTAMP_KEY = 'slack_idv_status_timestamp_v2'
const IDV_CACHE_DURATION = 24 * 60 * 60 * 1000
const MAX_CACHE_SIZE = 5000

export default class IdvStatus extends TautPlugin {
  name = 'IDV Status'
  description = 'Shows a red squiggle on users who are not IDV eligible'
  authors = '<@U08PUHSMW4V>'

  idvCache: Record<string, string> = {}
  stylesElement: HTMLStyleElement | null = null
  observer: MutationObserver | null = null

  start(): void {
    this.log('Starting IDV Status...')
    this.loadIdvCache()
    this.injectStyles()
    this.processIdvUsers()

    // Set up mutation observer for new messages
    this.observer = new MutationObserver(() => this.processIdvUsers())
    this.observer.observe(document.body, { childList: true, subtree: true })

    // @ts-ignore
    window.tautIdvClearCache = () => this.clearCache()

    this.log('IDV Status loaded')
  }

  stop(): void {
    this.log('Stopping IDV Status...')
    if (this.observer) {
      this.observer.disconnect()
      this.observer = null
    }
    if (this.stylesElement) {
      this.stylesElement.remove()
      this.stylesElement = null
    }

    // Clean up DOM changes
    const processedButtons = document.querySelectorAll<HTMLButtonElement>(
      'button.c-message__sender_button[data-idv-checked="true"]'
    )
    processedButtons.forEach((btn) => {
      delete btn.dataset.idvChecked
      btn.classList.remove('taut-idv-not-eligible', 'taut-idv-over-18')
      if (btn.title && btn.title.startsWith('IDV:')) {
        btn.title = ''
      }
    })

    // @ts-ignore
    delete window.tautIdvClearCache
  }

  public clearCache(): void {
    this.idvCache = {}
    localStorage.removeItem(IDV_CACHE_KEY)
    localStorage.removeItem(IDV_CACHE_TIMESTAMP_KEY)
    this.log('IDV Cache cleared')
  }

  injectStyles(): void {
    if (this.stylesElement) return

    const css = `
      /* IDV plugin styles */
      .taut-idv-not-eligible {
        text-decoration: underline wavy #e01e5a !important;
        text-decoration-thickness: 1px !important;
      }

      .taut-idv-over-18 {
        text-decoration: underline wavy #d97706 !important;
        text-decoration-thickness: 1px !important;
      }
    `

    this.stylesElement = document.createElement('style')
    this.stylesElement.setAttribute('data-taut-idv', 'true')
    this.stylesElement.appendChild(document.createTextNode(css))
    document.head.appendChild(this.stylesElement)
  }

  loadIdvCache(): void {
    try {
      const timestamp = localStorage.getItem(IDV_CACHE_TIMESTAMP_KEY)
      if (
        timestamp &&
        Date.now() - parseInt(timestamp, 10) < IDV_CACHE_DURATION
      ) {
        const cached = localStorage.getItem(IDV_CACHE_KEY)
        if (cached) {
          this.idvCache = JSON.parse(cached)
          this.log(
            'Loaded IDV cache:',
            Object.keys(this.idvCache).length,
            'users'
          )
        }
      }
    } catch (e) {
      this.log('Error loading IDV cache:', e)
    }
  }

  saveIdvCache(): void {
    try {
      localStorage.setItem(IDV_CACHE_KEY, JSON.stringify(this.idvCache))
      localStorage.setItem(IDV_CACHE_TIMESTAMP_KEY, Date.now().toString())
    } catch (e) {
      this.log('Error saving IDV cache:', e)
    }
  }

  setCache(slackId: string, status: string): void {
    this.idvCache[slackId] = status

    const keys = Object.keys(this.idvCache)
    if (keys.length > MAX_CACHE_SIZE) {
      const toRemove = keys.slice(0, 100)
      toRemove.forEach((k) => delete this.idvCache[k])
    }

    this.saveIdvCache()
  }

  async fetchIdvStatus(slackId: string): Promise<string> {
    if (this.idvCache[slackId]) return this.idvCache[slackId]

    try {
      const response = await fetch(`${IDV_API_URL}?slack_id=${slackId}`)

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`)
      }

      const data = await response.json()

      let status = 'unverified'
      if (data.result) {
        if (data.result === 'verified_eligible') {
          status = 'eligible'
        } else if (data.result === 'verified_but_over_18') {
          status = 'over_18'
        } else if (
          data.result === 'pending' ||
          data.result === 'needs_submission'
        ) {
          status = 'unverified'
        }
      }

      this.setCache(slackId, status)
      return status
    } catch (e) {
      this.log('Error fetching IDV status:', e)
      return 'unverified' // Do not cache errors
    }
  }

  async renderIdv(btn: HTMLButtonElement, slackId: string): Promise<void> {
    // If we've already checked this button, verify the styling is still present
    // This handles cases where React re-renders and strips classes but keeps attributes
    if (btn.dataset.idvChecked === 'true') {
      const hasClass =
        btn.classList.contains('taut-idv-not-eligible') ||
        btn.classList.contains('taut-idv-over-18')

      if (hasClass) return

      // allow re-fetching/re-applying if class is missing
    }

    btn.dataset.idvChecked = 'true'

    const status = await this.fetchIdvStatus(slackId)

    if (status === 'unverified') {
      btn.classList.add('taut-idv-not-eligible')
      btn.title = 'IDV: Not Verified/Eligible'
    } else if (status === 'over_18') {
      btn.classList.add('taut-idv-over-18')
      btn.title = 'IDV: Verified (Over 18)'
    }
  }

  processIdvUsers(): void {
    const senderButtons = document.querySelectorAll<HTMLButtonElement>(
      'button.c-message__sender_button:not([data-idv-checked="true"])'
    )

    senderButtons.forEach((btn) => {
      const slackId = btn.getAttribute('data-message-sender')
      const senderType = (
        btn.getAttribute('data-message-sender-type') || ''
      ).toLowerCase()
      const displayName = (
        btn.getAttribute('data-message-sender-name') ||
        btn.textContent ||
        ''
      ).toLowerCase()

      if (senderType && /(app|bot)/.test(senderType)) return
      if (displayName && /(app|bot)$/.test(displayName)) return
      if (slackId === 'USLACKBOT') return

      try {
        // Check for app/bot badge in the message sender container
        const senderContainer = btn.closest('.c-message__sender')
        if (senderContainer) {
          const hasBadge = senderContainer.querySelector(
            '.c-app_badge, .c-bot_badge'
          )
          if (hasBadge) return
        }
      } catch (e) {
        // Ignore DOM errors
      }

      if (
        slackId &&
        (slackId.startsWith('B') ||
          slackId.startsWith('A') ||
          slackId.startsWith('S'))
      )
        return

      if (slackId && (slackId.startsWith('U') || slackId.startsWith('W'))) {
        this.renderIdv(btn, slackId).catch((e) =>
          this.log('Error rendering IDV:', e)
        )
      }
    })
  }
}
