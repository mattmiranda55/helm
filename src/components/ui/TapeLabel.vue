<script setup>
/** A machine's name on a strip of label-maker tape — how boxes in the closet are labelled. */
defineProps({
  big: { type: Boolean, default: false },
})
</script>

<template>
  <span class="tape" :class="{ big }" translate="no"><slot /></span>
</template>

<style scoped>
.tape {
  display: inline-block;
  background: var(--color-tape);
  color: var(--color-tape-ink);
  font-family: var(--font-mono);
  font-weight: 700;
  font-size: 14px;
  line-height: 1;
  padding: 6px 10px 5px;
  border-radius: 3px;
  transform: rotate(-0.8deg);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.12),
    0 1px 0 rgb(0 0 0 / 0.12);
  white-space: nowrap;
}
.big {
  font-size: 20px;
  padding: 8px 14px 7px;
}
</style>
