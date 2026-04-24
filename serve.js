#!/usr/bin/env node
// Simple static file server for Fluid Agent
const http = require('http')
const fs = require('fs')
const path = require('path')

const PORT = parseInt(process.argv[2]) || 8765
const ROOT = __dirname

const MIME = {
  '.html': 'text/html', '.css': 'text/css', '.js': 'application/javascript',
  '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff',
  '.ttf': 'font/ttf', '.mp3': 'audio/mpeg', '.wav': 'audio/wav'
}

const server = http.createServer((req, res) => {
  // CORS proxy for LLM API calls
  if (req.url.startsWith('/api/proxy')) {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, x-api-key, x-base-url, anthropic-version, authorization',
        'Access-Control-Max-Age': '86400'
      })
      return res.end()
    }
    let body = ''
    req.on('data', c => body += c)
    req.on('end', async () => {
      const baseUrl = req.headers['x-base-url'] || 'https://api.anthropic.com'
      const apiPath = req.url.replace('/api/proxy', '') || '/v1/messages'
      const targetUrl = baseUrl + apiPath
      console.log(`[proxy] ${req.method} ${req.url} → ${targetUrl}`)
      const headers = { 'Content-Type': 'application/json' }
      if (req.headers['x-api-key']) headers['x-api-key'] = req.headers['x-api-key']
      if (req.headers['authorization']) headers['authorization'] = req.headers['authorization']
      if (req.headers['anthropic-version']) headers['anthropic-version'] = req.headers['anthropic-version']
      try {
        const resp = await fetch(targetUrl, { method: 'POST', headers, body })
        const corsHeaders = {
          'Access-Control-Allow-Origin': '*',
          'Content-Type': resp.headers.get('content-type') || 'application/json'
        }
        res.writeHead(resp.status, corsHeaders)
        // Stream the response
        const reader = resp.body.getReader()
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read()
            if (done) { res.end(); break }
            res.write(value)
          }
        }
        pump().catch(() => res.end())
      } catch (err) {
        res.writeHead(502, { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: err.message }))
      }
    })
    return
  }

  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0])
  filePath = path.normalize(filePath)
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden') }

  try {
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' })
    fs.createReadStream(filePath).pipe(res)
  } catch {
    res.writeHead(404); res.end('Not found')
  }
})

server.listen(PORT, () => console.log(`Fluid Agent on http://localhost:${PORT}`))
