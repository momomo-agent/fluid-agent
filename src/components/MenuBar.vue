<script setup>
import { ref, onMounted, onUnmounted } from 'vue'

const time = ref('')

function updateClock() {
  const now = new Date()
  time.value = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

let timer
onMounted(() => { updateClock(); timer = setInterval(updateClock, 30000) })
onUnmounted(() => clearInterval(timer))
</script>

<template>
  <div id="menu-bar">
    <div class="menu-left">
      <span class="menu-logo">✦</span>
      <span class="menu-app-name">FluidOS</span>
    </div>
    <div class="menu-right">
      <span class="menu-clock">{{ time }}</span>
    </div>
  </div>
</template>
