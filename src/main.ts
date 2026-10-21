import { createApp } from 'vue'
import App from './App.vue'
import router from './router';

import { IonicVue } from '@ionic/vue';

/* Ionic's global stylesheets, in the documented order.
 * https://ionicframework.com/docs/layout/global-stylesheets
 *
 * core.css is required; normalize.css, structure.css and typography.css are
 * the recommended baseline: cross-browser element defaults; box-sizing and a
 * fixed, non-scrolling body so only ion-content scrolls; and the type base.
 *
 * typography.css sizes <html> from the system text size on iOS
 * (-apple-system-body), which is Dynamic Font Scaling: everything sized in
 * rem — Ionic's controls and helm's own type alike — follows the iPhone's
 * text-size setting. That is why helm sizes all text in rem, never px.
 * https://ionicframework.com/docs/layout/dynamic-font-scaling
 */
import '@ionic/vue/css/core.css';
import '@ionic/vue/css/normalize.css';
import '@ionic/vue/css/structure.css';
import '@ionic/vue/css/typography.css';

/* Ionic's CSS utility classes (ion-padding, ion-justify-content-between,
 * ion-text-wrap…), used instead of a separate utility framework. Only the
 * sheets helm uses are imported; the rest are optional.
 * https://ionicframework.com/docs/layout/css-utilities */
import '@ionic/vue/css/padding.css';
import '@ionic/vue/css/flex-utils.css';
import '@ionic/vue/css/text-alignment.css';
import '@ionic/vue/css/display.css';

/* Follow the device's light/dark setting, like the tokens in main.css do.
 * variables.css then overrides the palette with helm's own colors.
 * https://ionicframework.com/docs/theming/dark-mode#system */
import '@ionic/vue/css/palettes/dark.system.css';

/* helm's tokens, fonts and shared classes, then Ionic's variables mapped onto
 * them. Both come after Ionic's CSS so they override it. */
import './theme/main.css';
import './theme/variables.css';

const app = createApp(App)
  // Force iOS mode on every platform: helm is an iPhone home-screen app and the
  // design was drawn iOS-style, so desktop browsers and Android get the same
  // look instead of Material Design. Global config is the documented way to
  // set it (mode="…" on single components is for one-off exceptions).
  // https://ionicframework.com/docs/developing/config
  // https://ionicframework.com/docs/theming/platform-styles
  .use(IonicVue, { mode: 'ios' })
  .use(router);

// Mount after the first navigation resolves (including the setup guard), so
// the router outlet renders the right page from the start instead of
// transitioning to it.
router.isReady().then(() => {
  app.mount('#app');
});
