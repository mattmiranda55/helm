/**
 * App icons, cached on disk.
 *
 * Icons come from homarr-labs/dashboard-icons (the set Homepage uses), keyed by
 * slug — "jellyfin", "pi-hole". The browser only ever asks this server, so a
 * phone on the tailnet never talks to a CDN; the server fetches each icon once,
 * keeps it under ~/.cache/helm/icons, and serves it from there forever after.
 *
 * A slug that isn't in the set is remembered for a while so a typo in
 * config.json doesn't turn every page load into an outbound request. The UI
 * falls back to the service's initials on a 404.
 */
import { mkdir, rename } from 'node:fs/promises'

const SOURCE = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/png/'
const CACHE_DIR = `${process.env.XDG_CACHE_HOME || `${process.env.HOME ?? '/tmp'}/.cache`}/helm/icons`
const MAX_BYTES = 1_000_000
const MISS_TTL_MS = 60 * 60_000
const FETCH_TIMEOUT_MS = 8_000

/** Lowercase letters, digits and dashes — never a path. */
export const isIconSlug = (slug: string) => /^[a-z0-9][a-z0-9-]{0,63}$/.test(slug)

const misses = new Map<string, number>()
const inflight = new Map<string, Promise<boolean>>()

const fileFor = (slug: string) => `${CACHE_DIR}/${slug}.png`

async function download(slug: string): Promise<boolean> {
  const missedAt = misses.get(slug)
  if (missedAt && Date.now() - missedAt < MISS_TTL_MS) return false

  try {
    const response = await fetch(`${SOURCE}${slug}.png`, {
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
    const type = response.headers.get('content-type') ?? ''
    if (!response.ok || !type.startsWith('image/png')) {
      misses.set(slug, Date.now())
      return false
    }
    const body = new Uint8Array(await response.arrayBuffer())
    if (body.byteLength === 0 || body.byteLength > MAX_BYTES) {
      misses.set(slug, Date.now())
      return false
    }
    await mkdir(CACHE_DIR, { recursive: true })
    // Write-then-rename, so a half-written file is never served as an icon.
    const temp = `${fileFor(slug)}.${process.pid}.tmp`
    await Bun.write(temp, body)
    await rename(temp, fileFor(slug))
    misses.delete(slug)
    return true
  } catch {
    // Offline or slow: not the slug's fault, so don't remember it as missing.
    return false
  }
}

/** The cached icon, fetching it first if this is the first time it's asked for. */
export async function iconFile(slug: string): Promise<Bun.BunFile | null> {
  const file = Bun.file(fileFor(slug))
  if (await file.exists()) return file

  let pending = inflight.get(slug)
  if (!pending) {
    pending = download(slug).finally(() => inflight.delete(slug))
    inflight.set(slug, pending)
  }
  return (await pending) ? Bun.file(fileFor(slug)) : null
}
