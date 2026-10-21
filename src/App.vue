<template>
  <!-- ion-app is Ionic's root (it hosts overlays and sets up focus handling);
       the outlet renders the top-level routes: the tabs shell and /setup. -->
  <ion-app>
    <ion-router-outlet />
  </ion-app>
</template>

<script setup>
import { IonApp, IonRouterOutlet } from '@ionic/vue'
</script>
