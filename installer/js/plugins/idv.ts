const IDV_API_URL = 'https://identity.hackclub.com/api/external/check'
const IDV_CACHE_KEY = 'slack_idv_status'
const IDV_CACHE_TIMESTAMP_KEY = 'slack_idv_status_timestamp'
const IDV_CACHE_DURATION = 24 * 60 * 60 * 1000

/** @type {Record<string, boolean>} */
let idvCache: Record<string, boolean> = {}

let stylesInjected = false

function injectStyles() {
  if (stylesInjected) return
  stylesInjected = true

  try {
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

    const style = document.createElement('style')
    style.setAttribute('data-taut-idv', 'true')
    style.appendChild(document.createTextNode(css))
    document.head.appendChild(style)
  } catch (e) {
    console.error('Error injecting IDV styles:', e)
  }
}
function loadIdvCache() {
  try {
    const timestamp = localStorage.getItem(IDV_CACHE_TIMESTAMP_KEY)
    if (
      timestamp &&
      Date.now() - parseInt(timestamp, 10) < IDV_CACHE_DURATION
    ) {
      const cached = localStorage.getItem(IDV_CACHE_KEY)
      if (cached) {
        idvCache = JSON.parse(cached)
        console.log('Loaded IDV cache:', Object.keys(idvCache).length, 'users')
      }
    }
  } catch (e) {
    console.error('Error loading IDV cache:', e)
  }
}

function saveIdvCache() {
  try {
    localStorage.setItem(IDV_CACHE_KEY, JSON.stringify(idvCache))
    localStorage.setItem(IDV_CACHE_TIMESTAMP_KEY, Date.now().toString())
  } catch (e) {
    console.error('Error saving IDV cache:', e)
  }
}

/**
 * @param {string} slackId
 * @returns {Promise<boolean>}
 */
async function fetchIdvStatus(slackId: string): Promise<boolean> {
  if (typeof idvCache[slackId] === 'boolean') return idvCache[slackId]

  let isEligible = false
  try {
    const response = await fetch(
      `https://corsproxy.io/?${IDV_API_URL}?slack_id=${slackId}`
      // TODO: swap to selfhosted cors proxy
    )
    const data = await response.json()
    console.log('IDV Response:', data)

    if (response.ok && data.result && data.result.includes('eligible')) {
      isEligible = true
    }
  } catch (e) {
    console.error('Error fetching IDV status:', e)
  }

  idvCache[slackId] = isEligible
  saveIdvCache()
  return isEligible
}

/**
 * @param {HTMLButtonElement} btn
 * @param {string} slackId
 */
async function renderIdv(btn: HTMLButtonElement, slackId: string) {
  if (btn.dataset.idvChecked === 'true') return
  btn.dataset.idvChecked = 'true'

  const isEligible = await fetchIdvStatus(slackId)

  if (!isEligible) {
    injectStyles()
    btn.classList.add('taut-idv-not-eligible')
    btn.title = 'IDV: Not Verified/Eligible'
  }
}

function processIdvUsers() {
  const senderButtons = document.querySelectorAll(
    'button.c-message__sender_button:not([data-idv-checked="true"])'
  )
  senderButtons.forEach((btn) => {
    const slackId = btn.getAttribute('data-message-sender')
    // - skip if sender-type attribute indicates an app or bot
    // - skip common bot/app ID prefixes (B, A, S)
    // - otherwise only process normal user IDs (U or W)
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
    if (
      slackId &&
      (slackId.startsWith('B') ||
        slackId.startsWith('A') ||
        slackId.startsWith('S'))
    )
      return

    if (slackId && (slackId.startsWith('U') || slackId.startsWith('W'))) {
      renderIdv(btn as HTMLButtonElement, slackId)
    }
  })
}

loadIdvCache()
injectStyles()
processIdvUsers()

const observer = new MutationObserver(() => processIdvUsers())
observer.observe(document.body, { childList: true, subtree: true })

console.log('IDV Plugin loaded')
