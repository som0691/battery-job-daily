// shared/classify.js
// 직무 카테고리 분류 + 기술 태그 추출. 브라우저와 Node collector가 함께 사용한다.
// 대표 카테고리는 하나만, 태그는 복수 허용.

export const CATEGORIES = {
  A: { id: 'A', label: '분석·특성평가', short: '분석' },
  B: { id: 'B', label: '리튬메탈 고적합', short: '리튬메탈' },
  C: { id: 'C', label: '기타 배터리', short: '기타' },
};

// 표기: [정규식소스, 표시태그, 가중치]
// 가중치는 "그 키워드 하나가 카테고리 적합성을 얼마나 강하게 시사하는가"
const A_TERMS = [
  ['\\bTEM\\b|투과전자현미경', 'TEM', 3],
  ['\\bSTEM\\b|주사투과', 'STEM', 3],
  ['\\bSEM\\b|주사전자현미경', 'SEM', 3],
  ['\\bFIB\\b|집속이온빔', 'FIB', 3],
  ['\\bXPS\\b|광전자분광', 'XPS', 3],
  ['ToF[- ]?SIMS|TOF[- ]?SIMS|비행시간형', 'ToF-SIMS', 3],
  ['\\bXRD\\b|엑스선회절|X-?선 ?회절', 'XRD', 2],
  ['\\bEDS\\b|\\bEDX\\b', 'EDS', 2],
  ['\\bEELS\\b', 'EELS', 2],
  ['라만|\\bRaman\\b', 'Raman', 2],
  ['FT-?IR|적외선분광', 'FT-IR', 2],
  ['\\bICP\\b|유도결합플라즈마', 'ICP', 2],
  ['\\bAFM\\b|원자간력', 'AFM', 2],
  ['\\bNMR\\b', 'NMR', 1],
  ['\\bBET\\b', 'BET', 1],
  ['표면 ?분석', '표면분석', 3],
  ['계면 ?분석', '계면분석', 3],
  ['미세 ?구조|미세조직', '미세구조', 2],
  ['소재 ?분석|재료 ?분석', '소재분석', 3],
  ['성분 ?분석', '성분분석', 2],
  ['불량 ?분석|고장 ?분석|failure analysis', '불량분석', 2],
  ['원인 ?분석', '원인분석', 1],
  ['분석 ?기술|analytical', '분석기술', 2],
  ['특성 ?평가|characteri[sz]ation', '특성평가', 2],
  ['전기화학 ?평가|electrochemical (?:evaluation|characteri)', '전기화학평가', 2],
];

const B_TERMS = [
  ['lithium ?metal|리튬 ?금속|Li ?metal', 'Lithium metal', 4],
  ['리튬 ?금속 ?음극|Li ?metal anode', '리튬금속 음극', 4],
  ['무음극|anode[- ]?free', '무음극', 4],
  ['전고체|all[- ]?solid[- ]?state|\\bASSB\\b', '전고체전지', 3],
  ['리튬 ?황|Li[- ]?S\\b|lithium[- ]?sulfur', '리튬황전지', 3],
  ['차세대 ?음극|차세대 ?전지|next[- ]?generation batter', '차세대전지', 2],
  ['\\bSEI\\b|고체전해질계면|solid electrolyte inter', 'SEI', 4],
  ['덴드라이트|dendrite', '덴드라이트', 4],
  ['표면 ?처리|surface treatment', '표면처리', 3],
  ['계면 ?제어|interfac(?:e|ial) (?:control|engineering)|계면 ?설계', '계면제어', 3],
  ['전해질|electrolyte', '전해질', 2],
  ['첨가제|additive', '첨가제', 2],
  ['도금|plating|박리|stripping', 'plating/stripping', 3],
  ['메커니즘|mechanism', '메커니즘 분석', 1],
  ['실리콘 ?음극|\\bSi ?anode', 'Si 음극', 2],
  ['\\bLi[- ]?ion transport|이온 ?전도', '이온전도', 1],
];

const C_TERMS = [
  ['양극재|cathode', '양극재', 2],
  ['음극재|anode material', '음극재', 2],
  ['분리막|separator', '분리막', 2],
  ['바인더|binder', '바인더', 1],
  ['집전체|current collector', '집전체', 1],
  ['셀 ?설계|cell design', '셀설계', 2],
  ['공정 ?기술|process engineering', '공정기술', 2],
  ['생산 ?기술|생산 ?운영', '생산기술', 2],
  ['품질|quality', '품질', 1],
  ['안전성|safety|열폭주|thermal runaway', '안전성', 2],
  ['시뮬레이션|simulation|모델링|modeling|\\bDFT\\b|\\bMD\\b', '시뮬레이션', 2],
  ['리사이클|재활용|recycl', '리사이클링', 2],
  ['전극 ?공정|코팅|믹싱|조립|활성화|화성', '전극공정', 2],
  ['장비 ?개발|설비 ?개발|equipment', '장비개발', 1],
  ['\\bBMS\\b|팩|모듈|\\bpack\\b', '팩/모듈', 1],
  ['\\bESS\\b', 'ESS', 1],
];

const GROUPS = [
  ['A', A_TERMS],
  ['B', B_TERMS],
  ['C', C_TERMS],
];

const compiled = GROUPS.map(([id, terms]) => [
  id,
  terms.map(([src, tag, w]) => [new RegExp(src, 'i'), tag, w]),
]);

/**
 * @param {object} job  { title, detail:{summary,requirements,preferred}, tagsRaw }
 * @returns {{category:'A'|'B'|'C', categories:string[], tags:string[], hits:object}}
 */
export function classify(job) {
  const text = collectText(job);
  const scores = { A: 0, B: 0, C: 0 };
  const tags = [];
  const hits = { A: [], B: [], C: [] };

  for (const [id, terms] of compiled) {
    for (const [re, tag, w] of terms) {
      if (re.test(text)) {
        scores[id] += w;
        hits[id].push(tag);
        if (!tags.includes(tag)) tags.push(tag);
      }
    }
  }

  // 대표 카테고리: 최고 점수. 동점이면 B > A > C
  // (B는 "고적합" 카테고리라 놓치는 비용이 더 크다)
  const order = ['B', 'A', 'C'];
  let category = 'C';
  let best = -1;
  for (const id of order) {
    if (scores[id] > best) {
      best = scores[id];
      category = id;
    }
  }
  // A/B 어느 쪽도 유의미하지 않으면 C로 강등
  if (best < 3) category = 'C';

  const categories = order.filter((id) => scores[id] >= 3);
  if (!categories.includes(category)) categories.unshift(category);

  return { category, categories, tags: tags.slice(0, 12), hits, scores };
}

export function collectText(job) {
  const d = job.detail || {};
  return [
    job.title,
    job.company && job.company.name,
    job.employment_type,
    ...(d.summary || []),
    ...(d.requirements || []),
    ...(d.preferred || []),
    ...(job.tagsRaw || []),
    job.raw_text || '',
  ]
    .filter(Boolean)
    .join('\n');
}
