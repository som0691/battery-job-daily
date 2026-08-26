// assets/js/app.js
import { classify, CATEGORIES } from '../../shared/classify.js';
import { scoreJob, DEFAULT_PROFILE } from '../../shared/score.js';

const KST = 'Asia/Seoul';
const SIZES = ['대기업', '중견기업', '중소·스타트업', '분류 미확인'];

// ── 저장소 (localStorage 차단 환경에서도 죽지 않게) ──────────
const store = (() => {
  let mem = {};
  const ok = (() => { try { localStorage.setItem('__t', '1'); localStorage.removeItem('__t'); return true; } catch { return false; } })();
  return {
    get(k, d) {
      try { const v = ok ? localStorage.getItem(k) : mem[k]; return v == null ? d : JSON.parse(v); } catch { return d; }
    },
    set(k, v) {
      const s = JSON.stringify(v);
      try { if (ok) localStorage.setItem(k, s); else mem[k] = s; } catch { mem[k] = s; }
    },
  };
})();

const state = {
  jobs: [],
  companies: new Map(),
  meta: null,
  tab: 'A',
  q: '',
  sort: 'fit',
  view: 'active',
  sizes: new Set(),
  misc: new Set(['entry']), // 기본: 신입·인턴·경력무관 우선
  date: todayISO(),
  profile: { ...DEFAULT_PROFILE, ...store.get('bjd.profile', {}) },
  marks: store.get('bjd.marks', {}), // id -> {saved, status:'planned'|'applied', hidden}
};

const $ = (s) => document.querySelector(s);

// ── 부팅 ────────────────────────────────────────────────
init();

async function init() {
  document.documentElement.dataset.theme = store.get('bjd.theme', prefersDark() ? 'dark' : 'light');
  $('#datePick').value = state.date;
  bindUI();
  try {
    const [jobsRes, metaRes, coRes] = await Promise.all([
      fetch('./data/jobs.json', { cache: 'no-store' }),
      fetch('./data/meta.json', { cache: 'no-store' }),
      fetch('./data/companies.json', { cache: 'no-store' }),
    ]);
    const jobsDoc = await jobsRes.json();
    state.meta = await metaRes.json();
    const coDoc = await coRes.json();
    for (const c of coDoc.companies || []) state.companies.set(c.id, c);
    state.jobs = (jobsDoc.jobs || []).map(enrich);
  } catch (err) {
    state.loadError = err;
  }
  render();
}

function bindUI() {
  $('#themeBtn').addEventListener('click', () => {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    store.set('bjd.theme', next);
  });
  $('#q').addEventListener('input', (e) => { state.q = e.target.value.trim(); render(); });
  $('#sort').addEventListener('change', (e) => { state.sort = e.target.value; render(); });
  $('#view').addEventListener('change', (e) => { state.view = e.target.value; render(); });
  $('#datePick').addEventListener('change', (e) => { state.date = e.target.value; render(); });
  $('#prevDay').addEventListener('click', () => shiftDay(-1));
  $('#nextDay').addEventListener('click', () => shiftDay(1));
  $('#todayBtn').addEventListener('click', () => { state.date = todayISO(); $('#datePick').value = state.date; render(); });
  $('#settingsBtn').addEventListener('click', openSettings);
  $('#pfSave').addEventListener('click', saveSettings);
}

function shiftDay(n) {
  const d = new Date(state.date + 'T00:00:00+09:00');
  d.setDate(d.getDate() + n);
  state.date = d.toISOString().slice(0, 10);
  $('#datePick').value = state.date;
  render();
}

// ── 공고 가공 ────────────────────────────────────────────
function enrich(raw) {
  const job = { ...raw, detail: raw.detail || {} };
  const co = state.companies.get(job.company?.id) || null;
  job.companyMeta = co;
  job.size = co?.size || '분류 미확인';
  job.sizeSource = co?.size_source || null;

  const cls = classify(job);
  job.category = raw.category || cls.category;
  job.categories = raw.categories || cls.categories;
  job.tags = raw.tags || cls.tags;

  job.fit = scoreJob(job, state.profile);
  Object.assign(job, deadlineInfo(job));
  return job;
}

function rescore() {
  state.jobs = state.jobs.map((j) => {
    j.fit = scoreJob(j, state.profile);
    return j;
  });
}

function deadlineInfo(job) {
  if (job.always_open) return { dday: null, ddayLabel: '상시', urgency: 'calm', soc: 100, closed: false };
  if (job.until_filled) return { dday: null, ddayLabel: '채용시 마감', urgency: 'calm', soc: 100, closed: false };
  if (!job.deadline) return { dday: null, ddayLabel: '마감일 미확인', urgency: 'calm', soc: 100, closed: false };

  const end = new Date(job.deadline);
  const now = new Date();
  const days = Math.ceil((end - now) / 86400000);
  const soc = Math.max(4, Math.min(100, (days / 30) * 100));

  if (days < 0) return { dday: days, ddayLabel: '마감', urgency: 'calm', soc: 0, closed: true };
  if (days === 0) return { dday: 0, ddayLabel: 'D-DAY', urgency: 'today', soc: 6, closed: false };
  let urgency = 'calm';
  if (days <= 3) urgency = 'red';
  else if (days <= 7) urgency = 'orange';
  else if (days <= 14) urgency = 'yellow';
  return { dday: days, ddayLabel: `D-${days}`, urgency, soc, closed: false };
}

// ── 필터링 ──────────────────────────────────────────────
function baseSet() {
  return state.jobs.filter((j) => {
    const m = state.marks[j.id] || {};
    const isClosed = j.closed || j.status === 'closed';
    switch (state.view) {
      case 'archived': return isClosed;
      case 'saved': return m.saved && !isClosed;
      case 'planned': return m.status === 'planned' && !isClosed;
      case 'applied': return m.status === 'applied';
      case 'hidden': return m.hidden;
      default: return !isClosed && !m.hidden;
    }
  });
}

function applyFilters(list, { skipTab = false } = {}) {
  return list.filter((j) => {
    if (!skipTab && j.category !== state.tab) return false;
    if (state.sizes.size && !state.sizes.has(j.size)) return false;
    if (state.misc.has('entry') && !['신입', '인턴', '경력무관'].includes(j.experience)) return false;
    if (state.misc.has('soon') && !(j.dday != null && j.dday <= 7 && j.dday >= 0)) return false;
    if (state.misc.has('domestic') && j.overseas) return false;
    if (state.misc.has('day') && j.posted_at !== state.date) return false;
    if (state.q) {
      const hay = [j.title, j.company?.name, j.location, ...(j.tags || [])].join(' ').toLowerCase();
      if (!hay.includes(state.q.toLowerCase())) return false;
    }
    return true;
  });
}

function sortList(list) {
  const arr = [...list];
  if (state.sort === 'fit') arr.sort((a, b) => b.fit.score - a.fit.score);
  else if (state.sort === 'posted') arr.sort((a, b) => (b.posted_at || '').localeCompare(a.posted_at || ''));
  else arr.sort((a, b) => (a.dday ?? 9999) - (b.dday ?? 9999));
  return arr;
}

// ── 렌더 ────────────────────────────────────────────────
function render() {
  renderStatus();
  renderBanners();
  renderPicks();
  renderTabs();
  renderPills();
  renderList();
  $('#footNote').textContent = state.meta?.last_success_at
    ? `마지막 수집 성공: ${fmtDT(state.meta.last_success_at)} · 활성 ${countActive()}건`
    : '아직 수집이 한 번도 성공하지 않았습니다. 화면의 데이터는 샘플입니다.';
}

function renderStatus() {
  const m = state.meta || {};
  const active = countActive();
  const newToday = state.jobs.filter((j) => j.posted_at === todayISO()).length;
  const soon = state.jobs.filter((j) => !j.closed && j.dday != null && j.dday >= 0 && j.dday <= 7).length;
  const okRun = m.run_status === 'ok';
  $('#statusbar').innerHTML = [
    stat(fmtDT(m.last_success_at) || '없음', '마지막 갱신 성공'),
    stat(newToday, '오늘 새로 발견'),
    stat(active, '전체 활성 공고'),
    stat(soon, '7일 내 마감', soon > 0 ? 'warn' : ''),
    stat(okRun ? '정상' : m.run_status === 'seed' ? '미실행' : '실패', '갱신 상태', okRun ? 'ok' : 'warn'),
  ].join('');
}

function stat(n, l, mod = '') {
  return `<div class="stat ${mod ? 'stat--' + mod : ''}"><span class="stat__n">${esc(String(n))}</span><span class="stat__l">${esc(l)}</span></div>`;
}

function renderBanners() {
  const out = [];
  if (state.loadError) {
    out.push(`<div class="banner banner--error"><strong>데이터를 불러오지 못했습니다.</strong> data/jobs.json 경로를 확인하세요. 로컬에서 열었다면 <code>python3 -m http.server</code> 로 서버를 띄워야 합니다.</div>`);
  }
  if (state.jobs.some((j) => j.sample)) {
    out.push(`<div class="banner"><strong>샘플 데이터입니다.</strong> 화면 구성을 확인하기 위한 가상의 공고이며 실제 채용공고가 아닙니다. <code>npm run collect</code> 또는 GitHub Actions를 한 번 실행하면 실제 수집 결과로 교체됩니다.</div>`);
  }
  if (state.meta && state.meta.run_status === 'failed') {
    out.push(`<div class="banner banner--error"><strong>마지막 갱신에 실패했습니다.</strong> 표시 중인 데이터는 ${esc(fmtDT(state.meta.last_success_at) || '이전')} 기준입니다. 사유: ${esc(state.meta.error || '미상')}</div>`);
  }
  $('#banners').innerHTML = out.join('');
}

function renderPicks() {
  const pool = sortList(applyFilters(baseSet(), { skipTab: true })).slice(0, 5);
  const sec = $('#picksSection');
  if (!pool.length) { sec.hidden = true; return; }
  sec.hidden = false;
  $('#picks').innerHTML = pool.map((j, i) => `
    <button class="pick" data-goto="${esc(j.id)}">
      <span class="pick__rank">추천 ${i + 1} · 적합도 ${j.fit.score}</span>
      <span class="pick__title">${esc(j.title)}</span>
      <span class="pick__co">${esc(j.company?.name || '기업 미확인')} · ${esc(j.ddayLabel)}</span>
      <span class="pick__why">${esc(j.fit.reasons[0] || '프로필 관련 키워드 일부 일치')}</span>
    </button>`).join('');
  $('#picks').querySelectorAll('[data-goto]').forEach((el) => {
    el.addEventListener('click', () => {
      const id = el.dataset.goto;
      const job = state.jobs.find((x) => x.id === id);
      if (job) { state.tab = job.category; state.view = 'active'; $('#view').value = 'active'; render(); }
      requestAnimationFrame(() => {
        const card = document.getElementById('card-' + id);
        if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'center' }); toggleDetail(id, true); }
      });
    });
  });
}

function renderTabs() {
  const base = baseSet();
  $('#tabs').innerHTML = Object.values(CATEGORIES).map((c) => {
    const n = applyFilters(base.filter((j) => j.category === c.id), { skipTab: true }).length;
    return `<button class="tab" role="tab" data-cat="${c.id}" aria-selected="${state.tab === c.id}">
      ${c.id}. ${esc(c.label)}<span class="tab__n">${n}</span></button>`;
  }).join('');
  $('#tabs').querySelectorAll('[data-cat]').forEach((el) => {
    el.addEventListener('click', () => { state.tab = el.dataset.cat; render(); });
  });
}

function renderPills() {
  const inTab = applyFilters(baseSet().filter((j) => j.category === state.tab), { skipTab: true });
  $('#sizePills').innerHTML = SIZES.map((s) => {
    const n = inTab.filter((j) => j.size === s).length;
    return `<button class="pill" data-size="${esc(s)}" aria-pressed="${state.sizes.has(s)}">${esc(s)}<span class="pill__n">${n}</span></button>`;
  }).join('');
  $('#sizePills').querySelectorAll('[data-size]').forEach((el) => {
    el.addEventListener('click', () => { toggleSet(state.sizes, el.dataset.size); render(); });
  });

  const misc = [
    ['entry', '신입·인턴·경력무관만'],
    ['soon', '마감 임박(7일 내)'],
    ['domestic', '국내 근무만'],
    ['day', `${state.date} 등록분만`],
  ];
  $('#miscPills').innerHTML = misc.map(([k, l]) =>
    `<button class="pill" data-misc="${k}" aria-pressed="${state.misc.has(k)}">${esc(l)}</button>`).join('');
  $('#miscPills').querySelectorAll('[data-misc]').forEach((el) => {
    el.addEventListener('click', () => { toggleSet(state.misc, el.dataset.misc); render(); });
  });
}

function renderList() {
  const list = sortList(applyFilters(baseSet()));
  const el = $('#list');
  if (!list.length) {
    el.innerHTML = `<div class="empty"><h3>조건에 맞는 공고가 없습니다</h3>
      <p>필터를 줄이거나 다른 카테고리 탭을 확인해 보세요.</p>
      <button class="btn" id="resetF">필터 초기화</button></div>`;
    $('#resetF')?.addEventListener('click', () => { state.sizes.clear(); state.misc.clear(); state.q = ''; $('#q').value = ''; render(); });
    return;
  }
  el.innerHTML = list.map(cardHTML).join('');
  el.querySelectorAll('[data-toggle]').forEach((b) => b.addEventListener('click', () => toggleDetail(b.dataset.toggle)));
  el.querySelectorAll('[data-mark]').forEach((b) => b.addEventListener('click', () => mark(b.dataset.id, b.dataset.mark)));
}

function cardHTML(j) {
  const m = state.marks[j.id] || {};
  const closed = j.closed || j.status === 'closed';
  const sizeChip = j.size === '분류 미확인'
    ? `<span class="chip chip--unknown" title="공신력 있는 출처로 확인되지 않았습니다">분류 미확인</span>`
    : `<span class="chip" title="${esc(j.sizeSource?.label || '')}${j.sizeSource?.verified === false ? ' (근거 미검증)' : ''}">${esc(j.size)}${j.sizeSource?.verified === false ? ' *' : ''}</span>`;

  return `
<article class="card ${closed ? 'card--closed' : ''}" id="card-${esc(j.id)}" data-urgency="${j.urgency}">
  <div class="soc" aria-hidden="true"><span class="soc__fill" style="height:${j.soc}%"></span></div>
  <div class="card__body">
    <div class="card__top">
      <div class="card__main">
        <div class="card__co">
          ${logoHTML(j)}
          <span>${esc(j.company?.name || '기업 미확인')}</span>
          ${sizeChip}
          ${j.sample ? '<span class="chip chip--sample">샘플</span>' : ''}
          ${j.overseas ? '<span class="chip chip--overseas">해외 근무</span>' : ''}
        </div>
        <button class="card__title" data-toggle="${esc(j.id)}" aria-expanded="false" aria-controls="d-${esc(j.id)}">${esc(j.title)}</button>
        <div class="meta">
          <span class="chip chip--cat">${CATEGORIES[j.category].id}. ${esc(CATEGORIES[j.category].short)}</span>
          ${(j.tags || []).slice(0, 5).map((t) => `<span class="chip chip--tag">${esc(t)}</span>`).join('')}
          <span class="chip">${esc(j.experience || '구분 미확인')}</span>
          <span class="chip">${esc(j.location || '근무지 미확인')}</span>
          <span class="chip">${esc(j.employment_type || '고용형태 미확인')}</span>
        </div>
      </div>
      <div class="card__right">
        <span class="dday">${esc(j.ddayLabel)}</span>
        <span class="dday__date">${j.deadline ? fmtD(j.deadline) : '—'}</span>
      </div>
    </div>

    <div class="fit">
      <span class="fit__score">${j.fit.score}</span>
      <span class="fit__bar"><span style="width:${j.fit.score}%"></span></span>
      <span class="fit__why">${esc(fitWhy(j))}</span>
    </div>

    <div class="card__foot">
      <span>등록 ${esc(j.posted_at || '미확인')}</span>
      <span>확인 ${esc(fmtDT(j.checked_at) || '미확인')}</span>
      <span class="card__acts">
        <button class="act" data-mark="saved" data-id="${esc(j.id)}" aria-pressed="${!!m.saved}">${m.saved ? '★ 관심' : '☆ 관심'}</button>
        <button class="act" data-mark="planned" data-id="${esc(j.id)}" aria-pressed="${m.status === 'planned'}">지원 예정</button>
        <button class="act" data-mark="applied" data-id="${esc(j.id)}" aria-pressed="${m.status === 'applied'}">지원 완료</button>
        <button class="act" data-mark="hidden" data-id="${esc(j.id)}" aria-pressed="${!!m.hidden}">${m.hidden ? '숨김 해제' : '숨기기'}</button>
      </span>
    </div>
  </div>
  <div class="detail" id="d-${esc(j.id)}" hidden>${detailHTML(j)}</div>
</article>`;
}

// 점수가 낮으면 강점보다 '왜 낮은지'가 더 쓸모 있는 정보다.
function fitWhy(j) {
  if (j.fit.score < 50 && j.fit.gaps.length) return j.fit.gaps[0];
  return j.fit.reasons[0] || j.fit.gaps[0] || j.fit.needs_check[0] || '프로필 대비 판단 근거 부족';
}

function logoHTML(j) {
  const co = j.companyMeta;
  if (co?.domain) return `<img class="logo" src="https://www.google.com/s2/favicons?domain=${esc(co.domain)}&sz=64" alt="" loading="lazy" />`;
  return `<span class="logo logo--ph" aria-hidden="true">${esc((j.company?.name || '?').slice(0, 1))}</span>`;
}

function detailHTML(j) {
  const d = j.detail || {};
  const co = j.companyMeta || {};
  const ul = (arr, empty) => (arr && arr.length)
    ? `<ul>${arr.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>`
    : `<p class="unknown">${esc(empty)}</p>`;

  const kw = [...new Set([...(j.tags || []), ...(state.profile.instruments || [])])].slice(0, 8);

  return `
<div class="detail__grid">
  <div class="block">
    <h4 class="block__h" data-origin="official">공고에서 확인된 내용 — 주요 업무</h4>
    ${ul(d.summary, '공고 본문에서 업무 요약을 추출하지 못했습니다. 원문을 확인하세요.')}
    <h4 class="block__h" data-origin="official" style="margin-top:14px">필수 자격</h4>
    ${ul(d.requirements, '필수 자격 항목을 추출하지 못했습니다.')}
    <h4 class="block__h" data-origin="official" style="margin-top:14px">우대사항</h4>
    ${ul(d.preferred, '우대사항 항목을 추출하지 못했습니다.')}
  </div>

  <div class="block">
    <h4 class="block__h" data-origin="ai">AI 맞춤 지원 전략 — 내 연구와 연결점</h4>
    ${ul(linkPoints(j), '연결점을 자동으로 도출하지 못했습니다.')}
    <h4 class="block__h" data-origin="ai" style="margin-top:14px">강조할 키워드</h4>
    <div class="meta">${kw.map((t) => `<span class="chip chip--tag">${esc(t)}</span>`).join('') || '<span class="unknown">없음</span>'}</div>
    <h4 class="block__h" data-origin="ai" style="margin-top:14px">예상 면접 질문</h4>
    ${ul(interviewQs(j), '질문을 생성하지 못했습니다.')}
    <h4 class="block__h" data-origin="ai" style="margin-top:14px">지원 전 확인할 부족 역량</h4>
    ${ul([...j.fit.gaps, ...j.fit.needs_check], '확인이 필요한 항목이 없습니다.')}
  </div>

  <div class="block">
    <h4 class="block__h">적합도 근거</h4>
    <div class="bars">
      ${j.fit.breakdown.map((b) => `
        <div class="bars__row">
          <span>${esc(b.label)}</span>
          <span class="bars__track"><span style="width:${Math.round((b.got / b.max) * 100)}%"></span></span>
          <span class="bars__val">${b.got}/${b.max}</span>
        </div>`).join('')}
    </div>
    <h4 class="block__h" data-origin="official" style="margin-top:16px">기업 공식 정보</h4>
    <p><strong>인재상</strong><br>${co.talent_statement ? esc(co.talent_statement) : '<span class="unknown">확인 가능한 공개 정보 없음</span>'}</p>
    ${co.talent_source ? `<p class="srcline">출처: <a href="${esc(co.talent_source)}" target="_blank" rel="noopener">${esc(co.talent_source)}</a></p>` : ''}
    <p><strong>신입 초봉 / 연봉</strong><br>${co.salary_entry ? esc(co.salary_entry) : '<span class="unknown">확인 가능한 공개 정보 없음</span>'}</p>
    ${co.salary_source ? `<p class="srcline">출처: ${esc(co.salary_source)} · 기준 ${esc(String(co.salary_year || '연도 미확인'))}</p>` : ''}
    ${j.sizeSource?.label ? `<p class="srcline">기업 규모 근거: ${esc(j.sizeSource.label)}${j.sizeSource.verified === false ? ' (* 자동 검증되지 않음)' : ''}</p>` : ''}
  </div>
</div>

<div class="detail__links">
  ${j.official_url ? `<a class="btn" href="${esc(j.official_url)}" target="_blank" rel="noopener">공식 채용 페이지</a>` : ''}
  ${j.source_url && j.source_url !== j.official_url ? `<a class="btn" href="${esc(j.source_url)}" target="_blank" rel="noopener">원문 공고</a>` : ''}
  ${co.careers_url && co.careers_url !== j.official_url ? `<a class="btn" href="${esc(co.careers_url)}" target="_blank" rel="noopener">기업 채용 홈</a>` : ''}
  ${!j.official_url && !j.source_url && !co.careers_url ? '<span class="unknown">원문 링크 미확인</span>' : ''}
</div>`;
}

function linkPoints(j) {
  const out = [];
  const t = (j.tags || []);
  if (t.some((x) => /XPS|ToF-SIMS|표면분석|계면분석/.test(x))) out.push('리튬 금속 표면의 SEI 조성 분석 경험을 정량 분석 역량으로 제시');
  if (t.some((x) => /SEM|TEM|FIB|STEM/.test(x))) out.push('전극 단면·표면 형상 관찰 경험을 불량/열화 분석 경험으로 연결');
  if (t.some((x) => /Lithium metal|리튬금속 음극|덴드라이트|SEI|plating/.test(x))) out.push('표면처리 조건에 따른 plating/stripping 거동 차이를 직무 핵심 질문과 직접 연결');
  if (t.some((x) => /전해질|첨가제/.test(x))) out.push('전해질 조성이 계면 형성에 미치는 영향을 다룬 실험 설계 경험을 강조');
  if (!out.length) out.push('공고 키워드와 직접 겹치는 연구 경험이 뚜렷하지 않음 — 전기화학 평가 일반 역량 중심으로 서술');
  return out;
}

function interviewQs(j) {
  const t = (j.tags || []).join(' ');
  const qs = [];
  if (/SEI|계면|표면처리|Lithium metal/.test(t)) qs.push('표면 상태가 다른 두 리튬 전극에서 초기 계면이 어떻게 달라지고, 그 차이를 어떤 분석으로 입증했나요?');
  if (/XPS|ToF-SIMS|TEM|SEM/.test(t)) qs.push('분석 결과의 재현성과 아티팩트를 어떻게 구분했는지 구체적 사례로 설명해 주세요.');
  if (/전해질|첨가제/.test(t)) qs.push('전해질 조성 변수를 바꿀 때 대조군을 어떻게 설계했나요?');
  qs.push('연구 결과를 양산 또는 제품 관점의 지표로 옮긴다면 무엇을 지표로 잡겠습니까?');
  return qs.slice(0, 3);
}

// ── 상호작용 ────────────────────────────────────────────
function toggleDetail(id, force) {
  const panel = document.getElementById('d-' + id);
  const btn = document.querySelector(`[data-toggle="${CSS.escape(id)}"]`);
  if (!panel) return;
  const open = force ?? panel.hidden;
  panel.hidden = !open;
  btn?.setAttribute('aria-expanded', String(open));
}

function mark(id, key) {
  const m = state.marks[id] || {};
  if (key === 'saved') m.saved = !m.saved;
  else if (key === 'hidden') m.hidden = !m.hidden;
  else m.status = m.status === key ? null : key;
  state.marks[id] = m;
  store.set('bjd.marks', state.marks);
  render();
}

function openSettings() {
  const p = state.profile;
  $('#pfDegree').value = p.degree || '';
  $('#pfDegreeAt').value = p.degreeExpectedAt || '';
  $('#pfYears').value = p.experienceYears ?? '';
  $('#pfLoc').value = (p.locations || []).join(', ');
  $('#pfSkills').value = (p.skills || []).join(', ');
  $('#pfOverseas').value = p.openToOverseas == null ? '' : p.openToOverseas ? 'yes' : 'no';
  $('#settingsDlg').showModal();
}

function saveSettings() {
  const list = (v) => { const a = v.split(',').map((s) => s.trim()).filter(Boolean); return a.length ? a : null; };
  const ov = $('#pfOverseas').value;
  state.profile = {
    ...state.profile,
    degree: $('#pfDegree').value || null,
    degreeExpectedAt: $('#pfDegreeAt').value || null,
    experienceYears: $('#pfYears').value === '' ? null : Number($('#pfYears').value),
    locations: list($('#pfLoc').value),
    skills: list($('#pfSkills').value),
    openToOverseas: ov === '' ? null : ov === 'yes',
  };
  store.set('bjd.profile', state.profile);
  rescore();
  render();
}

// ── 유틸 ────────────────────────────────────────────────
function countActive() { return state.jobs.filter((j) => !j.closed && j.status !== 'closed').length; }
function toggleSet(set, v) { set.has(v) ? set.delete(v) : set.add(v); }
function prefersDark() { return window.matchMedia?.('(prefers-color-scheme: dark)').matches; }
function todayISO() { return new Date().toLocaleDateString('sv-SE', { timeZone: KST }); }
function fmtD(s) { try { return new Date(s).toLocaleDateString('ko-KR', { timeZone: KST, month: '2-digit', day: '2-digit' }); } catch { return ''; } }
function fmtDT(s) { if (!s) return ''; try { return new Date(s).toLocaleString('ko-KR', { timeZone: KST, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); } catch { return ''; } }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
