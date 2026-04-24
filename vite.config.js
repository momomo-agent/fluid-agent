import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

export default defineConfig({
  plugins: [vue()],
  server: {
    port: 8765,
    proxy: {
      '/api/proxy': {
        target: 'https://api.anthropic.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proxy/, ''),
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, req) => {
            // Forward custom headers
            const baseUrl = req.headers['x-base-url']
            if (baseUrl) {
              const url = new URL(baseUrl + proxyReq.path)
              proxyReq.setHeader('host', url.host)
            }
          })
        }
      }
    }
  }
})
