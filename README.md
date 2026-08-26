# Battery Job Daily

배터리 셀·소재·분석장비·리사이클링 등 배터리 생태계 전반의 채용공고를 매일 수집해 **직무 카테고리**와 **내 프로필 적합도** 기준으로 정리하는 정적 사이트.

- 프론트엔드: 빌드 없음. 순수 HTML + CSS + ES module. GitHub Pages에 그대로 올라간다.
- 수집기: Node 20 스크립트. GitHub Actions가 매일 KST 07:00에 실행하고 `data/*.json`만 커밋한다.
- 분류·점수 로직(`shared/`)은 **브라우저와 수집기가 같은 파일을 공유**한다. 설정 화면에서 프로필을 바꾸면 브라우저가 같은 로직으로 즉시 재계산한다.

---

## 1. 빠른 시작

```bash
# 정적 서버로 열기 (file:// 로 열면 fetch가 CORS에 막힌다)
python3 -m http.server 8080
# → http://localhost:8080

# 수집기 실행
cd collector
npm install
cp ../.env.example .env      # 값 채우기
npm run collect:dry          # 파일 안 쓰고 결과만 확인
npm run collect              # data/*.json 갱신
```

## 2. 디렉터리

| 경로 | 역할 |
|---|---|
| `index.html` | 페이지 골격 |
| `assets/css/styles.css` | 라이트/다크 토큰, 반응형, 마감 SOC 게이지 |
| `assets/js/app.js` | 렌더링, 필터, 검색, 상태 관리(localStorage) |
| `shared/classify.js` | 직무 카테고리 A/B/C 분류 + 기술 태그 추출 |
| `shared/score.js` | 0~100 적합도. 미입력 프로필 항목은 '확인 필요' 처리 |
| `collector/src/index.js` | 수집 → 정규화 → 중복병합 → diff → 저장 파이프라인 |
| `collector/src/http.js` | robots.txt 준수 + 호스트별 요청 간격 제어 |
| `collector/src/sources/` | 소스 어댑터 (공공/플랫폼 API, 기업 공식 채용페이지) |
| `data/jobs.json` | 활성 + 마감 공고 스냅샷 |
| `data/meta.json` | 마지막 성공/실패 시각, 소스별 상태 |
| `data/archive/YYYY-MM-DD.json` | 날짜별 신규·변경·마감 기록 |

## 3. 배포

1. 저장소를 만들고 이 폴더를 그대로 푸시한다.
2. **Settings → Pages → Source: GitHub Actions** 로 설정.
3. **Settings → Secrets and variables → Actions** 에 아래를 등록 (필요한 것만).

| Secret | 용도 |
|---|---|
| `WORKNET_ENDPOINT` / `WORKNET_SERVICE_KEY` | 고용24(워크넷) 채용정보 API |
| `SARAMIN_ENDPOINT` / `SARAMIN_ACCESS_KEY` | 사람인 오픈 API |

키는 절대 프론트엔드 코드에 넣지 않는다. 정적 사이트라 그대로 노출된다.

4. **Actions → Daily collect → Run workflow** 로 수동 실행. `dry_run` 체크박스로 파일을 쓰지 않고 결과만 볼 수 있다.

이후 매일 22:00 UTC(= KST 07:00)에 자동 실행된다. GitHub Actions의 cron은 정시 보장이 아니라 수 분~수십 분 지연될 수 있다.

## 4. 수집 소스를 켜기 전에 반드시 할 일

`collector/src/config.js` 의 소스는 전부 **`verified: false`** 로 시작한다. 엔드포인트와 파라미터명을 이 저장소에서 검증하지 않았기 때문이다. 그대로 두면 수집기는 그 소스를 건너뛰고 `meta.json` 에 `미검증`으로 기록한다.

켜는 순서:

1. 해당 API 문서에서 엔드포인트, 파라미터명, **이용약관·호출 한도**를 확인한다.
2. `mapApiItem()` 의 필드 후보에 실제 응답 필드명을 추가한다.
3. `verified: true` 로 바꾼다.
4. `npm run collect:dry` 로 건수와 필드 매핑을 확인한 뒤 실제 실행한다.

기업 공식 채용페이지(`CAREER_SITES`)도 마찬가지로 `selectors` 가 `null` 이면 건너뛴다. 대부분의 대기업 채용 페이지는 클라이언트 렌더링이라 정적 HTML 파싱이 안 되므로, 페이지가 내부적으로 호출하는 목록 API를 확인해 그쪽을 쓰는 편이 안정적이다.

## 5. 적합도 점수 구조

| 축 | 배점 | 판정 근거 |
|---|---|---|
| 리튬메탈·차세대전지 연관성 | 25 | lithium metal, 무음극, 전고체, 리튬황, 덴드라이트 |
| 분석기술 연관성 | 25 | XPS, TEM/STEM, SEM, FIB, ToF-SIMS, XRD 등 |
| 표면처리·계면·SEI·메커니즘 | 20 | SEI, 표면처리, 계면, plating/stripping, 열화 |
| 배터리 소재·전기화학 | 15 | 전해질, 첨가제, 양·음극재, 셀 평가 |
| 학위·경력·필수자격 | 15 | 요구 연차 파싱 + 학위 요건 대조 |

- 키워드 **개수**만으로 점수가 오르지 않는다. 축마다 `최고 매칭 강도 70% + 매칭 다양성 30%`로 계산하고 다양성에는 상한을 둔다.
- 요구 경력 미달 시 총점에 배수 감점(0.6), 경력 정보 미입력 시 0.8을 적용한다.
- **입력하지 않은 학력·경력·기술은 충족으로 가정하지 않는다.** 대신 `확인 필요` 항목으로 상세 패널에 노출된다.

## 6. 화면 규칙

- 최상위 탭: `A. 분석·특성평가` / `B. 리튬메탈 고적합` / `C. 기타 배터리`. 한 공고는 여러 태그를 갖되 목록에는 대표 카테고리 한 곳에만 나온다. 동점이면 B → A → C 순으로 대표를 정한다.
- 카드 왼쪽 세로 막대는 **마감까지 남은 시간의 잔량 게이지**다. D-3 이하 빨강 / D-7 이하 주황 / D-14 이하 노랑 / 그 이상 기본색, 당일 마감은 깜빡임(`prefers-reduced-motion` 존중).
- 마감된 공고는 활성 목록에서 빠지고 보기 선택에서 **마감 공고 보관함**으로 이동한다.
- 기본 화면은 신입·인턴·경력무관만 보여준다. 필터 칩을 끄면 경력직도 나온다.
- 관심/지원 예정/지원 완료/숨김 상태는 브라우저 `localStorage`에만 저장된다. 서버로 전송되지 않으며 기기 간 동기화도 되지 않는다.

## 7. 접근성

- 모든 조작 요소가 키보드로 접근 가능하고 `:focus-visible` 링이 보인다.
- 탭·필터는 `role`/`aria-selected`/`aria-pressed`로 상태를 노출한다.
- 마감 임박은 색뿐 아니라 `D-3` 같은 텍스트로도 구분된다.
- 본문 바로가기 링크, `prefers-reduced-motion`, `prefers-color-scheme` 초기값을 지원한다.

## 8. 알려진 한계

`DATA_NOTICE.md` 에 정리했다. 요약하면 — 소스 어댑터를 직접 검증해 켜기 전까지는 **샘플 데이터만 보인다**.
