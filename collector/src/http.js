// collector/src/http.js
// robots.txt 를 먼저 확인하고, 허용되지 않은 경로는 아예 요청하지 않는다.
import { LIMITS } from './config.js';

const robotsCache = new Map(); // origin -> rules
const lastHit = new Map(); // origin -> timestamp

export async function politeFetch(url, opts = {}) {
  const u = new URL(url);
  const allowed = await isAllowed(u);
  if (!allowed) {
    const e = new Error(`robots.txt 가 허용하지 않는 경로: ${u.pathname}`);
    e.code = 'ROBOTS_DISALLOW';
    throw e;
  }
  await throttle(u.origin);
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), LIMITS.timeoutMs);
  try {
    const res = await fetch(url, {
      ...opts,
      signal: ctl.signal,
      headers: { 'user-agent': LIMITS.userAgent, accept: '*/*', ...(opts.headers || {}) },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${url}`);
    return res;
  } finally {
    clearTimeout(t);
  }
}

async function throttle(origin) {
  const prev = lastHit.get(origin) || 0;
  const wait = LIMITS.requestDelayMs - (Date.now() - prev);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastHit.set(origin, Date.now());
}

export async function isAllowed(u) {
  const origin = u.origin;
  if (!robotsCache.has(origin)) {
    robotsCache.set(origin, await loadRobots(origin));
  }
  const rules = robotsCache.get(origin);
  if (rules === null) return true; // robots.txt 없음 = 제한 없음
  const path = u.pathname + u.search;

  // 가장 긴 매칭 규칙이 이긴다 (표준 동작)
  let best = { len: -1, allow: true };
  for (const r of rules) {
    if (r.path && path.startsWith(r.path) && r.path.length > best.len) {
      best = { len: r.path.length, allow: r.allow };
    }
  }
  return best.allow;
}

async function loadRobots(origin) {
  try {
    const res = await fetch(origin + '/robots.txt', {
      headers: { 'user-agent': LIMITS.userAgent },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const txt = await res.text();
    return parseRobots(txt, LIMITS.userAgent);
  } catch {
    // robots.txt 를 못 읽으면 보수적으로 전면 차단
    return [{ path: '/', allow: false }];
  }
}

export function parseRobots(txt, ua) {
  const groups = [];
  let cur = null;
  for (const rawLine of txt.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim();
    if (!line) continue;
    const [kRaw, ...rest] = line.split(':');
    const k = kRaw.trim().toLowerCase();
    const v = rest.join(':').trim();
    if (k === 'user-agent') {
      if (!cur || cur.rules.length) { cur = { agents: [], rules: [] }; groups.push(cur); }
      cur.agents.push(v.toLowerCase());
    } else if ((k === 'allow' || k === 'disallow') && cur) {
      cur.rules.push({ path: v, allow: k === 'allow' });
    }
  }
  const uaLc = ua.toLowerCase();
  const exact = groups.find((g) => g.agents.some((a) => a !== '*' && uaLc.includes(a)));
  const star = groups.find((g) => g.agents.includes('*'));
  const chosen = exact || star;
  return chosen ? chosen.rules.filter((r) => r.path !== '') : null;
}
