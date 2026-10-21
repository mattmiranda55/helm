<script setup>
/**
 * Pick one of a few options, e.g. which machine. A native iOS segmented control.
 *
 * v-model works on ion-segment directly: Ionic Vue's wrapper binds `value` and
 * updates it on ionChange (fired once a tap or swipe settles, not while
 * dragging across buttons). Option values are strings, so no coercion needed.
 * https://ionicframework.com/docs/api/segment
 */
import { IonLabel, IonSegment, IonSegmentButton } from '@ionic/vue'

const model = defineModel({ type: String })

defineProps({
  /** [{ value, label }] */
  options: { type: Array, required: true },
  label: { type: String, required: true },
})
</script>

<template>
  <ion-segment v-model="model" :scrollable="options.length > 3" :aria-label="label">
    <ion-segment-button v-for="option in options" :key="option.value" :value="option.value">
      <ion-label>{{ option.label }}</ion-label>
    </ion-segment-button>
  </ion-segment>
</template>
