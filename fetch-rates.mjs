// 이자 높은 예금·적금 리스트 수집 — 금융감독원 금융상품통합비교공시(finlife) 오픈API
// 실행: FSS_KEY=<32자리 인증키> node fetch-rates.mjs  → rates.json 생성
// 배포: GitHub Actions가 매일 아침 실행해 budget_update 레포 rates.json 갱신(.github/workflows/update-rates.yml),
//       앱은 raw CDN에서 하루 1회 내려받기만 한다(유저 데이터 전송 없음 — "연동 제로" 해자 유지).
// 정본: 볼트 [[가계부-분류-현행사양]] v1.18 절

const KEY = process.env.FSS_KEY;
if (!KEY) { console.error('FSS_KEY 환경변수 필요 (finlife.fss.or.kr 인증키)'); process.exit(1); }

const BASE = 'http://finlife.fss.or.kr/finlifeapi';
const GRPS = [['020000', '은행'], ['030300', '저축은행']];

async function grab(kind) {
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
        // 12개월 옵션 우선, 없으면 최고 우대금리 옵션
        const best = [...os.filter(o => +o.save_trm === 12), ...os]
          .sort((a, c) => (+c.intr_rate2 || 0) - (+a.intr_rate2 || 0))[0];
        if (best && +best.intr_rate2 > 0) rows.push({
          권역: grpNm, 은행: b.kor_co_nm, 상품: b.fin_prdt_nm,
          기간: +best.save_trm, 기본: +best.intr_rate || 0, 최고: +best.intr_rate2 || 0,
        });
      }
      if (+(r.max_page_no ?? 1) <= page) break;
    }
  }
  // 최고 우대금리순 정렬, 은행당 1개(다양성), 상위 10
  const seen = new Set(); const top = [];
  for (const p of rows.sort((a, b) => b.최고 - a.최고)) {
    if (seen.has(p.은행)) continue;
    seen.add(p.은행); top.push(p);
    if (top.length >= 10) break;
  }
  return top;
}

const kst = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const out = {
  updated: kst,
  source: '금융감독원 금융상품통합비교공시',
  예금: await grab('depositProductsSearch'),
  적금: await grab('savingProductsSearch'),
};
if (!out.예금.length && !out.적금.length) throw new Error('수집 결과 0건 — API 응답 구조 확인 필요');
const fs = await import('node:fs');
fs.writeFileSync(new URL('./rates.json', import.meta.url), JSON.stringify(out, null, 2));
console.log(`rates.json — 예금 ${out.예금.length} · 적금 ${out.적금.length} · ${kst}`);
