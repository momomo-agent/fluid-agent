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
  let filePath = path.join(ROOT, req.url === '/' ? 'index.html' : req.url.split('?')[0])
  filePath = path.normalize(filePath)
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden') }

  try {
    const stat = fs.statSync(filePath)
    if (stat.isDirectory()) filePath = path.join(filePath, 'index.html')
    const ext = path.extname(filePath)
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' })
    fs.createReadStream(filePath).pipe(res)
  } catch {
    res.writeHead(404); res.end('Not found')
  }
})

server.listen(PORT, () => console.log(`Fluid Agent on http://localhost:${PORT}`))
