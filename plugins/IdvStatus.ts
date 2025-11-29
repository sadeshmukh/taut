import { TautPlugin, type TautPluginConfig } from '../core/Plugin'

const IDV_API_URL = 'https://identity.hackclub.com/api/external/check'
const IDV_CACHE_KEY = 'slack_idv_status'
const IDV_CACHE_TIMESTAMP_KEY = 'slack_idv_status_timestamp'
const IDV_CACHE_DURATION = 24 * 60 * 60 * 1000

export default class IdvStatus extends TautPlugin {
  private idvCache: Record<string, boolean> = {}
  private stylesElement: HTMLStyleElement | null = null
  private observer: MutationObserver | null = null

  start(): void {
    this.log('Starting IDV Status...')
    this.loadIdvCache()
    this.injectStyles()
    this.processIdvUsers()

    this.observer = new MutationObserver(() => this.processIdvUsers())
    this.observer.observe(document.body, { childList: true, subtree: true })
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
      btn.classList.remove('taut-idv-not-eligible')
      if (btn.title === 'IDV: Not Verified/Eligible') {
        btn.title = ''
      }
    })
  }

  private injectStyles(): void {
    if (this.stylesElement) return

    const css = `
      /* IDV plugin styles */
      .taut-idv-not-eligible {
        color: #e01e5a !important;
        text-decoration: underline wavy #e01e5a !important;
        text-decoration-thickness: 2px !important;
      }

      .taut-idv-not-eligible .c-avatar__image,
      .taut-idv-not-eligible img {
        outline: 2px solid #e01e5a !important;
        outline-offset: 2px !important;
        border-radius: 50% !important;
        box-shadow: 0 0 0 3px rgba(224,30,90,0.08) !important;
      }
    `

    this.stylesElement = document.createElement('style')
    this.stylesElement.setAttribute('data-taut-idv', 'true')
    this.stylesElement.appendChild(document.createTextNode(css))
    document.head.appendChild(this.stylesElement)
  }

  private loadIdvCache(): void {
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

  private saveIdvCache(): void {
    try {
      localStorage.setItem(IDV_CACHE_KEY, JSON.stringify(this.idvCache))
      localStorage.setItem(IDV_CACHE_TIMESTAMP_KEY, Date.now().toString())
    } catch (e) {
      this.log('Error saving IDV cache:', e)
    }
  }

  private async fetchIdvStatus(slackId: string): Promise<boolean> {
    if (typeof this.idvCache[slackId] === 'boolean')
      return this.idvCache[slackId]

    let isEligible = false
    try {
      const response = await fetch(
        `https://corsproxy.io/?${IDV_API_URL}?slack_id=${slackId}`
      )
      const data = await response.json()

      if (response.ok && data.result && data.result.includes('eligible')) {
        isEligible = true
      }
    } catch (e) {
      this.log('Error fetching IDV status:', e)
    }

    this.idvCache[slackId] = isEligible
    this.saveIdvCache()
    return isEligible
  }

  private async renderIdv(
    btn: HTMLButtonElement,
    slackId: string
  ): Promise<void> {
    if (btn.dataset.idvChecked === 'true') return
    btn.dataset.idvChecked = 'true'

    const isEligible = await this.fetchIdvStatus(slackId)

    if (!isEligible) {
      btn.classList.add('taut-idv-not-eligible')
      btn.title = 'IDV: Not Verified/Eligible'
    }
  }

  private processIdvUsers(): void {
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
        this.renderIdv(btn, slackId)
      }
    })
  }
}
