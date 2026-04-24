<script setup>
const props = defineProps({ win: Object })
</script>

<template>
  <div class="image-viewer">
    <img :src="win?.data?.src" :alt="win?.title || ''" />
  </div>
</template>

<style scoped>
.image-viewer { display: flex; align-items: center; justify-content: center; height: 100%; background: #111; }
.image-viewer img { max-width: 100%; max-height: 100%; object-fit: contain; }
</style>
