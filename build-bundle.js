#!/usr/bin/env node
// Build a single agentic.bundle.js from all lib/ packages
// Order matters: dependencies first, agentic.js last (it discovers others via globals)
const fs = require('fs')
const path = require('path')

const LIB = path.join(__dirname, 'lib')
const OUT = path.join(LIB, 'agentic.bundle.js')

// Load order: deps first, agentic.js last
const files = [
  'agentic-conductor.js',  // no deps
  'agentic-core.js',       // no deps
  'agentic-store.js',      // no deps
  'agentic-shell.js',      // uses core
  'agentic-voice.js',      // uses core
  'agentic.js',            // discovers all above via window globals
]

let bundle = `/* agentic.bundle.js — auto-generated ${new Date().toISOString().slice(0,10)} */\n`

for (const f of files) {
  const fp = path.join(LIB, f)
  if (!fs.existsSync(fp)) { console.warn(`⚠ skipping ${f} (not found)`); continue }
  const src = fs.readFileSync(fp, 'utf8')
  bundle += `\n// ═══ ${f} ═══\n${src}\n`
  // Alias non-standard global names to what agentic.js expects
  if (f === 'agentic-shell.js') {
    bundle += `if (typeof AgenticShellBrowser !== 'undefined' && typeof AgenticShell === 'undefined') { var AgenticShell = AgenticShellBrowser; }\n`
  }
  console.log(`  + ${f} (${(src.length/1024).toFixed(1)}K)`)
}

fs.writeFileSync(OUT, bundle)
console.log(`\n✅ ${OUT} (${(bundle.length/1024).toFixed(1)}K)`)
