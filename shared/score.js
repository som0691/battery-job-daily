// shared/score.js
// 0~100 적합도. 단순 키워드 개수가 아니라 축별 가중 합산 + 자격요건 감점.
// 사용자가 입력하지 않은 학력/경력/보유기술은 "충족"으로 가정하지 않고 needs_check 로 뺀다.

import { collectText } from './classify.js';

// 사용자가 설정화면에서 아직 입력하지 않은 값은 null 로 둔다. null = 미입력 = 가정 금지.
export const DEFAULT_PROFILE = {
  field: 'Lithium metal battery',
  focus: '리튬 금속 표면처리를 통한 성능 개선 및 작동 메커니즘 분석',
  interests: ['리튬 금속 음극', '계면 반응', 'SEI', '표면처리', '성능 저하 및 개선 메커니즘'],
  instruments: ['TEM', 'SEM', 'XPS'],
  preferredRoles: ['재료분석', '표면·계면 분석', '배터리 소재 R&D', '리튬메탈 및 차세대전지 R&D'],
  // ↓ 미입력 항목. 설정 화면에서 채우면 점수가 재계산된다.
  degree: null, // 'bachelor' | 'master' | 'phd'
  degreeExpectedAt: null, // 'YYYY-MM'
  experienceYears: null, // number
  locations: null, // string[]
  skills: null, // string[] 추가 보유기술
  openToOverseas: null, // boolean
};

const AXES = [
  {
    id: 'lithium',
    label: '리튬메탈·차세대전지 연관성',
    weight: 25,
    terms: [
      ['lithium ?metal|리튬 ?금속|Li ?metal', 1.0],
      ['무음극|anode[- ]?free', 0.9],
      ['전고체|all[- ]?solid[- ]?state', 0.75],
      ['리튬 ?황|lithium[- ]?sulfur|Li[- ]?S\\b', 0.75],
      ['차세대 ?(?:음극|전지|이차전지)', 0.6],
      ['덴드라이트|dendrite', 0.8],
    ],
  },
  {
    id: 'analysis',
    label: '분석기술(TEM·SEM·XPS 등) 연관성',
    weight: 25,
    terms: [
      ['\\bXPS\\b', 1.0],
      ['\\bTEM\\b|\\bSTEM\\b', 1.0],
      ['\\bSEM\\b', 0.9],
      ['\\bFIB\\b', 0.8],
      ['ToF[- ]?SIMS|TOF[- ]?SIMS', 0.8],
      ['\\bXRD\\b|\\bEDS\\b|\\bEELS\\b|라만|\\bRaman\\b|FT-?IR|\\bICP\\b|\\bAFM\\b', 0.6],
      ['표면 ?분석|계면 ?분석|소재 ?분석|미세 ?구조|특성 ?평가|불량 ?분석', 0.7],
    ],
  },
  {
    id: 'interface',
    label: '표면처리·계면·SEI·메커니즘 연관성',
    weight: 20,
    terms: [
      ['\\bSEI\\b|고체전해질 ?계면', 1.0],
      ['표면 ?처리|surface treatment', 0.9],
      ['계면|interfac(?:e|ial)', 0.8],
      ['도금|plating|박리|stripping', 0.7],
      ['열화|degradation|퇴화|수명 ?저하', 0.6],
      ['메커니즘|mechanism', 0.5],
    ],
  },
  {
    id: 'materials',
    label: '배터리 소재·전기화학 연구 연관성',
    weight: 15,
    terms: [
      ['전해질|electrolyte|첨가제|additive', 0.9],
      ['양극재|음극재|cathode|anode', 0.7],
      ['전기화학|electrochemi', 0.8],
      ['coin ?cell|파우치|셀 ?평가|충방전|cycling', 0.7],
      ['소재 ?개발|material development', 0.6],
    ],
  },
];

const REQ_WEIGHT = 15; // 자격요건(학위/경력/필수) 축

const compiledAxes = AXES.map((a) => ({
  ...a,
  terms: a.terms.map(([src, v]) => [new RegExp(src, 'i'), v]),
}));

/**
 * @param {object} job
 * @param {object} profile
 * @returns {{score:number, breakdown:object[], reasons:string[], gaps:string[], needs_check:string[]}}
 */
export function scoreJob(job, profile = DEFAULT_PROFILE) {
  const text = collectText(job);
  const breakdown = [];
  const reasons = [];
  const gaps = [];
  const needs_check = [];

  let total = 0;

  for (const axis of compiledAxes) {
    let best = 0;
    let count = 0;
    for (const [re, v] of axis.terms) {
      if (re.test(text)) {
        best = Math.max(best, v);
        count += 1;
      }
    }
    // 최고 매칭 강도 70% + 매칭 다양성 30% (개수만으로 부풀지 않게 상한)
    const breadth = Math.min(count / 3, 1);
    const ratio = best * 0.7 + breadth * 0.3 * (best > 0 ? 1 : 0);
    const got = Math.round(axis.weight * ratio * 10) / 10;
    total += got;
    breakdown.push({ id: axis.id, label: axis.label, got, max: axis.weight, matched: count });
  }

  // ── 자격요건 축 ────────────────────────────────
  const req = evaluateRequirements(job, profile);
  total += req.got;
  breakdown.push({ id: 'requirements', label: '학위·경력·필수자격', got: req.got, max: REQ_WEIGHT, matched: null });
  reasons.push(...req.reasons);
  gaps.push(...req.gaps);
  needs_check.push(...req.needs_check);

  // ── 사유 문장 생성 ────────────────────────────
  const byGot = [...breakdown].filter((b) => b.id !== 'requirements').sort((a, b) => b.got / b.max - a.got / a.max);
  const top = byGot[0];
  if (top && top.got / top.max >= 0.6) {
    reasons.unshift(`${top.label} 높음 — 프로필 핵심과 직접 겹침`);
  }
  const analysis = breakdown.find((b) => b.id === 'analysis');
  const lithium = breakdown.find((b) => b.id === 'lithium');
  if (lithium.got / lithium.max >= 0.7) reasons.unshift('리튬메탈 직접 연관 직무');
  if (analysis.got / analysis.max >= 0.7) reasons.unshift('XPS·표면 계면 분석 경험과 높은 연관성');

  const weak = byGot[byGot.length - 1];
  if (weak && weak.got === 0) gaps.push(`${weak.label} 근거를 공고에서 찾지 못함`);
  if (/생산|공정 ?운영|양산|설비 ?보전|현장/.test(text) && lithium.got < 8) {
    gaps.push('배터리 분야이지만 공정·생산 운영 비중이 높음');
  }

  const score = Math.max(0, Math.min(100, Math.round(total * req.multiplier)));

  return {
    score,
    breakdown,
    reasons: dedupe(reasons).slice(0, 4),
    gaps: dedupe(gaps).slice(0, 4),
    needs_check: dedupe(needs_check),
  };
}

function evaluateRequirements(job, profile) {
  const text = collectText(job);
  const reasons = [];
  const gaps = [];
  const needs_check = [];
  let got = 0;
  let multiplier = 1;

  // 경력 요구 연차 파싱
  const reqYears = job.experience_years_min ?? parseMinYears(text);
  const userYears = profile.experienceYears;

  if (job.experience === '신입' || job.experience === '인턴' || job.experience === '경력무관') {
    got += REQ_WEIGHT * 0.6;
    reasons.push(`${job.experience} 지원 가능 공고`);
  } else if (reqYears != null) {
    if (userYears == null) {
      got += REQ_WEIGHT * 0.25;
      needs_check.push(`경력 ${reqYears}년 이상 요구 — 내 경력 정보 미입력(설정에서 입력 필요)`);
      gaps.push(`경력 ${reqYears}년 이상이 필수이므로 신입 지원 적합도 낮을 수 있음`);
      multiplier = 0.8;
    } else if (userYears >= reqYears) {
      got += REQ_WEIGHT * 0.9;
      reasons.push(`요구 경력 ${reqYears}년 충족`);
    } else {
      got += REQ_WEIGHT * 0.1;
      gaps.push(`경력 ${reqYears}년 이상이 필수이므로 지원 적합도 낮음`);
      multiplier = 0.6;
    }
  } else {
    needs_check.push('경력 요건을 공고에서 파싱하지 못함 — 원문 확인 필요');
    got += REQ_WEIGHT * 0.3;
  }

  // 학위
  const needsPhd = /박사|\bPh\.?\s?D\b/i.test(text) && !/석사|박사 ?우대|박사 ?선호/.test(text);
  const needsMaster = /석사|\bM\.?S\.?\b/i.test(text);
  if (profile.degree == null && (needsPhd || needsMaster)) {
    needs_check.push('요구 학위 대비 내 학위 정보 미입력(설정에서 입력 필요)');
  } else if (profile.degree) {
    const rank = { bachelor: 1, master: 2, phd: 3 }[profile.degree] || 0;
    if (needsPhd && rank < 3) {
      gaps.push('박사 학위가 필수 요건으로 보임');
      multiplier = Math.min(multiplier, 0.7);
    } else if (needsMaster && rank >= 2) {
      reasons.push('요구 학위 충족');
    }
  }

  // 근무지
  if (profile.locations == null) {
    if (job.location) needs_check.push('희망 근무지 미입력 — 근무지 적합 여부 확인 필요');
  } else if (job.location && !profile.locations.some((l) => job.location.includes(l))) {
    gaps.push(`근무지(${job.location})가 희망 지역과 다름`);
  }

  if (job.overseas && profile.openToOverseas == null) {
    needs_check.push('해외 근무 공고 — 해외 근무 가능 여부 미입력');
  }

  return { got: Math.round(got * 10) / 10, reasons, gaps, needs_check, multiplier };
}

export function parseMinYears(text) {
  const m = text.match(/경력\s*(\d{1,2})\s*년\s*(?:이상|↑|\+)/) || text.match(/(\d{1,2})\s*년\s*이상\s*(?:경력|경험)/);
  if (m) return parseInt(m[1], 10);
  if (/경력\s*무관/.test(text)) return 0;
  return null;
}

function dedupe(arr) {
  return [...new Set(arr.filter(Boolean))];
}
