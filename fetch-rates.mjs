// 이자 높은 예금·적금 리스트 수집 — 금융감독원 금융상품통합비교공시(finlife) 오픈API
// 실행: FSS_KEY=<32자리 인증키> node fetch-rates.mjs  → rates.json 생성
// 배포: GitHub Actions가 매일 아침 실행해 budget_update 레포 rates.json 갱신(.github/workflows/update-rates.yml),
//       앱은 raw CDN에서 하루 1회 내려받기만 한다(유저 데이터 전송 없음 — "연동 제로" 해자 유지).
// v2 (2026-07-18, 사용자 요청): 우대조건 원문·조건 태그·가입방법·은행 홈페이지 URL 포함, 상위 30(은행당 1개 유지)
// 정본: 볼트 [[가계부-분류-현행사양]] v1.21 절

const KEY = process.env.FSS_KEY;
if (!KEY) { console.error('FSS_KEY 환경변수 필요 (finlife.fss.or.kr 인증키)'); process.exit(1); }

const BASE = 'http://finlife.fss.or.kr/finlifeapi';
const GRPS = [['020000', '은행'], ['030300', '저축은행']];

// 우대조건 원문 → 결정적 키워드 태그 (앱 필터 칩의 재료 — 분류 불가분은 '기타조건')
const COND_TAGS = [
  ['급여이체', /급여|급여이체|월급/],
  // 제휴카드 = 특정 카드사·카드명 발급/사용 조건 (실사고 2026-07-18: "롯데카드 결제계좌 지정"·"LOCA LIKIT 카드 이용실적"이
  // 구 카드실적 정규식에 안 걸림 — 카드사 실명 + 영문 카드명 + '제휴카드' 표현을 잡는다)
  ['제휴카드', /(롯데|신한|삼성|현대|국민|하나|우리|농협|비씨|BC|KB|IBK|NH)\s*카드|[A-Za-z]{2,}(\s+[A-Za-z]+)*\s*카드|제휴\s*카드/],
  // 카드실적 — '카드'와 실적어 사이 낱말 허용("카드 누적 이용실적")
  ['카드실적', /카드[^\n]{0,12}?(사용|실적|이용|결제|납부)|체크카드|신용카드/],
  ['첫거래', /첫\s*거래|신규\s*(고객|가입)|최초/],
  ['비대면가입', /비대면|모바일|인터넷|앱\s*(가입|을)|스마트폰/],
  ['자동이체', /자동\s*이체|자동납부/],
  ['마케팅동의', /마케팅|광고\s*수신|정보\s*수신\s*동의/],
  ['연령조건', /만\s*\d+\s*세|청년|시니어|어르신/],
  ['연금수급', /연금/],
  ['예치·재예치', /재예치|예치금|목돈/],
];
function tagCond(s) {
  const t = String(s ?? '').trim();
  if (!t || /해당\s*사항?\s*없|없음/.test(t)) return [];
  const tags = COND_TAGS.filter(([, re]) => re.test(t)).map(([k]) => k);
  return tags.length ? tags : ['기타조건'];
}

// 금융회사 홈페이지 URL 맵 (companySearch — 같은 권역 페이지 순회)
async function companyMap() {
  const map = {};
  for (const [grp] of GRPS) {
    for (let page = 1; page <= 3; page++) {
      const j = await (await fetch(`${BASE}/companySearch.json?auth=${KEY}&topFinGrpNo=${grp}&pageNo=${page}`)).json();
      const r = j?.result;
      if (!r?.baseList?.length) break;
      for (const b of r.baseList) if (b.homp_url) map[b.fin_co_no] = String(b.homp_url).trim();
      if (+(r.max_page_no ?? 1) <= page) break;
    }
  }
  return map;
}

async function grab(kind, homp) {
  const rows = [];
  for (const [grp, grpNm] of GRPS) {
    for (let page = 1; page <= 4; page++) {
      const url = `${BASE}/${kind}.json?auth=${KEY}&topFinGrpNo=${grp}&pageNo=${page}`;
      const j = await (await fetch(url)).json();
      const r = j?.result;
      if (r?.err_cd && r.err_cd !== '000') throw new Error(`finlife ${r.err_cd}: ${r.err_msg}`);
      if (!r?.baseList?.length) break;
      const opts = r.optionList ?? [];
      for (const b of r.baseList) {
        const os = opts.filter(o => o.fin_prdt_cd === b.fin_prdt_cd && o.fin_co_no === b.fin_co_no);
        const best = [...os.filter(o => +o.save_trm === 12), ...os]
          .sort((a, c) => (+c.intr_rate2 || 0) - (+a.intr_rate2 || 0))[0];
        if (best && +best.intr_rate2 > 0) rows.push({
          권역: grpNm, 은행: b.kor_co_nm, 상품: b.fin_prdt_nm,
          기간: +best.save_trm, 기본: +best.intr_rate || 0, 최고: +best.intr_rate2 || 0,
          조건태그: tagCond(b.spcl_cnd),
          우대조건: String(b.spcl_cnd ?? '').trim().slice(0, 500),
          가입: String(b.join_way ?? '').trim(),
          홈피: homp[b.fin_co_no] ?? '',
        });
      }
      if (+(r.max_page_no ?? 1) <= page) break;
    }
  }
  // 최고 우대금리순, 은행당 1개(다양성), 상위 30 (앱이 조건 필터 후에도 10개를 채울 풀)
  const seen = new Set(); const top = [];
  for (const p of rows.sort((a, b) => b.최고 - a.최고)) {
    if (seen.has(p.은행)) continue;
    seen.add(p.은행); top.push(p);
    if (top.length >= 30) break;
  }
  return top;
}

const homp = await companyMap();
const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const out = {
  updated: kst,
  스키마: 3, // 태그 체계 버전 — 앱이 이 값으로 캐시 갱신 판단 (v3: 제휴카드 태그·카드실적 확장)
  source: '금융감독원 금융상품통합비교공시',
  예금: await grab('depositProductsSearch', homp),
  적금: await grab('savingProductsSearch', homp),
};
if (!out.예금.length && !out.적금.length) throw new Error('수집 결과 0건 — API 응답 구조 확인 필요');
const fs = await import('node:fs');
fs.writeFileSync(new URL('./rates.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`rates.json — 예금 ${out.예금.length} · 적금 ${out.적금.length} · 홈피 ${Object.keys(homp).length}사 · ${kst}`);
