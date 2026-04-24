<script setup>
import { ref, onMounted, onUnmounted } from 'vue'
import { useEventBus } from '../../composables/useEventBus'

const props = defineProps({ win: Object })
const bus = useEventBus()
const iframeEl = ref(null)

const lat = props.win?.data?.lat || 39.9042
const lng = props.win?.data?.lng || 116.4074
const zoom = props.win?.data?.zoom || 12

function buildMapDoc() {
  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"><\/script>
<style>*{margin:0;padding:0;box-sizing:border-box}html,body,#map{width:100%;height:100%}
.search-bar{position:absolute;top:10px;left:50px;right:10px;z-index:1000;display:flex;gap:6px}
.search-bar input{flex:1;padding:8px 12px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(22,27,38,0.9);color:#e2e8f0;font-size:13px;backdrop-filter:blur(8px);outline:none}
.search-bar input:focus{border-color:#60a5fa}
.search-bar button{padding:8px 10px;border-radius:8px;border:1px solid rgba(255,255,255,0.15);background:rgba(22,27,38,0.9);color:#94a3b8;font-size:13px;cursor:pointer;backdrop-filter:blur(8px)}
.coords{position:absolute;bottom:8px;left:8px;z-index:1000;background:rgba(22,27,38,0.85);color:#94a3b8;padding:4px 8px;border-radius:6px;font-size:11px;backdrop-filter:blur(8px)}
</style></head><body>
<div class="search-bar"><input id="search" placeholder="Search location..."/><button id="btn-pin">📍</button><button id="btn-clear">🗑</button></div>
<div id="map"></div>
<div class="coords" id="coords">${lat.toFixed(4)}, ${lng.toFixed(4)}</div>
<script>
var map=L.map('map',{zoomControl:false}).setView([${lat},${lng}],${zoom});
L.control.zoom({position:'topright'}).addTo(map);
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{attribution:'© OpenStreetMap',maxZoom:19}).addTo(map);
var markers=[];
function addMarker(lat,lng,label,color){var c={'red':'#ef4444','blue':'#3b82f6','green':'#22c55e','orange':'#f97316','purple':'#a855f7'}[color||'blue']||'#3b82f6';var m=L.marker([lat,lng],{icon:L.divIcon({className:'',html:'<div style="width:24px;height:24px;border-radius:50% 50% 50% 0;background:'+c+';transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,0.4)"></div>',iconSize:[24,24],iconAnchor:[12,24],popupAnchor:[0,-24]})}).addTo(map);if(label)m.bindPopup(label);markers.push(m)}
function clearMarkers(){markers.forEach(function(m){map.removeLayer(m)});markers=[]}
map.on('click',function(e){addMarker(e.latlng.lat,e.latlng.lng,'','blue')});
map.on('mousemove',function(e){document.getElementById('coords').textContent=e.latlng.lat.toFixed(4)+', '+e.latlng.lng.toFixed(4)});
document.getElementById('btn-pin').addEventListener('click',function(){var c=map.getCenter();addMarker(c.lat,c.lng,'Pin','red')});
document.getElementById('btn-clear').addEventListener('click',function(){clearMarkers()});
document.getElementById('search').addEventListener('keydown',function(e){if(e.key!=='Enter')return;var q=this.value.trim();if(!q)return;fetch('https://nominatim.openstreetmap.org/search?format=json&q='+encodeURIComponent(q)).then(function(r){return r.json()}).then(function(data){if(data&&data.length>0){var lat=parseFloat(data[0].lat),lon=parseFloat(data[0].lon);map.setView([lat,lon],14);addMarker(lat,lon,data[0].display_name,'red')}})});
<\/script></body></html>`
}

function onMapMarker({ lat, lng, label, color }) {
  const iframe = iframeEl.value
  if (iframe?.contentWindow?.addMarker) iframe.contentWindow.addMarker(lat, lng, label, color)
}

function onMapClear() {
  const iframe = iframeEl.value
  if (iframe?.contentWindow?.clearMarkers) iframe.contentWindow.clearMarkers()
}

onMounted(() => {
  bus.on('map.marker', onMapMarker)
  bus.on('map.clearMarkers', onMapClear)
})

onUnmounted(() => {
  bus.off('map.marker', onMapMarker)
  bus.off('map.clearMarkers', onMapClear)
})
</script>

<template>
  <div class="map-container">
    <iframe ref="iframeEl" :srcdoc="buildMapDoc()" sandbox="allow-scripts allow-same-origin" />
  </div>
</template>

<style scoped>
.map-container { width: 100%; height: 100%; }
.map-container iframe { width: 100%; height: 100%; border: none; }
</style>
