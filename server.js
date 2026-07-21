// 小源音乐 - 基于【统一音乐源 v1.0.0】的 GD 音乐台代理服务
// GD API 文档：https://music-api.gdstudio.xyz/api.php
const http = require('http');
const https = require('https');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3721;
const ROOT = __dirname;
const DATA_DIR = path.join(ROOT, 'data');
const SOURCE_DIR = path.join(ROOT, 'sources');

// HTTP 连接池复用——避免每次请求重新建立 TCP 连接
const keepAliveAgent = new https.Agent({ keepAlive: true, maxSockets: 20, maxFreeSockets: 10 });

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type,Range,User-Agent,Referer',
};

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const DEFAULT_HEADERS = {
  'User-Agent': UA,
  Accept: '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
};
const NETEASE_HEADERS = {
  ...DEFAULT_HEADERS,
  Referer: 'https://music.163.com/',
};

// sources 目录下的音源文件
const SOURCE_FILES = (() => {
  try {
    return fs.readdirSync(SOURCE_DIR).filter((f) => f.endsWith('.js'));
  } catch {
    return [];
  }
})();

const SOURCE_INFO = {
  key: 'unified',
  name: '统一音乐源',
  color: '#e8873a',
  files: SOURCE_FILES,
  hot: [
    { name: '热歌榜', id: '3778678' },
    { name: '新歌榜', id: '3779629' },
    { name: '飙升榜', id: '19723756' },
    { name: '戏腔', id: '6642627811' },
    { name: '流行', id: '8596628206' },
    { name: '抖音热歌', id: '2809513713' },
    { name: '民谣', id: '2770902965' },
    { name: 'DJ', id: '8875052202' },
  ],
};

fs.mkdirSync(DATA_DIR, { recursive: true });

// ========== 工具函数 ==========

function writeJson(res, code, data) {
  res.writeHead(code, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(data));
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('404');
      return;
    }
    res.writeHead(200, {
      ...CORS,
      'Content-Type': contentType,
      'Cache-Control': contentType.includes('html') ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  });
}

function requestText(target, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try { parsed = new URL(target); } catch (e) { reject(e); return; }
    const client = parsed.protocol === 'https:' ? https : http;
    const req = client.request(parsed, {
      method: options.method || 'GET',
      headers: { ...DEFAULT_HEADERS, ...(options.headers || {}) },
      timeout: options.timeout || 8000,
      agent: parsed.protocol === 'https:' ? keepAliveAgent : undefined,
    }, (upstream) => {
      if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
        upstream.resume();
        requestText(new URL(upstream.headers.location, parsed).toString(), options).then(resolve).catch(reject);
        return;
      }
      let body = '';
      upstream.setEncoding('utf8');
      upstream.on('data', (c) => { body += c; });
      upstream.on('end', () => resolve({ statusCode: upstream.statusCode, headers: upstream.headers, body }));
    });
    req.on('timeout', () => req.destroy(new Error('请求超时')));
    req.on('error', reject);
    if (options.body) req.write(options.body);
    req.end();
  });
}

async function getJson(target, options = {}) {
  const res = await requestText(target, options);
  try { return JSON.parse(res.body); } catch { return { raw: res.body, code: res.statusCode }; }
}

function uniqBy(items, keyFn) {
  const seen = new Set();
  const out = [];
  for (const item of items) {
    const key = keyFn(item);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function fixHttpUrl(value) {
  if (!value || typeof value !== 'string') return '';
  if (value.startsWith('//')) return 'https:' + value;
  if (value.startsWith('http:')) return value.replace(/^http:/, 'https:');
  return value;
}

// ========== GD API 调用 ==========

const GD_BASE = 'https://music-api.gdstudio.xyz/api.php';

async function gdUrl(songId, quality = '740') {
  const url = `${GD_BASE}?types=url&source=netease&id=${encodeURIComponent(songId)}&br=${quality}`;
  const data = await getJson(url, { timeout: 7000 });
  return extractUrl(data);
}

// 对应音源文件的 extractUrlFromResponse
function extractUrl(data) {
  if (!data) return null;
  if (typeof data === 'string') return data.startsWith('http') ? data : null;
  if (Array.isArray(data)) {
    for (const item of data) {
      const u = extractUrl(item);
      if (u) return u;
    }
    return null;
  }
  if (typeof data === 'object') {
    if (typeof data.url === 'string' && data.url.startsWith('http')) return data.url;
    if (data.data) {
      const u = extractUrl(data.data);
      if (u) return u;
    }
    for (const value of Object.values(data)) {
      if (typeof value === 'string' && value.startsWith('http')) return value;
    }
  }
  return null;
}

const lyricCache = new Map();

async function gdLyric(songId) {
  const cached = lyricCache.get(songId);
  if (cached && Date.now() - cached.time < 600000) return cached.text;
  const url = `${GD_BASE}?types=lyric&source=netease&id=${encodeURIComponent(songId)}`;
  const data = await getJson(url, { timeout: 5000 });
  const text = (data && data.lyric) || '';
  if (text) {
    if (lyricCache.size > 300) { const first = lyricCache.keys().next().value; lyricCache.delete(first); }
    lyricCache.set(songId, { time: Date.now(), text });
  }
  return text;
}

// 启动时预热搜索+分类缓存
setTimeout(async () => {
  try { await searchSongs('周杰伦'); console.log('搜索缓存已预热'); } catch {}
  try {
    const cats = await Promise.all(SOURCE_INFO.hot.map(async (item) => {
      let songs = await playlistSongs(item.id).catch(() => []);
      return { name: item.name, id: item.id, songs: songs.slice(0, 200) };
    }));
    searchCache.set('__cats__', { time: Date.now(), data: cats });
    console.log('分类缓存已预热');
  } catch {}
}, 2000);

// ========== 搜索缓存 ==========

const searchCache = new Map();
const CACHE_TTL = 5 * 60 * 1000; // 5 分钟

function scoreSong(song, keyword) {
  const kw = keyword.toLowerCase();
  const name = (song.name || '').toLowerCase();
  const artist = (song.artist || '').toLowerCase();
  let score = 0;
  if (name === kw) score += 80;
  if (name.startsWith(kw)) score += 50;
  else if (name.includes(kw)) score += 35;
  if (artist.includes(kw)) score += 65;
  score += Math.min(song.pop || 0, 100);
  return score;
}

// 网易云 cloudsearch
async function searchNeteaseCS(keyword, offset = 0) {
  const url =
    'https://music.163.com/api/cloudsearch/pc?s=' +
    encodeURIComponent(keyword) +
    '&type=1&limit=100&offset=' + offset;
  const data = await getJson(url, { headers: NETEASE_HEADERS, timeout: 4000 });
  const songs = data && data.result && Array.isArray(data.result.songs) ? data.result.songs : [];
  return songs.map((item) => {
    const al = item.al || {};
    const ar = item.ar || [];
    return {
      id: String(item.id),
      source: 'unified',
      provider: 'netease',
      name: String(item.name || ''),
      artist: ar.map((a) => a.name).filter(Boolean).join(' / '),
      album: al.name || '',
      pic: fixHttpUrl(al.picUrl || ''),
      pop: Number(item.pop || item.playCount || 0),
    };
  }).filter((s) => s.id && s.name);
}

async function searchSongs(keyword) {
  const kw = keyword.trim();
  const cached = searchCache.get(kw);
  if (cached && Date.now() - cached.time < CACHE_TTL) return cached.songs;

  const kwLower = kw.toLowerCase();
  const isMatch = (s) => (s.name || '').toLowerCase().includes(kwLower) || (s.artist || '').toLowerCase().includes(kwLower);

  // 并行拉取 3 页，速度提升 3 倍
  const baseUrl = 'https://music.163.com/api/cloudsearch/pc?type=1&s=' + encodeURIComponent(kw) + '&limit=100';
  const pages = await Promise.all([0, 100, 200].map((offset) =>
    getJson(baseUrl + '&offset=' + offset, { headers: NETEASE_HEADERS, timeout: 3000 }).catch(() => null)
  ));

  const results = [];
  const seenId = new Set();
  for (const data of pages) {
    const songs = data && data.result && Array.isArray(data.result.songs) ? data.result.songs : [];
    if (!songs.length) continue;
    for (const item of songs) {
      const al = item.al || {};
      const ar = item.ar || [];
      const song = {
        id: String(item.id),
        source: 'unified',
        provider: 'netease',
        name: String(item.name || ''),
        artist: ar.map((a) => a.name).filter(Boolean).join(' / '),
        album: al.name || '',
        pic: fixHttpUrl(al.picUrl || ''),
        pop: Number(item.pop || item.playCount || 0),
      };
      if (!song.id || !song.name) continue;
      if (!isMatch(song)) continue;
      if (seenId.has(song.id)) continue;
      seenId.add(song.id);
      results.push(song);
    }
  }

  if (searchCache.size > 200) { const first = searchCache.keys().next().value; searchCache.delete(first); }
  searchCache.set(kw, { time: Date.now(), songs: results });

  return results;
}

// ========== 歌单（网易云，GD 不支持） ==========

async function playlistSongs(pid) {
  const data = await getJson(
    `https://music.163.com/api/v6/playlist/detail?id=${encodeURIComponent(pid)}&n=1000`,
    { headers: NETEASE_HEADERS, timeout: 10000 }
  );
  const tracks = (data && data.playlist && Array.isArray(data.playlist.tracks)) ? data.playlist.tracks : [];
  return tracks.map((item) => {
    const al = item.al || {};
    const ar = item.ar || [];
    return {
      id: String(item.id),
      source: 'unified',
      provider: 'netease',
      name: String(item.name || ''),
      artist: ar.map((a) => a.name).filter(Boolean).join(' / '),
      album: al.name || '',
      pic: fixHttpUrl(al.picUrl || ''),
      pop: Number(item.pop || 0),
    };
  }).filter((s) => s.id && s.name);
}

// ========== 流媒体代理 ==========

function streamRemote(req, res, target, depth, onFail, isImage) {
  if (depth > 5) { onFail(); return; }
  let parsed;
  try { parsed = new URL(target); } catch { onFail(); return; }
  const client = parsed.protocol === 'https:' ? https : http;
  const isNeteaseCDN = target.includes('music.126.net') || target.includes('music.163.com');
  const headers = { ...(isNeteaseCDN ? NETEASE_HEADERS : DEFAULT_HEADERS) };
  if (req.headers.range) headers.Range = req.headers.range;

  const upstreamReq = client.get(parsed, { headers, timeout: 12000, agent: isNeteaseCDN ? keepAliveAgent : undefined }, (upstream) => {
    if (upstream.statusCode >= 300 && upstream.statusCode < 400 && upstream.headers.location) {
      upstream.resume();
      streamRemote(req, res, new URL(upstream.headers.location, parsed).toString(), depth + 1, onFail, isImage);
      return;
    }
    if (upstream.statusCode >= 400) { upstream.resume(); onFail(); return; }
    const headersOut = {
      ...CORS,
      'Content-Type': upstream.headers['content-type'] || (isImage ? 'image/jpeg' : 'audio/mpeg'),
      'Accept-Ranges': 'bytes',
      'Cache-Control': isImage ? 'public, max-age=86400' : 'no-store',
    };
    if (upstream.headers['content-length']) headersOut['Content-Length'] = upstream.headers['content-length'];
    if (upstream.headers['content-range']) headersOut['Content-Range'] = upstream.headers['content-range'];
    if (res.headersSent) return;
    res.writeHead(upstream.statusCode === 206 ? 206 : 200, headersOut);
    upstream.pipe(res);
  });
  upstreamReq.on('timeout', () => upstreamReq.destroy(new Error('音频请求超时')));
  upstreamReq.on('error', onFail);
}

// ========== 数据持久化 ==========

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (c) => {
      body += c;
      if (body.length > 1024 * 1024) req.destroy();
    });
    req.on('end', () => resolve(body));
  });
}

function userFile(uid) {
  const safe = String(uid || 'guest').replace(/[^a-zA-Z0-9_-]/g, '_');
  return path.join(DATA_DIR, `${safe}.json`);
}

// ========== API 路由 ==========

async function handleApi(req, res, pathname, query) {
  // 音源信息
  if (pathname === '/api/sources') {
    writeJson(res, 200, [SOURCE_INFO]);
    return true;
  }

  // 搜索
  if (pathname === '/api/search') {
    const keyword = String(query.get('keyword') || '').trim();
    if (!keyword) writeJson(res, 400, { error: '请输入搜索关键词' });
    else writeJson(res, 200, await searchSongs(keyword));
    return true;
  }

  // 歌单
  if (pathname === '/api/playlist') {
    const id = String(query.get('id') || '').trim();
    if (!id) writeJson(res, 400, { error: '缺少歌单 ID' });
    else {
      try { writeJson(res, 200, await playlistSongs(id)); }
      catch { writeJson(res, 200, []); }
    }
    return true;
  }

  // 推荐（合并四个中文歌单）
  if (pathname === '/api/recommend') {
    try {
      const [douyin, up, hot, newsongs] = await Promise.all([
        playlistSongs('2809513713').catch(() => []), // 抖音热歌
        playlistSongs('19723756').catch(() => []),  // 飙升榜
        playlistSongs('3778678').catch(() => []),    // 热歌榜
        playlistSongs('3779629').catch(() => []),    // 新歌榜
      ]);
      const isChinese = (s) => /[一-鿿]/.test(s.name || '');
      const lists = [douyin.filter(isChinese), up.filter(isChinese), hot.filter(isChinese), newsongs.filter(isChinese)];
      const merged = [];
      const seen = new Set();
      const maxLen = Math.max(...lists.map((l) => l.length));
      for (let i = 0; i < maxLen; i++) {
        for (const list of lists) {
          if (i < list.length && !seen.has(list[i].id)) {
            seen.add(list[i].id);
            merged.push(list[i]);
          }
        }
      }
      writeJson(res, 200, merged.slice(0, 600));
    } catch {
      writeJson(res, 200, []);
    }
    return true;
  }

  // 分类板块（30分钟缓存 + 启动预热）
  const CATS_CACHE_KEY = '__cats__';
  const CATS_CACHE_TTL = 30 * 60 * 1000;

  if (pathname === '/api/categories') {
    try {
      const cachedCat = searchCache.get(CATS_CACHE_KEY);
      if (cachedCat && Date.now() - cachedCat.time < CATS_CACHE_TTL) {
        writeJson(res, 200, cachedCat.data);
        return true;
      }
      const categories = await Promise.all(SOURCE_INFO.hot.map(async (item) => {
        let songs = await playlistSongs(item.id).catch(() => []);
        if (songs.length < 200) {
          const searched = await searchNeteaseCS(item.name).catch(() => []);
          const existIds = new Set(songs.map((s) => s.id));
          for (const s of searched) {
            if (!existIds.has(s.id)) { existIds.add(s.id); songs.push(s); }
            if (songs.length >= 200) break;
          }
        }
        return { name: item.name, id: item.id, songs: songs.slice(0, 200) };
      }));
      searchCache.set(CATS_CACHE_KEY, { time: Date.now(), data: categories });
      writeJson(res, 200, categories);
    } catch {
      writeJson(res, 200, []);
    }
    return true;
  }

  // 歌词（GD API）
  if (pathname === '/api/lyric') {
    const id = String(query.get('id') || '').trim();
    if (!id) writeJson(res, 400, { error: '缺少歌曲 ID' });
    else {
      try { writeJson(res, 200, { lyric: await gdLyric(id) }); }
      catch { writeJson(res, 200, { lyric: '' }); }
    }
    return true;
  }

  // URL 解析
  if (pathname === '/api/urls') {
    const id = String(query.get('id') || '').trim();
    const source = String(query.get('provider') || 'netease');
    if (!id) writeJson(res, 400, { error: '缺少歌曲 ID' });
    else {
      let urls = [];
      try {
        const url = await gdUrl(id);
        const normalized = fixHttpUrl(url);
        if (normalized && normalized.startsWith('http')) urls.push({ url: normalized });
      } catch {}
      writeJson(res, 200, { id, source: 'unified', urls });
    }
    return true;
  }

  // 流媒体
  if (pathname === '/api/stream') {
    const songId = String(query.get('id') || '').trim();
    const quality = String(query.get('quality') || '740');
    if (!songId) {
      res.writeHead(400, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('缺少歌曲 ID');
    } else {
      try {
        // 音质降级链：flac(740) → 320k → 128k → 网易直连
        const fallbackChain = (quality === '740') ? ['740', '320', '128'] : (quality === '320' ? ['320', '128'] : ['128']);
        let cdnUrl = '';
        for (const q of fallbackChain) {
          cdnUrl = fixHttpUrl(await gdUrl(songId, q).catch(() => ''));
          if (cdnUrl && cdnUrl.startsWith('http')) break;
        }
        // GD 全部失败，用 LX Music API 兜底
        if (!cdnUrl) {
          try {
            const lxData = await getJson(`https://lxmusicapi.onrender.com/url/wy/${encodeURIComponent(songId)}/320k`, {
              headers: { 'X-Request-Key': 'share-v3' },
              timeout: 5000,
            });
            cdnUrl = extractUrl(lxData);
          } catch {}
        }
        // LX API 也失败，用网易云直连最后兜底
        if (!cdnUrl) cdnUrl = `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(songId)}.mp3`;
        if (cdnUrl && cdnUrl.startsWith('http')) {
          res.writeHead(302, { ...CORS, Location: cdnUrl });
          res.end();
        } else {
          res.writeHead(404, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
          res.end('没有可播放的音乐地址');
        }
      } catch {
        res.writeHead(404, { ...CORS, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('没有可播放的音乐地址');
      }
    }
    return true;
  }

  // 图片代理
  if (pathname === '/api/img') {
    const imageUrl = String(query.get('url') || '');
    if (!imageUrl.startsWith('http')) {
      res.writeHead(400, CORS);
      res.end('bad url');
      return true;
    }
    streamRemote(req, res, imageUrl, 0, () => {
      if (!res.headersSent) { res.writeHead(502, CORS); res.end('图片加载失败'); }
    }, true);
    return true;
  }

  // 下载（代理转发 CDN 流，确保 Content-Disposition 生效）
  if (pathname === '/api/download') {
    const id = String(query.get('id') || '').trim();
    const quality = String(query.get('quality') || '740');
    const name = String(query.get('name') || 'song').replace(/[\\/:*?"<>|]/g, '_');
    if (!id) { res.writeHead(400, CORS); res.end('缺少歌曲 ID'); }
    else {
      try {
        const fallbackChain = (quality === '740') ? ['740', '320', '128'] : (quality === '320' ? ['320', '128'] : ['128']);
        let cdnUrl = '';
        for (const q of fallbackChain) {
          cdnUrl = fixHttpUrl(await gdUrl(id, q).catch(() => ''));
          if (cdnUrl && cdnUrl.startsWith('http')) break;
        }
        if (!cdnUrl) {
          try {
            const lxData = await getJson(`https://lxmusicapi.onrender.com/url/wy/${encodeURIComponent(id)}/320k`, {
              headers: { 'X-Request-Key': 'share-v3' }, timeout: 5000,
            });
            cdnUrl = extractUrl(lxData);
          } catch {}
        }
        if (!cdnUrl) cdnUrl = `https://music.163.com/song/media/outer/url?id=${encodeURIComponent(id)}.mp3`;
        if (cdnUrl && cdnUrl.startsWith('http')) {
          const origWriteHead = res.writeHead.bind(res);
          res.writeHead = function (code, headers) {
            origWriteHead(code, {
              ...headers,
              'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(name)}.mp3`,
              'Cache-Control': 'no-store',
            });
          };
          streamRemote(req, res, cdnUrl, 0, () => {
            if (!res.headersSent) { res.writeHead(404, CORS); res.end('下载失败'); }
          });
        } else {
          res.writeHead(404, CORS); res.end('没有可播放的音乐地址');
        }
      } catch {
        res.writeHead(404, CORS); res.end('没有可播放的音乐地址');
      }
    }
    return true;
  }

  // 用户数据
  if (pathname === '/api/user/save' && req.method === 'POST') {
    try {
      const uid = query.get('uid') || 'guest';
      const body = await readBody(req);
      JSON.parse(body);
      fs.writeFileSync(userFile(uid), body);
      writeJson(res, 200, { ok: true });
    } catch { writeJson(res, 400, { error: '数据格式错误' }); }
    return true;
  }

  if (pathname === '/api/user/load') {
    try {
      const uid = query.get('uid') || 'guest';
      writeJson(res, 200, JSON.parse(fs.readFileSync(userFile(uid), 'utf8')));
    } catch { writeJson(res, 200, {}); }
    return true;
  }

  // 诊断
  if (pathname === '/ping') {
    const diagnostics = { ok: true, source: SOURCE_INFO };
    try {
      const demo = await searchSongs('周杰伦');
      diagnostics.searchCount = demo.length;
      diagnostics.firstSong = demo[0] || null;
    } catch (error) {
      diagnostics.ok = false;
      diagnostics.error = error.message;
    }
    writeJson(res, 200, diagnostics);
    return true;
  }

  return false;
}

// ========== HTTP 服务 ==========

http
  .createServer(async (req, res) => {
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); res.end(); return; }
    const parsed = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const pathname = decodeURIComponent(parsed.pathname);
    try {
      if (await handleApi(req, res, pathname, parsed.searchParams)) return;
    } catch (error) {
      if (!res.headersSent) writeJson(res, 500, { error: error.message || '服务器错误' });
      return;
    }
    const staticMap = {
      '/': ['index.html', 'text/html; charset=utf-8'],
      '/index.html': ['index.html', 'text/html; charset=utf-8'],
      '/manifest.json': ['manifest.json', 'application/manifest+json; charset=utf-8'],
      '/sw.js': ['sw.js', 'application/javascript; charset=utf-8'],
      '/donate.png': ['donate.png', 'image/png'],
      '/icon-192.png': ['icon-192.png', 'image/png'],
      '/icon-512.png': ['icon-512.png', 'image/png'],
      '/icon.svg': ['icon.svg', 'image/svg+xml; charset=utf-8'],
      '/1.mp4': ['1.mp4', 'video/mp4'],
    };
    if (staticMap[pathname]) {
      const [fileName, contentType] = staticMap[pathname];
      serveFile(res, path.join(ROOT, fileName), contentType);
      return;
    }
    writeJson(res, 404, { error: '接口不存在' });
  })
  .listen(PORT, () => {
    console.log(`小源音乐已启动（统一音乐源）：http://localhost:${PORT}`);
  });
