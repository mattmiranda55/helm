# helm redesign — plan

Skills used: `frontend-design` (plan → review → build → critique) and
`redesign-existing-projects` (scan → diagnose → fix), from skills.sh.
Prototype: [index.html](index.html), a static, clickable mock with sample data.

## Brief

- **Subject:** a homelab — a couple of small machines in a closet, the apps and
  containers they run, and a shell into them.
- **Audience:** one person, mostly on a phone (home-screen PWA), sometimes on a
  desktop.
- **Primary job:** answer "is anything wrong?" in one glance, then get to the
  fix (open the app, restart the container, open a shell) in one or two taps.
- **Constraints from you:** mobile first, multiple pages are fine, simplicity
  and ease of use over density.

## Audit of the current UI (redesign-existing-projects)

| Finding | Where | Fix |
|---|---|---|
| One page holds everything; on a phone it stacks into a very long scroll with services above metrics | `App.vue`, `SidePane.vue` | Split into pages: Machines, Apps, Containers, Terminal |
| All-caps tracked labels everywhere (CPU, MEMORY, USED, INFRASTRUCTURE) | tiles, panels, service groups | Sentence case |
| Meta strings joined with middle dots ("244 procs · 717 threads") | StatTile captions | Separate lines or plain sentences |
| Tinted near-black `#0b0b0b` plane, monospace for brand and small data labels | `main.css`, TopBar | Steel-blue dark surface, one proportional family with tabular figures |
| Same 12px radius + border on every block (the "card kit") | every panel | Cards only for things you tap; sections otherwise separated by space |
| Charts get fixed big boxes even when flat (CPU panel is mostly empty at 5%) | CpuPanel | Chart height follows importance; numbers lead, charts support |
| Healthy state is shown as loudly as broken state ("running" on 12 of 15 services) | ServicesPanel | Show state only when it's abnormal |
| No sense of "where am I" — node tabs and pane tabs are hidden state | TopBar, SidePane | Real pages with an active nav item and back links |
| System font only, two weights | `main.css` | Archivo, variable width + weight |

Keep: the validated series and status hues, opt-in process list, alert rule
that `exited` is a manual stop (not an alert), local-only container actions,
URL-addressable views.

## Design plan (frontend-design)

**Color** — color means data or state, nothing else. No brand accent.

| Token | Light | Dark |
|---|---|---|
| bg | `#eceef0` cool grey | `#1a1e22` rack steel |
| surface | `#ffffff` | `#22272c` |
| ink | `#15181b` | `#eef0f2` |
| muted | `#6b727a` | `#8a929a` |
| tape | `#15181b` black tape, white print | `#eceee6` white tape, black print |

Series and status colors stay as validated in `main.css` (light-mode steps
added).

**Type** — one family, Archivo, used in two widths: condensed + heavy for
numbers and machine labels (gauge-like, fits four readings across a phone),
normal width for everything else. Tabular figures throughout. Sentence case.

**The one bold thing** — machines are identified by a strip of label-maker
tape, the way homelabbers actually label boxes in the closet. Everything else
stays quiet.

**Layout**

```
Phone                               Desktop (≥ 860px)
┌──────────────────────┐            ┌──────────────────────────────────────────┐
│ helm            ● Live│            │ helm   Machines  Apps  Containers  Term ●│
│                      │            ├──────────────────────────────────────────┤
│ Needs attention (2)  │            │ Needs attention                          │
│ ▸ rdtclient restarting│            │ ▸ rdtclient …        ▸ Disk / 91% …      │
│ ▸ Disk / 91% full    │            │                                          │
│                      │            │ ┌ [Basestation] ────┐ ┌ [MagicMirror] ──┐ │
│ ┌ [Basestation] ───┐ │            │ │ 5%  18%  35%  44° │ │ 24% 61% 91% 62°│ │
│ │ 5%  18%  35%  44°│ │            │ │ ~~~~~~~~~~~~~~~~~ │ │ ~~~~~~~~~~~~~~ │ │
│ │ ~~~~~~~~~~~~~~~~ │ │            │ └───────────────────┘ └────────────────┘ │
│ └──────────────────┘ │            │ Favorites  ▢ ▢ ▢ ▢                       │
│ ┌ [MagicMirror] ───┐ │            └──────────────────────────────────────────┘
│ └──────────────────┘ │
│ Favorites ▢ ▢ ▢ ▢     │
├──────────────────────┤
│ ▣ Machines ▦ Apps ⬡ … │  ← tab bar, thumb reach
└──────────────────────┘
```

Pages: **Machines** (overview) → **Machine** detail · **Apps** (launcher) ·
**Containers** (grouped by stack) · **Terminal**. Actions open a bottom sheet
on a phone and a side panel on desktop. Destructive actions confirm inline
("Tap again to stop"), never with a modal.

**Principles**

1. Answer "is anything wrong?" before showing any number.
2. Show state only when it's abnormal; healthy is the quiet default.
3. Say it in words: "Disk / is 91% full, 2.6 GB left", not a red bar alone.
4. Every action is reachable with a thumb and named for what it does.

## Revisions (round 2)

- **Apps is the launcher, Containers is management.** Apps shows only running
  apps as an icon grid sized to the screen width (4 columns on a phone, 6 and 8
  wider), no search, no per-app menu. A line under the grid counts the hidden
  stopped apps and links to Containers.
- **Favorites moved to the top** of Machines, above Needs attention.

## Revisions (round 3)

- **Fonts:** Quicksand (400–700) for all text; Space Mono (400/700) for
  numbers, machine labels, container images, the terminal and logs. When this
  ships, bundle both through Vite (e.g. `@fontsource-variable/quicksand`,
  `@fontsource/space-mono`) so the tailnet app doesn't call Google Fonts.
- **App icons** from homarr-labs/dashboard-icons (the set Homepage uses), with
  the initials as a fallback. In helm this becomes an optional `icon` field on
  each service in config.json.
- **Icons are cached, not hot-linked.** The prototype embeds them (fetched
  once, shrunk to 128px, 161 KB total). In helm the server owns the cache:
  `GET /api/icons/:slug` validates the slug (`[a-z0-9-]+`), serves
  `~/.cache/helm/icons/<slug>.png` if present, otherwise fetches it once from
  dashboard-icons with `fetch()`, writes it to disk and serves it with
  `Cache-Control: public, max-age=31536000, immutable`. Built-ins only, so
  the no-runtime-dependencies rule holds; the browser never talks to a CDN,
  and after the first view the server doesn't either. A failed fetch returns
  404 and the UI shows initials.
- **Container image names** under each container are 11px Space Mono, a
  quiet note rather than a second title.
- **Terminal fits the width:** output wraps instead of scrolling sideways,
  12px text and tighter margins on phones, and the extra-keys row is a
  9-column grid instead of a scroller. In the real xterm build the equivalent
  is a smaller `fontSize` on narrow screens so FitAddon gets more columns.

## Review against the brief

- *Near-black with one bright accent* was the current look and is the most
  common generated dashboard. Revised to a steel-blue dark and a cool-grey
  light theme with **no** accent hue — color is reserved for data and state.
- *Left sidebar on desktop* is the dashboard default. Revised to a top nav;
  there are only four destinations.
- *Big-number tiles opening the page* is the default hero. Revised: the page
  opens with "Needs attention" (or a one-line all-clear), because that is the
  job; numbers come second.
- *Monospace small labels* — dropped; the terminal is the only monospace.
