// collector/src/normalize.js
// 원문을 통째로 저장하지 않는다. 분류·검색·점수에 필요한 최소 필드만 남기고,
// 업무/자격/우대는 항목당 160자로 잘라 요약 보관한다. 항상 원문 링크를 함께 둔다.

import crypto from 'node:crypto';
import { parseMinYears } from '../../shared/score.js';

const MAX_ITEM = 160;
const MAX_ITEMS = 6;

export function normalize(raw, sourceId) {
  const title = clean(raw.title);
  const company = clean(raw.companyName);
  if (!title || !company) return null;

  const deadline = parseDeadline(raw.deadline);
  const always = /상시/.test(raw.deadlineText || '') || raw.alwaysOpen === true;
  const untilFilled = /채용\s*시\s*마감|충원\s*시/.test(raw.deadlineText || '');

  const detail = {
    summary: trimList(raw.summary),
    requirements: trimList(raw.requirements),
    preferred: trimList(raw.preferred),
  };

  const bag = [title, ...detail.summary, ...detail.requirements, ...detail.preferred].join(' ');

  return {
    id: makeId(company, title, raw.location),
    sample: false,
    status: 'active',
    company: { id: raw.companyId || null, name: company },
    title,
    experience: normExperience(raw.experienceText, bag),
    experience_years_min: raw.minYears ?? parseMinYears(bag),
    location: clean(raw.location) || null,
    overseas: isOverseas(raw.location),
    employment_type: clean(raw.employmentType) || null,
    posted_at: toDate(raw.postedAt) || todayKST(),
    deadline,
    always_open: always && !deadline,
    until_filled: untilFilled,
    source: raw.source || sourceId,
    source_url: raw.url || null,
    official_url: raw.officialUrl || null,
    checked_at: new Date().toISOString(),
    detail,
  };
}

export function makeId(company, title, location) {
  const key = [company, title, location || ''].map((s) => String(s).replace(/\s+/g, '').toLowerCase()).join('|');
  return crypto.createHash('sha1').update(key).digest('hex').slice(0, 16);
}

function clean(s) {
  return String(s ?? '').replace(/\s+/g, ' ').trim();
}

function trimList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr
    .map(clean)
    .filter(Boolean)
    .map((s) => (s.length > MAX_ITEM ? s.slice(0, MAX_ITEM - 1) + '…' : s))
    .slice(0, MAX_ITEMS);
}

function normExperience(text, bag) {
  const t = (text || '') + ' ' + bag;
  if (/인턴|체험형|채용전환형/.test(t)) return '인턴';
  if (/경력\s*무관|무관/.test(t)) return '경력무관';
  if (/신입/.test(t) && !/경력\s*\d+\s*년\s*이상/.test(t)) return '신입';
  if (/경력/.test(t)) return '경력';
  return '구분 미확인';
}

const KR_HINTS = ['서울', '경기', '인천', '대전', '대구', '부산', '울산', '광주', '충북', '충남', '전북', '전남', '경북', '경남', '강원', '제주', '세종', '오창', '청주', '천안', '아산', '구미', '포항', '군산', '화성', '수원', '용인', '성남', '증평'];

function isOverseas(loc) {
  const s = clean(loc);
  if (!s) return false;
  if (KR_HINTS.some((k) => s.includes(k))) return false;
  return /[A-Za-z]{3,}/.test(s) || /미국|중국|헝가리|폴란드|인도네시아|말레이시아|일본|유럽|캐나다|베트남/.test(s);
}

function parseDeadline(v) {
  if (!v) return null;
  const s = String(v).trim();
  const m = s.match(/(\d{4})[-./년\s]*(\d{1,2})[-./월\s]*(\d{1,2})/);
  if (!m) return null;
  const [, y, mo, d] = m;
  const hh = (s.match(/(\d{1,2}):(\d{2})/) || [null, '23', '59']).slice(1);
  const iso = `${y}-${pad(mo)}-${pad(d)}T${pad(hh[0])}:${pad(hh[1])}:00+09:00`;
  return Number.isNaN(Date.parse(iso)) ? null : iso;
}

function toDate(v) {
  if (!v) return null;
  const m = String(v).match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
  return m ? `${m[1]}-${pad(m[2])}-${pad(m[3])}` : null;
}

function pad(n) { return String(n).padStart(2, '0'); }
export function todayKST() { return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Seoul' }); }
