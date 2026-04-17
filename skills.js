/* skills.js - External tools ported from Visual Talk */
const ExternalSkills = (() => {

  const PROXY_BASE = 'https://proxy.link2web.site/api/proxy'
  const FETCH_PROXY = 'https://fetch.link2web.site'

  // --- Helpers ---
  async function fetchWithFallback(url) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      throw new Error(`${res.status}`)
    } catch (e) {
      const proxyUrl = `${FETCH_PROXY}?url=${encodeURIComponent(url)}&mode=json`
      const proxyRes = await fetch(proxyUrl)
      if (!proxyRes.ok) throw new Error(`Proxy also failed: ${proxyRes.status}`)
      return proxyRes
    }
  }

  async function proxyGet(url) {
    const res = await fetch(`${PROXY_BASE}?url=${encodeURIComponent(url)}`)
    if (!res.ok) throw new Error(`Proxy ${res.status}`)
    return res.json()
  }

  // --- Calculate ---
  function safeEval(expr) {
    try {
      let evalExpr = expr.replace(/\^/g, '**').replace(/(\d)%/g, '($1/100)')
      const result = new Function(`"use strict"; return (${evalExpr})`)()
      if (typeof result !== 'number' || !isFinite(result)) return { error: 'Result is not a finite number' }
      return { expression: expr, result: Number(result.toPrecision(12)) }
    } catch (e) {
      return { error: `Calculation error: ${e.message}` }
    }
  }

  // --- Weather ---
  const WMO_CODES = {
    0:'晴',1:'大部晴',2:'多云',3:'阴',45:'雾',48:'霜雾',
    51:'小毛毛雨',53:'毛毛雨',55:'大毛毛雨',61:'小雨',63:'中雨',65:'大雨',
    71:'小雪',73:'中雪',75:'大雪',77:'雪粒',80:'小阵雨',81:'阵雨',82:'大阵雨',
    85:'小阵雪',86:'大阵雪',95:'雷暴',96:'雷暴+小冰雹',99:'雷暴+大冰雹',
  }

  async function getWeather(args) {
    let lat = args.latitude, lon = args.longitude
    const city = args.city
    if (!lat || !lon) {
      if (!city) return { error: 'Provide city name or latitude/longitude' }
      const geoRes = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=zh`)
      const geoData = await geoRes.json()
      if (!geoData.results?.length) return { error: `City not found: ${city}` }
      lat = geoData.results[0].latitude; lon = geoData.results[0].longitude
    }
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,weathercode,windspeed_10m,relative_humidity_2m&daily=temperature_2m_max,temperature_2m_min,weathercode,precipitation_probability_max&timezone=auto&forecast_days=3`
    const res = await fetch(url); const data = await res.json()
    const c = data.current, d = data.daily
    return {
      location: city || `${lat},${lon}`,
      current: { temperature: c.temperature_2m, feelsLike: c.apparent_temperature, weather: WMO_CODES[c.weathercode] || `code ${c.weathercode}`, windSpeed: c.windspeed_10m, humidity: c.relative_humidity_2m },
      forecast: d.time.map((date, i) => ({ date, high: d.temperature_2m_max[i], low: d.temperature_2m_min[i], weather: WMO_CODES[d.weathercode[i]] || `code ${d.weathercode[i]}`, rainChance: d.precipitation_probability_max[i] })),
    }
  }

  // --- Wikipedia ---
  async function getWikipedia(args) {
    const query = args.query?.trim()
    if (!query) return { error: 'Query required' }
    const lang = args.language || 'en'
    try {
      const summaryUrl = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`
      let res
      try { res = await fetch(summaryUrl) } catch (e) {
        const proxyRes = await fetch(`${FETCH_PROXY}?url=${encodeURIComponent(summaryUrl)}&mode=raw`)
        if (!proxyRes.ok) throw new Error(`Wikipedia unreachable`)
        const data = JSON.parse(await proxyRes.text())
        return { title: data.title, description: data.description, extract: data.extract?.slice(0, 1000), thumbnail: data.thumbnail?.source, url: data.content_urls?.desktop?.page }
      }
      if (res.status === 404) {
        const searchRes = await fetch(`https://${lang}.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&format=json`)
        const searchData = await searchRes.json()
        const first = searchData?.[1]?.[0]
        if (!first) return { error: `No Wikipedia article found for "${query}"` }
        res = await fetch(`https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(first)}`)
      }
      if (!res.ok) throw new Error(`Wikipedia ${res.status}`)
      const data = await res.json()
      return { title: data.title, description: data.description, extract: data.extract?.slice(0, 1000), thumbnail: data.thumbnail?.source, url: data.content_urls?.desktop?.page }
    } catch (e) { return { error: `Wikipedia failed: ${e.message}` } }
  }

  // --- Stock ---
  async function getStock(args) {
    const symbol = (args.symbol || '').toUpperCase().trim()
    if (!symbol) return { error: 'Stock symbol required (e.g. AAPL, 0700.HK, 600519.SS)' }
    try {
      const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d&includePrePost=false`
      let data
      try { const res = await fetch(url); if (!res.ok) throw new Error(`Yahoo ${res.status}`); data = await res.json() }
      catch (e) {
        const proxyRes = await fetch(`${FETCH_PROXY}?url=${encodeURIComponent(url)}&mode=raw`)
        if (!proxyRes.ok) throw new Error(`Proxy ${proxyRes.status}`)
        data = JSON.parse(await proxyRes.text())
      }
      const result = data?.chart?.result?.[0]
      if (!result) return { error: `No data found for ${symbol}` }
      const meta = result.meta, quotes = result.indicators?.quote?.[0] || {}, timestamps = result.timestamp || []
      const current = { symbol: meta.symbol, name: meta.shortName || meta.longName || symbol, currency: meta.currency, price: meta.regularMarketPrice, previousClose: meta.chartPreviousClose || meta.previousClose, change: null, changePercent: null }
      if (current.price && current.previousClose) { current.change = +(current.price - current.previousClose).toFixed(2); current.changePercent = +((current.change / current.previousClose) * 100).toFixed(2) }
      current.history = timestamps.slice(-5).map((ts, i) => ({ date: new Date(ts * 1000).toISOString().split('T')[0], close: quotes.close?.[i]?.toFixed(2), volume: quotes.volume?.[i] }))
      return current
    } catch (e) { return { error: `Stock query failed: ${e.message}` } }
  }

  // --- TMDB ---
  const TMDB_BASE = 'https://api.themoviedb.org/3'
  const TMDB_IMG = 'https://image.tmdb.org/t/p'
  const GENRES = { 28:'动作',12:'冒险',16:'动画',35:'喜剧',80:'犯罪',99:'纪录',18:'剧情',10751:'家庭',14:'奇幻',36:'历史',27:'恐怖',10402:'音乐',9648:'悬疑',10749:'爱情',878:'科幻',53:'惊悚',10752:'战争',37:'西部' }
  function posterUrl(path, size = 'w500') { return path ? `${TMDB_IMG}/${size}${path}` : null }

  async function tmdbFetch(path, apiKey, params = {}) {
    const url = new URL(`${TMDB_BASE}${path}`)
    url.searchParams.set('api_key', apiKey); url.searchParams.set('language', 'zh-CN')
    Object.entries(params).forEach(([k, v]) => { if (v != null) url.searchParams.set(k, v) })
    const targetUrl = url.toString()
    try { const res = await fetch(targetUrl); if (!res.ok) throw new Error(`TMDB ${res.status}`); return res.json() }
    catch (err) {
      const res = await fetch('https://proxy.link2web.site', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: targetUrl, method: 'GET', mode: 'raw' }) })
      const result = await res.json()
      if (!result.success) throw new Error(result.error || `Proxy failed`)
      return typeof result.body === 'string' ? JSON.parse(result.body) : result.body
    }
  }

  // --- Podcast ---
  function parseRSS(xml, limit = 5) {
    const episodes = []
    const podImage = xml.match(/<itunes:image\s+href="([^"]+)"/)?.[1] || null
    const itemRegex = /<item>([\s\S]*?)<\/item>/g
    let match
    while ((match = itemRegex.exec(xml)) && episodes.length < limit) {
      const item = match[1]
      const title = item.match(/<title>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/)?.[1] || ''
      const encUrl = item.match(/<enclosure[^>]+url="([^"]+)"/)?.[1] || ''
      const duration = item.match(/<itunes:duration>(.*?)<\/itunes:duration>/)?.[1] || ''
      const pubDate = item.match(/<pubDate>(.*?)<\/pubDate>/)?.[1] || ''
      let desc = item.match(/<description>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || ''
      desc = desc.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200)
      if (title) episodes.push({ title: title.trim(), audioUrl: encUrl, duration, pubDate: pubDate ? new Date(pubDate).toISOString().slice(0, 10) : '', description: desc, image: podImage })
    }
    return { episodes, podImage }
  }

  async function searchPodcast(args) {
    const query = args.query?.trim()
    if (!query) return { error: 'Search query required' }
    const limit = Math.min(args.limit || 3, 10), episodeLimit = args.episodes || 5
    try {
      const searchUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(query)}&media=podcast&limit=${limit}`
      let searchText
      try { const r = await fetch(searchUrl); searchText = await r.text() }
      catch { const r = await fetch(`${PROXY_BASE}?url=${encodeURIComponent(searchUrl)}`); searchText = await r.text() }
      const searchData = JSON.parse(searchText)
      if (!searchData.results?.length) return { results: [], message: 'No podcasts found' }
      const results = []
      for (const p of searchData.results) {
        const podcast = { name: p.collectionName || p.trackName, artist: p.artistName, artwork: p.artworkUrl600 || p.artworkUrl100?.replace('100x100', '600x600'), genre: p.primaryGenreName, episodes: [] }
        if (p.feedUrl && args.episodes !== 0) {
          try {
            let rssText; try { const r = await fetch(p.feedUrl); rssText = await r.text() } catch { const r = await fetch(`${PROXY_BASE}?url=${encodeURIComponent(p.feedUrl)}`); rssText = await r.text() }
            podcast.episodes = parseRSS(rssText, episodeLimit).episodes
          } catch (e) { podcast.rssError = e.message }
        }
        results.push(podcast)
      }
      return { results }
    } catch (e) { return { error: `Podcast search failed: ${e.message}` } }
  }

  // --- NetEase Music ---
  async function searchNeteaseMusic(args) {
    const query = args.query?.trim()
    if (!query) return { error: 'Search query required' }
    const limit = Math.min(args.limit || 5, 20)
    try {
      const searchUrl = `https://music.163.com/api/cloudsearch/pc?s=${encodeURIComponent(query)}&type=1&limit=${limit}&offset=0`
      const data = await proxyGet(searchUrl)
      const songs = data.result?.songs
      if (!songs?.length) return { results: [], message: 'No results found' }
      return {
        results: songs.map(s => {
          const dur = Math.round((s.dt || 0) / 1000), min = Math.floor(dur / 60), sec = dur % 60
          return { track: s.name, artist: (s.ar || []).map(a => a.name).join(' / '), album: s.al?.name || '', artwork: s.al?.picUrl || null, playUrl: `https://music.163.com/song/media/outer/url?id=${s.id}.mp3`, duration: `${min}:${sec.toString().padStart(2, '0')}`, ncmId: s.id }
        })
      }
    } catch (e) { return { error: `NetEase Music search failed: ${e.message}` } }
  }

  // --- Image Generation ---
  // --- Public API: returns { defs, handlers } ---
  function register(getConfig) {
    const defs = {}
    const handlers = {}

    // Calculate
    defs.calculate = { desc: 'Evaluate a math expression. Supports +, -, *, /, ^, %, Math functions.', schema: { type: 'object', properties: { expression: { type: 'string', description: 'Math expression (e.g. "125 * 0.85", "Math.sqrt(144)")' } }, required: ['expression'] } }
    handlers.calculate = (p) => safeEval(p.expression)

    // Weather
    defs.get_weather = { desc: 'Get current weather and 3-day forecast. Use city name or coordinates.', schema: { type: 'object', properties: { city: { type: 'string', description: 'City name (e.g. "北京", "Tokyo")' }, latitude: { type: 'number' }, longitude: { type: 'number' } } } }
    handlers.get_weather = (p) => getWeather(p)

    // Wikipedia
    defs.get_wikipedia = { desc: 'Get Wikipedia article summary. More precise than web_search for factual/encyclopedic queries.', schema: { type: 'object', properties: { query: { type: 'string', description: 'Article title or search term' }, language: { type: 'string', enum: ['en', 'zh', 'ja', 'ko', 'fr', 'de', 'es'] } }, required: ['query'] } }
    handlers.get_wikipedia = (p) => getWikipedia(p)

    // Stock
    defs.get_stock = { desc: 'Get stock price and 5-day history. US (AAPL), HK (0700.HK), China A-shares (600519.SS).', schema: { type: 'object', properties: { symbol: { type: 'string', description: 'Stock ticker symbol' } }, required: ['symbol'] } }
    handlers.get_stock = (p) => getStock(p)

    // TMDB - search_movie
    defs.search_movie = { desc: 'Search movies via TMDB. Returns poster URLs, ratings, genres, overviews.', schema: { type: 'object', properties: { query: { type: 'string' }, year: { type: 'number' } }, required: ['query'] } }
    handlers.search_movie = async (p) => {
      const cfg = getConfig(); if (!cfg.tmdbKey) return { error: 'TMDB API key not configured in Settings' }
      const data = await tmdbFetch('/search/movie', cfg.tmdbKey, { query: p.query, year: p.year })
      return { results: (data.results || []).slice(0, 6).map(m => ({ id: m.id, title: m.title, originalTitle: m.original_title, year: m.release_date?.slice(0, 4), overview: m.overview?.slice(0, 150), rating: m.vote_average, poster: posterUrl(m.poster_path), genres: (m.genre_ids || []).map(id => GENRES[id] || id) })) }
    }

    // TMDB - get_movie_detail
    defs.get_movie_detail = { desc: 'Get detailed movie info: cast, crew, runtime, budget. Use after search_movie.', schema: { type: 'object', properties: { movie_id: { type: 'number' } }, required: ['movie_id'] } }
    handlers.get_movie_detail = async (p) => {
      const cfg = getConfig(); if (!cfg.tmdbKey) return { error: 'TMDB API key not configured' }
      const m = await tmdbFetch(`/movie/${p.movie_id}`, cfg.tmdbKey, { append_to_response: 'credits' })
      return { title: m.title, originalTitle: m.original_title, year: m.release_date?.slice(0, 4), runtime: m.runtime, genres: m.genres?.map(g => g.name), overview: m.overview, rating: m.vote_average, poster: posterUrl(m.poster_path), director: m.credits?.crew?.find(c => c.job === 'Director')?.name, cast: m.credits?.cast?.slice(0, 8).map(c => ({ name: c.name, character: c.character, photo: posterUrl(c.profile_path, 'w185') })) }
    }

    // TMDB - search_tv
    defs.search_tv = { desc: 'Search TV shows/series via TMDB. Returns poster URLs, ratings, overviews.', schema: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] } }
    handlers.search_tv = async (p) => {
      const cfg = getConfig(); if (!cfg.tmdbKey) return { error: 'TMDB API key not configured' }
      const data = await tmdbFetch('/search/tv', cfg.tmdbKey, { query: p.query })
      return { results: (data.results || []).slice(0, 6).map(s => ({ id: s.id, title: s.name, originalTitle: s.original_name, firstAir: s.first_air_date?.slice(0, 4), overview: s.overview?.slice(0, 150), rating: s.vote_average, poster: posterUrl(s.poster_path) })) }
    }

    // Podcast
    defs.search_podcast = { desc: 'Search podcasts and get episodes with playable audio URLs. Works for 小宇宙, Apple Podcasts, etc.', schema: { type: 'object', properties: { query: { type: 'string', description: 'Podcast name, topic, or host' }, limit: { type: 'number' }, episodes: { type: 'number' } }, required: ['query'] } }
    handlers.search_podcast = (p) => searchPodcast(p)

    // NetEase Music
    defs.search_netease_music = { desc: 'Search songs on NetEase Cloud Music (网易云音乐). Returns playable MP3 URLs.', schema: { type: 'object', properties: { query: { type: 'string', description: 'Song, artist, or album name' }, limit: { type: 'number' } }, required: ['query'] } }
    handlers.search_netease_music = (p) => searchNeteaseMusic(p)

    return { defs, handlers }
  }

  return { register }
})()
