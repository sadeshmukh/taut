shinigamiEyes()
alert('Hello from Taut!')

/**
 * @author @ImShyMike :3
 */
function shinigamiEyes() {
  const API_URL = 'https://hackatime.hackclub.com/api/admin/v1/execute'
  const API_TOKEN = 'TODO'
  const CACHE_KEY = 'slack_trust_levels'
  const CACHE_TIMESTAMP_KEY = 'slack_trust_levels_timestamp'
  const CACHE_DURATION = 24 * 60 * 60 * 1000

  const TRUST_EMOJI = ['🔵', '🔴', '🟢', '🟡', '⚠️']

  /** @type {Record<string, string?>} */
  const TRUST_EMOJI_MAP = {
    blue: '🔵',
    red: '🔴',
    green: '🟢',
    yellow: '🟡',
  }

  /** @type {Record<string, number>} */
  let trustLevels = {}

  /** @type {HTMLDivElement | null} */
  let currentTooltip = null
  let isLoadingTooltip = false

  function isCacheValid() {
    const timestamp = localStorage.getItem(CACHE_TIMESTAMP_KEY)
    if (!timestamp) return false

    const now = Date.now()
    const cacheTime = parseInt(timestamp, 10)
    return now - cacheTime < CACHE_DURATION
  }

  function loadCachedTrustLevels() {
    try {
      const cached = localStorage.getItem(CACHE_KEY)
      if (cached && isCacheValid()) {
        trustLevels = JSON.parse(cached)
        console.log(
          'Loaded trust levels from cache:',
          Object.keys(trustLevels).length,
          'users'
        )
        return true
      }
    } catch (e) {
      console.error('Error loading cached trust levels:', e)
    }
    return false
  }

  /**
   * @param {Record<string, number>} data
   */
  function saveTrustLevelsToCache(data) {
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify(data))
      localStorage.setItem(CACHE_TIMESTAMP_KEY, Date.now().toString())
      console.log(
        'Saved trust levels to cache:',
        Object.keys(data).length,
        'users'
      )
    } catch (e) {
      console.error('Error saving trust levels to cache:', e)
    }
  }

  async function fetchTrustLevelsFromAPI() {
    console.log('Fetching fresh trust levels from API...')
    /** @type {Record<string, number>} */
    const allUsers = {}

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
            'authorization': `Bearer ${API_TOKEN}`,
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
          console.warn(`Error parsing chunk ${start}-${end}:`, parseError)
        }

        console.log(
          `Processed chunk ${start}-${end}, total users: ${
            Object.keys(allUsers).length
          }`
        )

        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      console.log(
        'Successfully fetched trust levels:',
        Object.keys(allUsers).length,
        'users'
      )

      trustLevels = allUsers
      saveTrustLevelsToCache(allUsers)

      /** @type {NodeListOf<HTMLButtonElement>} */
      const trustedButtons = document.querySelectorAll(
        'button.c-message__sender_button[data-trusted="true"]'
      )
      trustedButtons.forEach((btn) => {
        btn.dataset.trusted = 'false'
        btn.innerHTML = btn.innerHTML.replace(/^[🔵🔴🟢🟡⚠️]\s/, '')
      })

      extractSlackUsers()
    } catch (error) {
      console.error('Error fetching trust levels from API:', error)
    }
  }

  async function initializeTrustLevels() {
    if (!loadCachedTrustLevels()) {
      console.log('No valid cache found, fetching from API...')
      await fetchTrustLevelsFromAPI()
    }
  }

  /**
   * @param {HTMLButtonElement} btn
   * @param {string} slackId
   * @returns {Promise<void>}
   */
  async function setTrustLevel(btn, slackId) {
    const trust = trustLevels[slackId] ?? 4
    renderTrust(btn, trust)
  }

  /**
   * @param {HTMLButtonElement} btn
   * @param {number} trust
   */
  function renderTrust(btn, trust) {
    if (btn.dataset.trusted === 'true') return

    const emoji = TRUST_EMOJI[trust] || TRUST_EMOJI[4]
    if (emoji) {
      btn.insertAdjacentText('afterbegin', emoji + ' ')
      btn.dataset.trusted = 'true'

      if (trust === 1 || trust === 3) {
        btn.style.cursor = 'help'
        btn.addEventListener('mouseenter', handleTrustHover)
        btn.addEventListener('mouseleave', handleTrustLeave)
      }
    }
  }

  /**
   * @param {MouseEvent} event
   * @returns {Promise<void>}
   */
  async function handleTrustHover(event) {
    const btn = /** @type {HTMLButtonElement} */ (event.currentTarget)
    const slackId = btn.getAttribute('data-message-sender')

    if (!slackId || isLoadingTooltip || currentTooltip) return

    await showAuditLogsTooltip(btn, slackId)
  }

  /** @param {MouseEvent} event */
  function handleTrustLeave(event) {
    setTimeout(() => {
      if (currentTooltip && !currentTooltip.matches(':hover')) {
        hideTooltip()
      }
    }, 200)
  }

  /**
   * @param {string} slackId
   * @returns {Promise<Record<string, any>[]|null>}
   */
  async function fetchAuditLogs(slackId) {
    try {
      const userQuery = `SELECT id FROM users WHERE slack_uid = '${slackId}' LIMIT 1`

      console.log('Fetching user ID for slack_uid:', slackId)

      const userResponse = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${API_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query: userQuery }),
      })

      if (!userResponse.ok) {
        throw new Error(`Failed to fetch user: ${userResponse.status}`)
      }

      const userData = await userResponse.json()
      console.log('User data response:', userData)

      const userId = userData.rows?.[0]?.id?.[1]

      if (!userId) {
        console.log('No user ID found for slack_uid:', slackId)
        return null
      }

      console.log('Found user ID:', userId)

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

      console.log('Fetching audit logs for user_id:', userId)

      const logsResponse = await fetch(API_URL, {
        method: 'POST',
        headers: {
          'authorization': `Bearer ${API_TOKEN}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ query: logsQuery }),
      })

      if (!logsResponse.ok) {
        throw new Error(`Failed to fetch logs: ${logsResponse.status}`)
      }

      const logsData = await logsResponse.json()
      console.log('Audit logs response:', logsData)
      console.log('Number of logs:', logsData.rows?.length || 0)

      return logsData.rows || []
    } catch (error) {
      console.error('Error fetching audit logs:', error)
      return null
    }
  }

  /**
   * @param {HTMLButtonElement} btn
   * @param {string} slackId
   * @returns {Promise<void>}
   */
  async function showAuditLogsTooltip(btn, slackId) {
    isLoadingTooltip = true

    const rect = btn.getBoundingClientRect()
    createLoadingTooltip(rect)

    const logs = await fetchAuditLogs(slackId)

    hideTooltip()

    if (!logs || logs.length === 0) {
      createNoLogsTooltip(rect)
    } else {
      createAuditLogsTooltip(rect, logs)
    }

    isLoadingTooltip = false
  }

  /** @param {DOMRect} rect */
  function createLoadingTooltip(rect) {
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
    currentTooltip = tooltip

    tooltip.addEventListener('mouseleave', () => {
      hideTooltip()
    })
  }

  /** @param {DOMRect} rect */
  function createNoLogsTooltip(rect) {
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
    currentTooltip = tooltip

    tooltip.addEventListener('mouseleave', () => {
      hideTooltip()
    })
  }

  /**
   * @param {DOMRect} rect
   * @param {Record<string, any>[]} logs
   */
  function createAuditLogsTooltip(rect, logs) {
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
      .map((/** @type {Record<string, any>} */ log) => {
        const prevLevel = /** @type {string|undefined} */ (
          log.previous_trust_level?.[1]
        )
        const newLevel = /** @type {string|undefined} */ (
          log.new_trust_level?.[1]
        )
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
              by ${escapeHtml(changedBy)}
            </div>
            ${
              reason
                ? `<div style="color: #d1d5db; font-size: 11px; margin-top: 2px;">${escapeHtml(
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
    currentTooltip = tooltip

    tooltip.addEventListener('mouseleave', () => {
      hideTooltip()
    })
  }

  function hideTooltip() {
    if (currentTooltip) {
      document.body.removeChild(currentTooltip)
      currentTooltip = null
    }
  }

  /**
   * @param {string} text
   * @returns {string}
   */
  function escapeHtml(text) {
    const div = document.createElement('div')
    div.textContent = text
    return div.innerHTML
  }

  function extractSlackUsers() {
    /** @type {NodeListOf<HTMLButtonElement>} */
    const senderButtons = document.querySelectorAll(
      'button.c-message__sender_button:not([data-trusted="true"])'
    )

    senderButtons.forEach((btn) => {
      const slackId = btn.getAttribute('data-message-sender')
      if (slackId) {
        setTrustLevel(btn, slackId)
      }
    })
  }

  initializeTrustLevels().then(() => {
    extractSlackUsers()

    const observer = new MutationObserver(() => extractSlackUsers())
    observer.observe(document.body, { childList: true, subtree: true })

    console.log('Slack Shinigami Eyes loaded successfully!')
  })
}
