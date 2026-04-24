import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { request as httpsRequest } from 'https'
import { request as httpRequest } from 'http'

function apiProxyPlugin() {
  return {
    name: 'api-proxy',
    configureServer(server) {
      // Must use a middleware that matches all paths starting with /api/proxy
      server.middlewares.use((req, res, next) => {
        if (!req.url.startsWith('/api/proxy')) return next()

        const baseUrl = req.headers['x-base-url'] || 'https://api.anthropic.com'
        console.log(`[proxy] ${req.method} ${req.url} → ${baseUrl}`)

        let targetUrl
        try {
          targetUrl = new URL(baseUrl)
        } catch {
          targetUrl = new URL('https://api.anthropic.com')
        }

        // The agentic bundle sends everything to /api/proxy
        // The actual API endpoint is baseUrl + /v1/messages
        // req.url after stripping /api/proxy is usually empty or /
        const stripped = req.url.replace(/^\/api\/proxy/, '') || ''
        
        // Build full path: baseUrl path + /v1/messages (if not already included)
        const basePath = targetUrl.pathname === '/' ? '' : targetUrl.pathname.replace(/\/$/, '')
        let fullPath
        if (stripped && stripped !== '/') {
          fullPath = basePath + stripped
        } else {
          // Default: append /v1/messages for Anthropic
          fullPath = basePath + '/v1/messages'
        }

        console.log(`[proxy] Target: ${targetUrl.host}${fullPath}`)

        // Collect body
        const chunks = []
        req.on('data', chunk => chunks.push(chunk))
        req.on('end', () => {
          const body = Buffer.concat(chunks)

          // Forward headers, remove custom ones
          const headers = {}
          for (const [key, val] of Object.entries(req.headers)) {
            const k = key.toLowerCase()
            if (['host', 'x-base-url', 'x-provider', 'connection'].includes(k)) continue
            headers[key] = val
          }
          headers['host'] = targetUrl.host

          const isHttps = targetUrl.protocol === 'https:'
          const reqFn = isHttps ? httpsRequest : httpRequest

          const proxyReq = reqFn({
            hostname: targetUrl.hostname,
            port: targetUrl.port || (isHttps ? 443 : 80),
            path: fullPath,
            method: req.method,
            headers
          }, (proxyRes) => {
            // Forward response headers
            const resHeaders = {}
            for (const [key, val] of Object.entries(proxyRes.headers)) {
              resHeaders[key] = val
            }
            res.writeHead(proxyRes.statusCode, resHeaders)
            proxyRes.pipe(res)
          })

          proxyReq.on('error', (err) => {
            console.error('[proxy] Error:', err.message)
            if (!res.headersSent) {
              res.writeHead(502, { 'content-type': 'application/json' })
              res.end(JSON.stringify({ error: err.message }))
            }
          })

          if (body.length > 0) proxyReq.write(body)
          proxyReq.end()
        })
      })
    }
  }
}

export default defineConfig({
  plugins: [vue(), apiProxyPlugin()],
  server: {
    port: 8765,
    host: true
  }
})
