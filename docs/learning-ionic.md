# Learning Ionic with helm

A short tour of the Ionic concepts this app uses, in the order you meet them
when reading the code. Each section names the concept, links the Ionic docs,
and points at the lines in helm that use it. helm is Ionic Vue 9, plain JS
`<script setup>`, run as an iOS home-screen web app (no Capacitor).

Line numbers are a snapshot; if they drift, search for the quoted code.

---

## 1. Bootstrapping

- **`IonicVue` plugin** installs Ionic and its config. helm forces iOS styling
  on every platform with `mode: 'ios'`. → [main.ts:51](../src/main.ts#L51) ·
  [Config](https://ionicframework.com/docs/developing/config) ·
  [Platform styles](https://ionicframework.com/docs/theming/platform-styles)
- **Global CSS, in the documented order**: `core.css` (required), then
  `normalize.css`, `structure.css` and `typography.css` (recommended).
  → [main.ts:20](../src/main.ts#L20) ·
  [Global stylesheets](https://ionicframework.com/docs/layout/global-stylesheets)
- **Dynamic Font Scaling** comes with `typography.css`. On iOS it sizes
  `<html>` from the system text size, so anything in `rem` follows the
  iPhone's text-size setting. That's why helm sizes all text in `rem`, never `px`.
  → [main.ts:23](../src/main.ts#L23) ·
  [Dynamic font scaling](https://ionicframework.com/docs/layout/dynamic-font-scaling)
- **CSS utilities** (`ion-padding`, `ion-justify-content-between`,
  `ion-text-wrap`…) come from `padding.css`, `flex-utils.css`, etc.
  → [main.ts:30](../src/main.ts#L30) ·
  [CSS utilities](https://ionicframework.com/docs/layout/css-utilities)
- **Mount after `router.isReady()`**, so the first page renders with its route
  resolved. → [main.ts:57](../src/main.ts#L57)
- **Root component** is just `<ion-app>` wrapping `<ion-router-outlet>`.
  → [App.vue:4](../src/App.vue#L4)

## 2. Routing and tabs

- **`createRouter` comes from `@ionic/vue-router`**, not `vue-router`. Ionic's
  router adds page transitions and a stack per outlet.
  → [router/index.ts:50](../src/router/index.ts#L50) ·
  [Vue navigation](https://ionicframework.com/docs/vue/navigation)
- **Tabs are a layout route** (`TabsPage`) with child routes. Every page under
  it gets the tab bar. Pages are lazy-loaded with `() => import(...)`.
  → [router/index.ts:37](../src/router/index.ts#L37)
- **Routes outside the tabs** have no tab bar (the setup wizard).
  → [router/index.ts:34](../src/router/index.ts#L34)
- **`ion-tabs` + `ion-tab-bar` + `ion-tab-button href`**: the active tab is
  picked by matching the URL against each button's `href` as a prefix, so
  `/machines/nas` belongs to the Machines tab.
  → [TabsPage.vue:69](../src/components/layout/TabsPage.vue#L69) ·
  [Tabs](https://ionicframework.com/docs/api/tabs) ·
  [Working with tabs](https://ionicframework.com/docs/vue/navigation#working-with-tabs)
- **Rule: only the tab bar switches tabs.** Each tab keeps its own history
  stack, and page content never navigates into another tab, so helm has no
  "See all" shortcuts. A view that several tabs need is a **modal**: Machines
  opens the container sheet in place
  ([MachinesPage.vue:121](../src/pages/MachinesPage.vue#L121)), and Settings
  is one modal for the whole app (§8).
  [Switching tabs](https://ionicframework.com/docs/vue/navigation#switching-between-tabs)

## 3. Anatomy of a page

Every routed page must be **`IonPage` > `IonHeader` + `IonContent`** (+ an
optional `IonFooter`). Without `IonPage`, transitions and lifecycle hooks
silently break. helm puts this in one component, `HelmPage`:

- `<ion-page>` as the single root → [HelmPage.vue:96](../src/components/layout/HelmPage.vue#L96)
- **Collapsible large title** (the iOS Settings look) needs three parts: a
  `translucent` header, `fullscreen` content, and a second header inside the
  content with `collapse="condense"` and `<ion-title size="large">`.
  → [HelmPage.vue:97](../src/components/layout/HelmPage.vue#L97),
  [:117](../src/components/layout/HelmPage.vue#L117) ·
  [Collapsible large titles](https://ionicframework.com/docs/api/title#collapsible-large-titles)
- **`ion-back-button default-href`** shows a back button that works even on a
  deep link with no history. → [HelmPage.vue:100](../src/components/layout/HelmPage.vue#L100) ·
  [Back button](https://ionicframework.com/docs/api/back-button)
- **Toolbar slots**: `ion-buttons slot="start|end"` place buttons. The
  Settings gear opens the Settings modal; it doesn't route.
  → [HelmPage.vue:108](../src/components/layout/HelmPage.vue#L108) ·
  [Toolbar](https://ionicframework.com/docs/api/toolbar)
- **Scrolling lives in `ion-content`**, never in a wrapper div. For a
  full-height widget that must not scroll (the terminal), use
  `scroll-y="false"` (HelmPage's `fill` prop).
  → [HelmPage.vue:115](../src/components/layout/HelmPage.vue#L115) ·
  [Content](https://ionicframework.com/docs/api/content)
- **`slot="fixed"`** children of `ion-content` don't scroll with it. That's
  where `ion-refresher` (and FABs) go. →
  [HelmPage.vue:116](../src/components/layout/HelmPage.vue#L116)

## 4. Page lifecycle: pages stay mounted

This is the biggest mental shift from plain Vue. `ion-router-outlet` keeps
pages in the DOM after you leave them, and each tab keeps its own stack. So
`onMounted` fires once, not on every visit, and a page you left keeps running.

- **Use `onIonViewWillEnter` / `DidEnter` / `WillLeave` / `DidLeave`** for
  "every time this page shows / hides". They only fire on the routed page
  component, not its children.
  [Vue lifecycle](https://ionicframework.com/docs/vue/lifecycle)
- **helm turns them into a ref**, so pollers can pause off screen:
  [usePageActive.js:24](../src/composables/usePageActive.js#L24), used by
  [useMetrics.js:106](../src/composables/useMetrics.js#L106). Without this,
  every tab you'd visited would keep polling.
- **Measure after the transition**: the terminal refits xterm in
  `onIonViewDidEnter`, once the page has its real size.
  → [TerminalPage.vue:35](../src/pages/TerminalPage.vue#L35)
- The same cause explains the terminal surviving tab switches: its page is
  simply never unmounted.
- **`useRoute()` is the *current* route**, even inside a page that's in the
  background. Pages that read query state freeze their own copy.
  → [useQuery.js:13](../src/composables/useQuery.js#L13)
- **`ion-nav` pages are different.** The Settings modal's pages get none of
  these hooks in Vue; only `ion-router-outlet` fires them. Each push creates
  a fresh component, so those pages load in `onMounted`. Lists refresh after a
  save by watching the shared config.
  → [MachinesSettings.vue:45](../src/components/settings/MachinesSettings.vue#L45),
  [editing.js:139](../src/components/settings/editing.js#L139)

## 5. Navigating

- **`router-link`** on `ion-button`, `ion-item` and `ion-card` is the
  declarative way. → [MachineCard.vue:79](../src/components/machines/MachineCard.vue#L79) ·
  [router-link](https://ionicframework.com/docs/vue/navigation#navigating-using-router-link).
  `<ion-router-link>` is for vanilla/Stencil apps, not Ionic Vue; in Vue it
  triggers a full page reload.
- **`useIonRouter()`** is the programmatic way, with direction: `push`,
  `back`, and `replace`. Switching machines replaces the page, so Back still
  goes to the list. → [MachinePage.vue:70](../src/pages/MachinePage.vue#L70) ·
  [useIonRouter](https://ionicframework.com/docs/vue/navigation#navigating-using-useionrouter)
- **Navigation without URLs** happens inside a modal, with `ion-nav`
  (see §8).

## 6. Lists and items

- **`ion-list inset`** gives the rounded iOS grouped-table look.
  `ion-item button detail` makes a tappable row with a chevron.
  → [ContainerRow.vue:40](../src/components/containers/ContainerRow.vue#L40) ·
  [List](https://ionicframework.com/docs/api/list) ·
  [Item](https://ionicframework.com/docs/api/item)
- **Item vocabulary**: put `<h3>`/`<p>` inside `ion-label`, and short
  metadata in `ion-note slot="end"`.
  → [ContainerRow.vue:48](../src/components/containers/ContainerRow.vue#L48) ·
  [Item metadata](https://ionicframework.com/docs/api/item#metadata)
- **`ion-text-wrap` / `ion-text-nowrap`** decide whether a label wraps or
  ellipsizes.
- **Loading placeholders**: `ion-skeleton-text animated`.
  → [MachineCard.vue:94](../src/components/machines/MachineCard.vue#L94) ·
  [Skeleton text](https://ionicframework.com/docs/api/skeleton-text)

## 7. Forms (Ionic 8+ syntax)

- **Labels go on the control**, not in a sibling `ion-label`:
  `<ion-input label="Name" label-placement="fixed">`.
  → [ServerForm.vue:175](../src/components/setup/ServerForm.vue#L175) ·
  [Input labels](https://ionicframework.com/docs/api/input#labels)
- **Validation**: set `helper-text` / `error-text` on the input. The error
  shows when the element has the `ion-touched` and `ion-invalid` classes.
  → [ServerForm.vue:165](../src/components/setup/ServerForm.vue#L165) ·
  [Helper & error text](https://ionicframework.com/docs/api/input#helper--error-text)
- **Password field**: put `<ion-input-password-toggle slot="end">` inside the
  `ion-input`. → [SettingsRoot.vue:269](../src/components/settings/SettingsRoot.vue#L269)
- **Ionic 9 gotcha:** `autocorrect` is a boolean, so `autocorrect="off"` turns
  it **on**. Bind `:autocorrect="false"`.
  → [SettingsRoot.vue:265](../src/components/settings/SettingsRoot.vue#L265) ·
  [Ionic 9 breaking changes](https://github.com/ionic-team/ionic-framework/blob/main/BREAKING.md)
- **Toggles with a second line**: use the toggle's own `helper-text`.
  → [ServicesEditor.vue:135](../src/components/setup/ServicesEditor.vue#L135) ·
  [Toggle](https://ionicframework.com/docs/api/toggle)
- **Radio choices**: `ion-radio-group v-model` around `ion-radio`s.
  → [SetupPage.vue:599](../src/pages/SetupPage.vue#L599) ·
  [Radio](https://ionicframework.com/docs/api/radio)
- **A submit button outside the form**: `<ion-button type="submit"
  form="setup-form">`. Ionic adds a hidden native button so Enter and a tap
  both submit. → [SetupPage.vue:872](../src/pages/SetupPage.vue#L872) ·
  [Button](https://ionicframework.com/docs/api/button)
- **`v-model` on `ion-input`** updates on `ionInput` (every keystroke).
  `ionChange` fires on commit.
- **Segmented control**: `ion-segment v-model` with `ion-segment-button`s.
  → [SegmentedControl.vue:22](../src/components/ui/SegmentedControl.vue#L22) ·
  [Segment](https://ionicframework.com/docs/api/segment)

## 8. Overlays

- **Inline `ion-modal`** (declared in the template, opened with `is-open`) is
  the recommended Vue style. `is-open` is one-way: reset your state in
  `@did-dismiss`, and close it with the element's own `dismiss()`.
  → [BottomSheet.vue:59](../src/components/ui/BottomSheet.vue#L59),
  [:52](../src/components/ui/BottomSheet.vue#L52) ·
  [Modal](https://ionicframework.com/docs/api/modal) ·
  [Using isOpen](https://ionicframework.com/docs/api/modal#using-isopen)
- **Sheet modal**: `breakpoints` plus `initial-breakpoint`. Use
  `expand-to-scroll="false"` so content scrolls at any height, and an
  `ion-footer` to keep actions reachable.
  → [BottomSheet.vue:63](../src/components/ui/BottomSheet.vue#L63) ·
  [Sheet modal](https://ionicframework.com/docs/api/modal#sheet-modal)
- **Card modal + `ion-nav`**, the iOS pattern for a self-contained task with
  its own screens (Settings):
  - **Card style:** `presenting-element` is the page behind, which scales back
    → [SettingsModal.vue:76](../src/components/settings/SettingsModal.vue#L76) ·
    [Card modal](https://ionicframework.com/docs/api/modal#card-modal)
  - **Its own stack:** `ion-nav` inside the modal gives it a URL-less stack,
    so it never touches the tabs' history
    → [SettingsModal.vue:81](../src/components/settings/SettingsModal.vue#L81) ·
    [Nav](https://ionicframework.com/docs/api/nav)
  - **Pushing pages:** declaratively with `ion-nav-link`
    → [MachinesSettings.vue:54](../src/components/settings/MachinesSettings.vue#L54) ·
    [Nav link](https://ionicframework.com/docs/api/nav-link),
    or programmatically with `nav.push()` / `nav.pop()`
    → [editing.js:119](../src/components/settings/editing.js#L119)
  - **No `IonPage` inside ion-nav:** pages are just `ion-header` +
    `ion-content`, and `ion-back-button` pops the nav.
    → [SettingsView.vue:58](../src/components/settings/SettingsView.vue#L58)
- **Guarding unsaved changes**:
  - `can-dismiss` (an async function) covers Done, swipe-down and Escape.
    → [SettingsModal.vue:77](../src/components/settings/SettingsModal.vue#L77) ·
    [Preventing dismiss](https://ionicframework.com/docs/api/modal#preventing-a-modal-from-dismissing)
  - `ion-back-button` can't be refused, so a dirty page swaps it for a
    confirming button. → [SettingsView.vue:47](../src/components/settings/SettingsView.vue#L47)
  - The nav's edge swipe is off while edits are unsaved.
- **Calling an element's method from Vue**: the ref is the Vue wrapper. The
  web component is `ref.value.$el` (e.g. `$el.dismiss()`, `$el.scrollToTop()`).
- **Controllers for awaited prompts**: `actionSheetController` for destructive
  confirms (the red `role: 'destructive'` button and Cancel; the result comes
  from `onDidDismiss`). → [useConfirm.js:31](../src/composables/useConfirm.js#L31)
  · [Action sheet](https://ionicframework.com/docs/api/action-sheet).
  Used by Stop → [ContainerSheet.vue:116](../src/components/containers/ContainerSheet.vue#L116)
- **Toasts**: `toastController`, with `positionAnchor` to sit above the tab bar.
  → [useToast.js:18](../src/composables/useToast.js#L18) ·
  [Toast](https://ionicframework.com/docs/api/toast)

## 9. Pull to refresh

- `<ion-refresher slot="fixed">` as a direct child of `ion-content`. Call
  `event.target.complete()` when the reload finishes.
  → [MachinePage.vue:99](../src/pages/MachinePage.vue#L99),
  [MachinesPage.vue:25](../src/pages/MachinesPage.vue#L25) ·
  [Refresher](https://ionicframework.com/docs/api/refresher)

## 10. Theming

- **Theme through Ionic's CSS variables.** `--ion-background-color`,
  `--ion-text-color`, `--ion-item-background` and the `--ion-color-*` sets
  (each needs `-rgb`, `-contrast`, `-shade` and `-tint`). helm points them at
  its own tokens. → [variables.css:45](../src/theme/variables.css#L45) ·
  [Colors](https://ionicframework.com/docs/theming/colors) ·
  [Themes](https://ionicframework.com/docs/theming/themes)
- **Stepped colors** (`--ion-background-color-step-50…950`) are the greys
  components use. Regenerate them whenever you change background or text.
  → [variables.css:86](../src/theme/variables.css#L86) ·
  [Stepped colors](https://ionicframework.com/docs/theming/themes#stepped-colors)
- **Dark mode** comes from `palettes/dark.system.css`. To override it, your
  selectors must be as specific as the palette's, which is why helm uses
  `:root.ios`. → [main.ts:37](../src/main.ts#L37),
  [variables.css:17](../src/theme/variables.css#L17) ·
  [Dark mode](https://ionicframework.com/docs/theming/dark-mode)
- **Per-component styling**: first the component's own CSS variables
  (`--background`, `--color`…), then its documented shadow parts (`::part(label)`).
  Never reach into internals.
  → [CommandsEditor.vue:177](../src/components/setup/CommandsEditor.vue#L177) ·
  [CSS variables](https://ionicframework.com/docs/theming/css-variables) ·
  [Shadow parts](https://ionicframework.com/docs/theming/css-shadow-parts)
- **Your own type scale on top of `typography.css`**: Ionic styles unstyled
  `h1`–`h6`. helm styles every heading by class, so it resets them and lets
  each class set a `rem` size.
  → [main.css:130](../src/theme/main.css#L130) ·
  [Typography](https://ionicframework.com/docs/layout/typography)

## 11. Gotchas this project actually hit

1. **A universal CSS reset breaks Ionic.** Tailwind's preflight
   (`* { margin: 0; padding: 0 }`) also matches `ion-title`, `ion-button` and
   the rest. A page style on a host element beats the component's `:host`
   style, so they lost their padding. Reset only plain HTML elements.
   → [main.css:115](../src/theme/main.css#L115)
2. **`px` text ignores Dynamic Type.** Only `rem` follows the system text
   size. Even xterm, which needs pixels, scales from the root font size.
   → [TerminalPane.vue:124](../src/components/terminal/TerminalPane.vue#L124)
3. **Inline modals re-render while they animate closed.** If the data goes
   null as `is-open` turns false, keep the last value until `didDismiss`.
4. **Don't patch a modal's `breakpoints` to `undefined`.** Ionic sorts the new
   value, so it crashes on null. Re-create the modal with a `:key` instead.
   → [BottomSheet.vue:60](../src/components/ui/BottomSheet.vue#L60)
5. **Don't put a scroller inside a sheet.** The sheet's drag gesture only
   checks `ion-content`'s scroll position, so an inner scrolling `<pre>`
   fights it. Let `ion-content` do the scrolling.
6. **`ion-item` clips its label.** If an end-slot note grows, the label
   wrapper shrinks and cuts the text. Cap the note's width instead.
   → [MachinePage.vue:164](../src/pages/MachinePage.vue#L164)
7. **Pages in other tabs keep running.** Pause timers and sockets in
   `onIonViewWillLeave` (see §4).
8. **`ion-chip` isn't focusable.** For a tappable control, use `ion-button`
   (or add `role` and `tabindex` yourself).

## Further reading

- [Ionic Vue overview](https://ionicframework.com/docs/vue/overview) ·
  [Component list](https://ionicframework.com/docs/components)
- The skills this repo was audited against, in `.claude/skills/`:
  `ionic-vue`, `ionic-design`, `ionic-app-development`.
