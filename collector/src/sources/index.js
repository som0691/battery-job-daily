// collector/src/sources/index.js
import * as cheerio from 'cheerio';
import { politeFetch } from '../http.js';
import { SOURCES, CAREER_SITES, QUERIES, LIMITS } from '../config.js';
import { normalize } from '../normalize.js';

const SKIP_VERIFY = process.env.SKIP_VERIFY === '1';

export async function collectAll() {
  const results = [];
  const report = [];

  for (const src of SOURCES) {
    const r = await runApiSource(src);
    report.push(r.report);
    results.push(...r.jobs);
  }

  const careers = await runCareerSites();
  report.push(...careers.report);
  results.push(...careers.jobs);

  return { jobs: results, report };
}

// ── API 소스 ────────────────────────────────────────────
async function runApiSource(src) {
  const base = { name: src.name, status: '미설정', items: 0, note: src.note };

  if (!src.enabled) return { jobs: [], report: { ...base, status: '비활성' } };
  if (!src.verified && !SKIP_VERIFY) {
    return { jobs: [], report: { ...base, status: '미검증', note: '엔드포인트/파라미터를 문서에서 확인한 뒤 config.js 의 verified 를 true 로 바꾸세요' } };
  }
  const key = process.env[src.keyEnv];
  if (!src.endpoint || !key) {
    return { jobs: [], report: { ...base, status: '미설정', note: `${src.keyEnv} 또는 엔드포인트가 비어 있습니다` } };
  }

  const jobs = [];
  try {
    for (const q of QUERIES) {
      const url = new URL(src.endpoint);
      url.searchParams.set('keyword', q);
      url.searchParams.set('serviceKey', key);
      const res = await politeFetch(url.toString());
      const ct = res.headers.get('content-type') || '';
      const payload = ct.includes('json') ? await res.json() : await res.text();
      for (const item of extractItems(payload)) {
        const n = normalize(mapApiItem(item), src.kind);
        if (n) jobs.push(n);
      }
    }
    return { jobs, report: { ...base, status: '정상', items: jobs.length, note: null } };
  } catch (err) {
    return { jobs, report: { ...base, status: '실패', items: jobs.length, note: String(err.message).slice(0, 200) } };
  }
}

// 응답 스키마는 제공처마다 다르다. 흔한 형태 몇 가지를 훑고, 못 찾으면 빈 배열.
function extractItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== 'object') return [];
  const paths = [
    ['jobs', 'job'], ['response', 'body', 'items', 'item'], ['items'], ['result'], ['data'],
  ];
  for (const p of paths) {
    let cur = payload;
    for (const k of p) cur = cur?.[k];
    if (Array.isArray(cur)) return cur;
    if (cur && typeof cur === 'object') return [cur];
  }
  return [];
}

// 필드명이 제공처마다 달라서 후보를 넓게 잡는다.
function mapApiItem(it) {
  const pick = (...keys) => {
    for (const k of keys) {
      const v = k.split('.').reduce((o, kk) => o?.[kk], it);
      if (v != null && String(v).trim() !== '') return typeof v === 'object' ? v.name || v.text || '' : v;
    }
    return '';
  };
  return {
    title: pick('title', 'position.title', 'recrutPbancTtl', 'wantedTitle'),
    companyName: pick('company.detail.name', 'company.name', 'companyName', 'instNm', 'coNm'),
    location: pick('position.location.name', 'workRegion', 'location', 'workPlcNm'),
    employmentType: pick('position.job-type.name', 'employmentType', 'hireTypeNmLst'),
    experienceText: pick('position.experience-level.name', 'career', 'recrutSeNm'),
    postedAt: pick('posting-timestamp', 'postedAt', 'pbancBgngYmd', 'regDt'),
    deadline: pick('expiration-timestamp', 'closeDt', 'pbancEndYmd', 'endDt'),
    deadlineText: pick('closeType', 'deadlineText'),
    url: pick('url', 'srcUrl', 'wantedInfoUrl', 'srcUrl'),
    summary: toList(pick('position.job-code.name', 'jobCont', 'description')),
    requirements: toList(pick('requirements', 'qualification')),
    preferred: toList(pick('preferred', 'prefCondCont')),
    source: 'public_api',
  };
}

function toList(v) {
  if (!v) return [];
  return String(v).split(/[\n·•]|,\s(?=[가-힣A-Za-z])/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
}

// ── 기업 공식 채용페이지 ────────────────────────────────
async function runCareerSites() {
  const jobs = [];
  const report = [];

  for (const site of CAREER_SITES) {
    if (!site.selectors) {
      report.push({
        name: `${site.name} 공식 채용페이지`, status: '미설정', items: 0,
        note: 'config.js 의 selectors 를 채워야 파싱됩니다 (JS 렌더링 페이지는 목록 API 사용 권장)',
      });
      continue;
    }
    try {
      const res = await politeFetch(site.listUrl);
      const $ = cheerio.load(await res.text());
      const s = site.selectors;
      let n = 0;
      $(s.item).each((_, el) => {
        if (n >= LIMITS.maxPagesPerSource * 50) return;
        const q = (sel) => (sel ? $(el).find(sel).first().text().trim() : '');
        const href = s.link ? $(el).find(s.link).first().attr('href') : null;
        const item = normalize({
          title: q(s.title),
          companyId: site.companyId,
          companyName: site.name,
          location: q(s.location),
          employmentType: q(s.employmentType),
          experienceText: q(s.experience),
          deadline: q(s.deadline),
          deadlineText: q(s.deadline),
          postedAt: q(s.postedAt),
          url: href ? new URL(href, site.listUrl).toString() : site.listUrl,
          officialUrl: href ? new URL(href, site.listUrl).toString() : site.listUrl,
          summary: [], requirements: [], preferred: [],
          source: 'company_official',
        }, 'company_official');
        if (item) { jobs.push(item); n += 1; }
      });
      report.push({ name: `${site.name} 공식 채용페이지`, status: '정상', items: n, note: null });
    } catch (err) {
      const disallowed = err.code === 'ROBOTS_DISALLOW';
      report.push({
        name: `${site.name} 공식 채용페이지`,
        status: disallowed ? '수집 미허용' : '실패',
        items: 0,
        note: String(err.message).slice(0, 200),
      });
    }
  }

  return { jobs, report };
}
