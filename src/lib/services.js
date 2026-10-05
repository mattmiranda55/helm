/** Helpers for the configured services (the app launcher). */

/**
 * Live state of a service's container, read from the metrics already on hand.
 * 'none' = not tied to a container (always shown); 'unknown' = its machine
 * hasn't reported yet.
 */
export function serviceState(service, snapshots) {
  if (!service.container) return 'none'
  const ids = service.node ? [service.node] : Object.keys(snapshots)
  let reported = false
  for (const id of ids) {
    const metrics = snapshots[id]?.metrics
    if (!metrics) continue
    reported = true
    const container = metrics.containers.find((c) => c.name === service.container)
    if (container) return container.status === 'healthy' ? 'running' : container.status
  }
  return reported ? 'missing' : 'unknown'
}

/** Shown in the launcher: running, not container-backed, or not known yet. */
export const isOpenable = (state) => state === 'running' || state === 'none' || state === 'unknown'

/**
 * dashboard-icons slug. `icon` of one or two characters means "use these as
 * initials"; anything longer is a slug; otherwise the name is tried as one.
 */
export function iconSlug(service) {
  const icon = service.icon?.trim()
  if (icon && icon.length <= 2) return null
  const source = icon || service.name
  const slug = source
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return slug || null
}

export function initials(service) {
  const icon = service.icon?.trim()
  if (icon && icon.length <= 2) return icon
  return service.name.slice(0, 2)
}
