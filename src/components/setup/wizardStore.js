/**
 * The setup wizard's progress, kept in sessionStorage so a reload (or iOS
 * evicting the tab) mid-wizard doesn't lose it. Session-scoped on purpose:
 * it holds the setup code, and once the tab is gone it should be too.
 *
 * `done.token` is the access token minted by a finished setup, kept until
 * it has been shown and saved — the router lets /setup through while it's
 * pending, so a reload on that screen doesn't lose the only copy.
 */
const KEY = 'helm.setup'

export function loadWizard() {
  try {
    const raw = sessionStorage.getItem(KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

export function saveWizard(state) {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    // private mode / quota: progress just won't survive a reload
  }
}

export function clearWizard() {
  try {
    sessionStorage.removeItem(KEY)
  } catch {
    // nothing to clear
  }
}

/** A finished setup whose token hasn't been shown and saved yet. */
export const tokenPending = () => !!loadWizard()?.done?.token
