// collector/src/index.js
// 파이프라인: 수집 → 정규화 → 중복 병합 → 이전 스냅샷과 diff → 분류/점수 → 저장
// 실패해도 기존 data/*.json 은 절대 지우지 않는다. meta.json 에만 실패를 기록한다.

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectAll } from './sources/index.js';
import { dedupe, diffAgainstPrevious } from './dedupe.js';
import { classify } from '../../shared/classify.js';
import { scoreJob, DEFAULT_PROFILE } from '../../shared/score.js';
import { todayKST } from './normalize.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DATA = path.join(ROOT, 'data');
const DRY = process.argv.includes('--dry-run');
const today = todayKST();
const nowISO = new Date().toISOString();

main();

async function main() {
  const prevJobs = await readJson(path.join(DATA, 'jobs.json'), { jobs: [] });
  const prevMeta = await readJson(path.join(DATA, 'meta.json'), {});
  const previous = (prevJobs.jobs || []).filter((j) => !j.sample);

  let collected;
  try {
    collected = await collectAll();
  } catch (err) {
    await writeFailure(prevMeta, err);
    console.error('수집 전체 실패:', err.message);
    process.exit(0); // 워크플로를 실패로 만들지 않고 기존 데이터를 유지한다
  }

  const ok = collected.report.filter((r) => r.status === '정상');
  if (!collected.jobs.length) {
    await writeFailure(prevMeta, new Error(
      ok.length ? '소스는 응답했지만 공고를 하나도 추출하지 못했습니다' : '활성화된 수집 소스가 없습니다 (config.js 및 시크릿 확인)'
    ), collected.report);
    console.warn('수집 결과 0건 — 기존 데이터를 유지합니다.');
    console.table(collected.report);
    return;
  }

  const merged = dedupe(collected.jobs);
  const { added, changed, closed, all } = diffAgainstPrevious(merged, previous);

  const enriched = all.map((job) => {
    const cls = classify(job);
    const fit = scoreJob(job, DEFAULT_PROFILE); // 기본 프로필 기준. 브라우저에서 사용자 프로필로 재계산됨
    return { ...job, category: cls.category, categories: cls.categories, tags: cls.tags, fit };
  });

  const active = enriched.filter((j) => j.status !== 'closed');
  const meta = {
    last_run_at: nowISO,
    last_success_at: nowISO,
    run_status: 'ok',
    error: null,
    is_sample: false,
    counts: {
      new_today: added.length,
      active: active.length,
      closing_7d: active.filter((j) => within7(j.deadline)).length,
      archived: enriched.length - active.length,
      changed: changed.length,
      closed_detected: closed.filter((j) => j.closed_detected_at === today).length,
    },
    sources: collected.report,
  };

  if (DRY) {
    console.log('--dry-run: 파일을 쓰지 않습니다.');
    console.table(collected.report);
    console.log(`신규 ${added.length} / 변경 ${changed.length} / 마감 ${closed.length} / 활성 ${active.length}`);
    return;
  }

  await fs.mkdir(path.join(DATA, 'archive'), { recursive: true });
  await writeJson(path.join(DATA, 'jobs.json'), {
    _notice: '자동 수집 결과. 공고 본문은 복제하지 않으며 요약과 원문 링크만 보관합니다.',
    generated_at: nowISO,
    jobs: enriched,
  });
  await writeJson(path.join(DATA, 'meta.json'), meta);
  await writeJson(path.join(DATA, 'archive', `${today}.json`), {
    date: today, added: added.map(slim), changed: changed.map(slim), closed: closed.map(slim),
  });

  console.table(collected.report);
  console.log(`저장 완료 — 신규 ${added.length} / 변경 ${changed.length} / 마감 ${closed.length} / 활성 ${active.length}`);
}

function slim(j) {
  return { id: j.id, company: j.company?.name, title: j.title, deadline: j.deadline, url: j.official_url || j.source_url };
}

function within7(deadline) {
  if (!deadline) return false;
  const d = Math.ceil((Date.parse(deadline) - Date.now()) / 86400000);
  return d >= 0 && d <= 7;
}

async function writeFailure(prevMeta, err, report) {
  const meta = {
    ...prevMeta,
    last_run_at: nowISO,
    last_success_at: prevMeta.last_success_at ?? null,
    run_status: 'failed',
    error: String(err.message).slice(0, 300),
    sources: report || prevMeta.sources || [],
  };
  if (!DRY) await writeJson(path.join(DATA, 'meta.json'), meta);
}

async function readJson(p, fallback) {
  try { return JSON.parse(await fs.readFile(p, 'utf8')); } catch { return fallback; }
}

async function writeJson(p, obj) {
  await fs.writeFile(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}
