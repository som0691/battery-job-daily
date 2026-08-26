// collector/src/dedupe.js
// 같은 공고가 여러 사이트에 있으면 하나로 합친다.
// 대표 링크 우선순위: 기업 공식 채용페이지 > 공공 API > 채용 플랫폼

const SOURCE_RANK = { company_official: 3, public_api: 2, platform_api: 1, platform: 1 };

export function dedupe(jobs) {
  const buckets = new Map();

  for (const job of jobs) {
    const key = fuzzyKey(job);
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(job);
  }

  const out = [];
  for (const group of buckets.values()) {
    out.push(group.length === 1 ? group[0] : merge(group));
  }
  return out;
}

function fuzzyKey(job) {
  const co = norm(job.company?.name);
  // 괄호·대괄호 블록과 공통 상투어를 먼저 걷어낸 뒤 정규화한다 (순서가 중요)
  const rawTitle = String(job.title ?? '')
    .replace(/\(.*?\)|\[.*?\]|<.*?>/g, ' ')
    .replace(/\d{4}\s*년?|상·?반기|하반기|수시|상시|채용|모집|공고|지원|전형/g, ' ');
  const ti = norm(rawTitle).slice(0, 20);
  // 근무지는 시·도 수준까지만 비교한다 ('대전' vs '대전 유성구'를 같은 것으로 본다)
  const loc = norm(job.location).slice(0, 2);
  return `${co}::${ti}::${loc}`;
}

function norm(s) {
  return String(s ?? '').toLowerCase().replace(/[\s\-_/·,()[\]]/g, '');
}

function merge(group) {
  const sorted = [...group].sort((a, b) => (SOURCE_RANK[b.source] || 0) - (SOURCE_RANK[a.source] || 0));
  const base = { ...sorted[0] };

  base.merged_from = sorted.slice(1).map((j) => ({ source: j.source, url: j.source_url })).filter((x) => x.url);

  // 필드별로 값이 있는 쪽을 채택. 마감일은 가장 늦은(=수정 반영) 값을 쓴다.
  for (const j of sorted.slice(1)) {
    for (const k of ['location', 'employment_type', 'experience_years_min', 'official_url']) {
      if (base[k] == null && j[k] != null) base[k] = j[k];
    }
    if (j.deadline && (!base.deadline || Date.parse(j.deadline) > Date.parse(base.deadline))) {
      base.deadline = j.deadline;
    }
    if (j.experience && base.experience === '구분 미확인') base.experience = j.experience;
    for (const k of ['summary', 'requirements', 'preferred']) {
      if (!base.detail[k]?.length && j.detail?.[k]?.length) base.detail[k] = j.detail[k];
    }
    if (!base.source_url && j.source_url) base.source_url = j.source_url;
  }

  // 공식 채용페이지가 그룹 안에 있으면 대표 링크로 승격
  const official = sorted.find((j) => j.source === 'company_official' && j.source_url);
  if (official) base.official_url = official.source_url;

  return base;
}

/**
 * 이전 스냅샷과 비교해 신규 / 마감 / 변경을 감지한다.
 */
export function diffAgainstPrevious(current, previous) {
  const prevMap = new Map(previous.map((j) => [j.id, j]));
  const curMap = new Map(current.map((j) => [j.id, j]));
  const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' });

  const added = [];
  const changed = [];

  for (const job of current) {
    const prev = prevMap.get(job.id);
    if (!prev) {
      job.first_seen_at = today;
      added.push(job);
      continue;
    }
    job.first_seen_at = prev.first_seen_at || prev.posted_at || today;
    // 사용자가 붙인 상태는 클라이언트(localStorage)에 있으므로 서버측 보존 대상 아님
    const deltas = [];
    if (prev.deadline !== job.deadline) deltas.push('마감일 변경');
    if (prev.title !== job.title) deltas.push('공고명 수정');
    if (prev.status === 'closed' && job.status === 'active') deltas.push('재등록');
    if (deltas.length) { job.changes = deltas; changed.push(job); }
  }

  // 이번 수집에서 사라진 공고 = 마감/삭제 → 보관함으로
  const closed = [];
  for (const prev of previous) {
    if (curMap.has(prev.id)) continue;
    if (prev.status === 'closed') { closed.push(prev); continue; }
    closed.push({ ...prev, status: 'closed', closed_detected_at: today });
  }

  return { added, changed, closed, all: [...current, ...closed] };
}
