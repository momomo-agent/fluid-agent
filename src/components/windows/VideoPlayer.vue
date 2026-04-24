<script setup>
import { ref } from 'vue'
const props = defineProps({ win: Object })
const url = ref(props.win.data?.url || '')
</script>
<template>
  <div class="video-player">
    <video v-if="url" :src="url" controls autoplay class="video-el" />
    <div v-else class="video-empty">No video loaded</div>
  </div>
</template>
<style scoped>
.video-player { display: flex; align-items: center; justify-content: center; height: 100%; background: #000; }
.video-el { max-width: 100%; max-height: 100%; }
.video-empty { color: #666; }
</style>
