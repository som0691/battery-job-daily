// collector/src/config.js
//
// ⚠ 중요: 아래 API 엔드포인트와 파라미터명은 이 저장소에서 자동 검증되지 않았다.
//    각 제공처 문서에서 확인한 뒤 verified: true 로 바꾸고 사용할 것.
//    verified: false 인 소스는 기본적으로 건너뛰며 meta.json 에 '미검증'으로 기록된다.
//    (SKIP_VERIFY=1 환경변수로 강제 실행 가능)

export const QUERIES = [
  '이차전지', '배터리', '리튬', '전지 소재', '양극재', '음극재', '전해질', '분리막',
  '전고체', '리튬메탈', '표면분석', '소재분석', '전자현미경', '배터리 재활용',
];

export const SOURCES = [
  {
    id: 'worknet',
    name: '고용24(워크넷) 채용정보 API',
    kind: 'public_api',
    enabled: true,
    verified: false, // ← data.go.kr 활용신청 후 문서에서 엔드포인트/파라미터 확인 필요
    endpoint: process.env.WORKNET_ENDPOINT || '',
    keyEnv: 'WORKNET_SERVICE_KEY',
    note: '공공데이터포털에서 활용신청 후 WORKNET_ENDPOINT, WORKNET_SERVICE_KEY 설정',
  },
  {
    id: 'saramin',
    name: '사람인 오픈 API',
    kind: 'platform_api',
    enabled: true,
    verified: false, // ← 사람인 개발자센터에서 엔드포인트/파라미터/이용약관 확인 필요
    endpoint: process.env.SARAMIN_ENDPOINT || '',
    keyEnv: 'SARAMIN_ACCESS_KEY',
    note: '공식 오픈 API만 사용한다. 웹 페이지 크롤링은 이용약관 위반 소지가 있어 사용하지 않음',
  },
];

// 기업 공식 채용페이지 어댑터.
// selector 는 실제 페이지 구조를 열어보고 채워야 한다. 비어 있으면 자동으로 건너뛴다.
export const CAREER_SITES = [
  {
    companyId: 'lges',
    name: 'LG에너지솔루션',
    listUrl: 'https://www.lgensol.com/kr/career-recruit',
    // 이 페이지는 클라이언트 렌더링이라 정적 파싱이 안 될 수 있다. 확인 후 selector 를 채우거나
    // careers.lg.com 의 목록 API 를 대신 사용할 것.
    selectors: null,
  },
  {
    companyId: 'skon',
    name: 'SK온',
    listUrl: 'https://www.skcareers.com/Recruit',
    selectors: null,
  },
  {
    companyId: 'samsungsdi',
    name: '삼성SDI',
    listUrl: 'https://www.samsungcareers.com/',
    selectors: null,
  },
];

export const LIMITS = {
  requestDelayMs: 1500, // 동일 호스트 요청 간 최소 간격
  maxPagesPerSource: 5,
  timeoutMs: 20000,
  userAgent: 'BatteryJobDailyBot/0.1 (personal job tracker; contact via repository issues)',
};
