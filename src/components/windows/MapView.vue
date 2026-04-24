<script setup>
import { ref, onMounted } from 'vue'
const props = defineProps({ win: Object })
const lat = ref(props.win.data?.lat || 39.9042)
const lng = ref(props.win.data?.lng || 116.4074)
</script>
<template>
  <div class="map-view">
    <iframe
      :src="`https://www.openstreetmap.org/export/embed.html?bbox=${lng-0.05},${lat-0.03},${lng+0.05},${lat+0.03}&layer=mapnik&marker=${lat},${lng}`"
      class="map-frame"
    />
  </div>
</template>
<style scoped>
.map-view { height: 100%; }
.map-frame { width: 100%; height: 100%; border: none; }
</style>
