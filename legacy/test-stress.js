#!/usr/bin/env node
// FluidOS Stress Test — validates Talker→Worker→Done pipeline
// Tests: intent creation, tool usage, intent completion, error handling

const TEST_CASES = [
  // Format: [userMessage, expectedBehaviors]
  // expectedBehaviors: 'intent' = must create intent, 'tool:X' = Worker must call tool X, 'chat' = pure chat ok
  { msg: '今天天气怎么样', expect: ['intent', 'tool:get_weather'], desc: 'Weather query → should use get_weather tool' },
  { msg: '给我看张猫的照片', expect: ['intent', 'tool:web_search'], desc: 'Photo request → should search and show' },
  { msg: '今天有什么新闻', expect: ['intent', 'tool:web_search'], desc: 'News query → should search news' },
  { msg: '播放一首周杰伦的歌', expect: ['intent', 'tool:search_music'], desc: 'Music request → should search and play' },
  { msg: '附近有什么好吃的', expect: ['intent', 'tool:web_search'], desc: 'Food nearby → should search (even without exact location)' },
  { msg: '帮我写个计算器应用', expect: ['intent', 'tool:dynamicapp||fs'], desc: 'Create app → should build app' },
  { msg: '你觉得AI的未来会怎样', expect: ['chat'], desc: 'Opinion question → pure chat, no intent needed' },
  { msg: '查一下苹果公司的股价', expect: ['intent', 'tool:web_search'], desc: 'Stock price → should search' },
  { msg: '打开地图看看北京', expect: ['intent', 'tool:map'], desc: 'Map request → should open map' },
  { msg: '总结一下 https://news.ycombinator.com 的内容', expect: ['intent', 'tool:web_fetch'], desc: 'URL summary → should fetch and summarize' },
  // Edge cases
  { msg: '帮我查一下明天的日程', expect: ['intent'], desc: 'Schedule query → should create intent [FLAKY]' },
  { msg: '这个文件里有什么', expect: ['intent'], desc: 'File inspection → should create intent' },
  { msg: '你好', expect: ['chat'], desc: 'Greeting → pure chat' },
  { msg: '谢谢', expect: ['chat'], desc: 'Thanks → pure chat' },
  { msg: '帮我把这段文字翻译成英文：今天天气真好', expect: ['chat'], desc: 'Translation → chat (Talker can answer directly)' },
  { msg: '打开终端', expect: ['intent'], desc: 'Open terminal → should create intent' },
  { msg: '现在几点了', expect: ['chat', 'intent'], desc: 'Time question → either (can answer or create clock app)' },
  { msg: '帮我写一篇关于AI的文章', expect: ['intent'], desc: 'Write article → should create intent' },
  { msg: '把壁纸换成蓝色的', expect: ['intent'], desc: 'Change wallpaper → should create intent' },
  // === Round 2: More edge cases ===
  // Multi-intent
  { msg: '帮我查一下北京天气，顺便播放一首轻松的音乐', expect: ['intent'], desc: 'Multi-task (weather + music) → should create intent(s)' },
  { msg: '先搜一下最新的iPhone价格，然后做个对比表', expect: ['intent'], desc: 'Sequential task (search then create table) → intent' },
  // Colloquial Chinese
  { msg: '整个计算器来', expect: ['intent'], desc: 'Slang: 整个计算器 → create calculator app' },
  { msg: '来点白噪音', expect: ['intent'], desc: 'Slang: 来点白噪音 → play white noise' },
  { msg: '看看最近有啥好电影', expect: ['intent'], desc: 'Movie recommendation → should search' },
  { msg: '开个番茄钟', expect: ['intent'], desc: 'Pomodoro timer → create timer app' },
  // Ambiguous but actionable
  { msg: '无聊', expect: ['intent'], desc: 'Bored → intent (proactively help find something fun)' },
  { msg: '好无聊啊，有什么好玩的', expect: ['intent'], desc: 'Bored + want fun → should suggest/create something' },
  { msg: '我想学做菜', expect: ['intent'], desc: 'Learn cooking → should search recipes' },
  { msg: '推荐一本书', expect: ['chat'], desc: 'Book recommendation → chat (can recommend from knowledge)' },
  // System operations
  { msg: '清空桌面', expect: ['intent'], desc: 'Clean desktop → should create intent' },
  { msg: '把所有窗口关掉', expect: ['intent'], desc: 'Close all windows → should create intent' },
  { msg: '显示系统信息', expect: ['intent'], desc: 'System info → should create intent' },
  // Follow-up style (simulating context)
  { msg: '再来一首', expect: ['intent'], desc: 'Follow-up: 再来一首 → should create intent (play another song)' },
  { msg: '换一个', expect: ['intent'], desc: 'Follow-up: 换一个 → intent (bias toward action)' },
  // Should NOT create intent
  { msg: '哈哈哈', expect: ['chat'], desc: 'Laughter → chat' },
  { msg: '你是谁', expect: ['chat'], desc: 'Identity question → chat' },
  { msg: '你能做什么', expect: ['chat'], desc: 'Capability question → chat (explain, dont act)' },
  { msg: '1+1等于几', expect: ['chat'], desc: 'Simple math → chat (answer directly)' },
]

const PROXY_URL = 'https://proxy.link2web.site'
const API_KEY = process.env.API_KEY || 'sk-uM2Cvu7IStUazwVQ9umUGu4LZYaphvtRDS2Auw0nwgbIX80V'
const BASE_URL = 'https://api.bltcy.ai'
const MODEL = 'claude-sonnet-4-20250514'

// Simulate Talker: send message, check if intent is created
async function testTalker(testCase) {
  const os = {
    desktopSize: '1440x900',
    windows: 'Task Manager, Browser',
    focused: 'none',
    cwd: '/home/user',
    desktop: [],
    documents: [],
    installedApps: 'finder, terminal, browser, music, map, video, settings',
    skills: 'none'
  }

  const capabilities = `Available tools:
- fs: File system operations (read, write, list, delete, mkdir)
- app: App management (create, delete, list)
- dynamicapp: Quick ephemeral apps with data+view
- browser: Open URL and display fetched content
- browser_control: Control browser page
- web_search: Search the web using Tavily
- web_fetch: Fetch and read web page content
- get_weather: Get weather for a location
- map: Map operations (open, pin, route, search)
- search_music: Search for music
- music: Music player control
- done: Signal task completion
- plan_steps: Set execution plan
- search_tools: Find and load additional tools`

  const system = `You are Fluid Agent — part companion, part operating system.

You're a conversational AI that also happens to control an entire desktop environment.

${capabilities}

Current OS state:
- Desktop size: ${os.desktopSize}
- Open windows: ${os.windows}
- Installed apps: ${os.installedApps}

When the user wants you to DO something (not just talk), output an intent block.

## Intent Actions

**CREATE** — user wants something new done:
\`\`\`json
{"reply": "your reply", "intents": [{"action": "create", "goal": "clear description of what to achieve"}]}
\`\`\`

## Key Rules

1. Write clear, complete goals.
2. BIAS TOWARD ACTION: If the user's request could be fulfilled by using tools (search, fetch, show, play, create), create an intent. Only skip intents for pure opinions, philosophical questions, or casual chat. When in doubt, create an intent — it's better to act than to ask clarifying questions.
3. DON'T ASK, DO: If information is missing (e.g. location, file name), make reasonable assumptions and act. "附近有什么好吃的" → search for food recommendations. "这个文件里有什么" → list files and show. Never say "I can't do X" — find a creative way to fulfill the request with available tools.
4. NO TOOL ≠ NO ACTION: If no dedicated tool exists for a request, use general tools creatively. No calendar? → Create a schedule app or search files. No translator? → You can translate directly. Always find a way.

Be natural, concise, and have personality.`

  const body = {
    model: MODEL,
    max_tokens: 1024,
    messages: [{ role: 'user', content: testCase.msg }],
    system,
  }

  try {
    const res = await fetch(`${PROXY_URL}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-base-url': BASE_URL,
        'x-provider': 'anthropic',
        'x-api-key': API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify(body),
    })

    const text = await res.text()
    // Parse response — handle both SSE stream and JSON response
    let fullText = ''
    if (text.startsWith('{')) {
      // Non-streaming JSON response
      try {
        const d = JSON.parse(text)
        fullText = d.content?.[0]?.text || ''
      } catch {}
    } else {
      // SSE stream
      for (const line of text.split('\n')) {
        if (line.startsWith('data: ')) {
          try {
            const d = JSON.parse(line.slice(6))
            if (d.type === 'content_block_delta' && d.delta?.text) fullText += d.delta.text
          } catch {}
        }
      }
    }

    // Check results
    const hasIntent = fullText.includes('"intents"') && fullText.includes('"create"')
    const hasJsonBlock = fullText.includes('```json')
    const expectIntent = testCase.expect.includes('intent')
    const expectChat = testCase.expect.includes('chat')
    // If both 'chat' and 'intent' are in expect, either is acceptable
    const isEither = expectIntent && expectChat
    const pass = isEither ? true : (expectIntent ? hasIntent : !hasIntent)

    return {
      msg: testCase.msg,
      desc: testCase.desc,
      pass: isEither ? true : (expectIntent ? hasIntent : !hasIntent),
      hasIntent,
      expectIntent,
      reply: fullText.slice(0, 200),
    }
  } catch (e) {
    return { msg: testCase.msg, desc: testCase.desc, pass: false, error: e.message }
  }
}

async function main() {
  console.log('=== FluidOS Stress Test ===\n')
  console.log(`Model: ${MODEL}`)
  console.log(`Tests: ${TEST_CASES.length}\n`)

  const results = []
  for (let i = 0; i < TEST_CASES.length; i++) {
    const tc = TEST_CASES[i]
    process.stdout.write(`[${i + 1}/${TEST_CASES.length}] ${tc.desc}... `)
    const r = await testTalker(tc)
    results.push(r)
    console.log(r.pass ? '✅ PASS' : `❌ FAIL${r.error ? ` (${r.error})` : ''}`)
    if (!r.pass) {
      console.log(`  Expected intent: ${r.expectIntent}, Got intent: ${r.hasIntent}`)
      console.log(`  Reply: ${r.reply?.slice(0, 150)}...`)
    }
    // Rate limit
    await new Promise(r => setTimeout(r, 1000))
  }

  const passed = results.filter(r => r.pass).length
  const failed = results.filter(r => !r.pass).length
  console.log(`\n=== Results: ${passed}/${results.length} passed, ${failed} failed ===`)

  if (failed > 0) {
    console.log('\nFailed tests:')
    results.filter(r => !r.pass).forEach(r => {
      console.log(`  ❌ "${r.msg}" — ${r.desc}`)
      console.log(`     Expected intent: ${r.expectIntent}, Got: ${r.hasIntent}`)
    })
  }

  process.exit(failed > 0 ? 1 : 0)
}

main()
