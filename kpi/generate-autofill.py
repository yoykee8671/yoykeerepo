#!/usr/bin/env python3
"""Generate kpi-autofill.js from autofill-raw.json (clobe bank-transaction aggregates).

Usage: python3 generate-autofill.py
Reads:  kpi/autofill-raw.json  (produced by the clobe harvest step)
Writes: kpi/kpi-autofill.js    (loaded by kpi.html; defines window.KPI_AUTOFILL)

Mapping policy (mixed mode):
- Revenue channel keys (label:*/entity:*/desc:*) map to KPI rows via CHANNEL_MAP.
- Unmapped revenue keys accumulate into a "미분류(자동)" row so totals stay correct.
- Company-wide costs (ad/logi/cogs/fee/refund) go into a "공통비용(자동)" row of the
  wooof unit because bank data cannot split costs per channel.
- Amounts are settlement deposits (실입금) → filled into the 순매출 column with the
  fee column left empty, matching the sheet's own guidance for settlement-only data.
"""
import json
import os

BASE = os.path.dirname(os.path.abspath(__file__))
RAW = os.path.join(BASE, 'autofill-raw.json')
OUT = os.path.join(BASE, 'kpi-autofill.js')

# channelKey → (unit, row name). Built from the actual 2026 1~7월 key inventory.
# Labeling is inconsistent over time (same real channel appears as label:/entity:/desc:),
# so multiple keys merge into one KPI row. unit: 'wooof' | 'PBbrand' | 'picky'
CHANNEL_MAP = {
    # ── 자사몰 (카페24 PG: 다날·페이코·카카오페이) ──
    'label:매출(카페24)': ('wooof', '자사몰(카페24)'),
    'entity:다날': ('wooof', '자사몰(카페24)'),
    'entity:엔에이치엔페이코': ('wooof', '자사몰(카페24)'),
    # ── PB: 네이버 스마트스토어/Npay (자사 제작생산 제품 판매처) ──
    'entity:네이버파이낸셜': ('PBbrand', '스마트스토어/네이버'),
    'label:매출(스마트스토어)': ('PBbrand', '스마트스토어/네이버'),
    # ── PB: 쿠팡 (로켓/마켓플레이스/쿠팡페이) ──
    'label:쿠팡(로켓)': ('PBbrand', '쿠팡'),
    'entity:쿠팡': ('PBbrand', '쿠팡'),
    'entity:쿠팡페이': ('PBbrand', '쿠팡'),
    # ── PB: 컬리 (컬리페이·더즌) ──
    'entity:주식회사 컬리페이': ('PBbrand', '컬리'),
    'label:컬리': ('PBbrand', '컬리'),
    'entity:(주)더즌': ('PBbrand', '컬리'),
    # ── PB: 외부채널 위탁몰 (백화점·몰·펫샵·선물하기 등 — PB브랜드의 외부채널 매출, DESIGN.md §8) ──
    'entity:몰리스펫샵 스타필드하남점': ('PBbrand', '외부채널 위탁몰'),
    'label:몰리스펫샵(이마트)': ('PBbrand', '외부채널 위탁몰'),
    'label:29cm': ('PBbrand', '외부채널 위탁몰'),
    'label:현대M몰': ('PBbrand', '외부채널 위탁몰'),
    'entity:롯데쇼핑e커머스사업본부': ('PBbrand', '외부채널 위탁몰'),
    'entity:(주)무신사페이먼츠': ('PBbrand', '외부채널 위탁몰'),
    'entity:펫프렌즈': ('PBbrand', '외부채널 위탁몰'),
    'entity:더블유컨셉코리아': ('PBbrand', '외부채널 위탁몰'),
    'label:W컨셉샵': ('PBbrand', '외부채널 위탁몰'),
    'entity:신세계인터내셔날': ('PBbrand', '외부채널 위탁몰'),
    'desc:신세계인터내셔': ('PBbrand', '외부채널 위탁몰'),
    'label:오늘의집': ('PBbrand', '외부채널 위탁몰'),
    'entity:버킷플레이스': ('PBbrand', '외부채널 위탁몰'),
    'label:카카오선물하기': ('PBbrand', '외부채널 위탁몰'),
    'entity:카카오': ('PBbrand', '외부채널 위탁몰'),
    'label:딱펫': ('PBbrand', '외부채널 위탁몰'),
    'label:펀엔씨(강아지대통령)': ('PBbrand', '외부채널 위탁몰'),
    'entity:(주)텐바이텐': ('PBbrand', '외부채널 위탁몰'),
    'label:BMW하모니': ('PBbrand', '외부채널 위탁몰'),
    'label:오버더센스': ('PBbrand', '외부채널 위탁몰'),
    'entity:오버더센스': ('PBbrand', '외부채널 위탁몰'),
    # 리드메이트코리아(철수마켓) = 공구 플랫폼 정산 입금 (매입장 "공구 수수료" 거래처와 동일)
    'entity:리드메이트코리아': ('PBbrand', '공구'),
    "entity:생강이네(Ginger's": ('PBbrand', '외부채널 위탁몰'),
    'entity:제제(ZEZE)': ('PBbrand', '외부채널 위탁몰'),
    # ── 우프(입점): 위탁 브랜드 정산 (매출장 "위탁 판매분" 패턴 확인 — 테일릿·몽슈슈·엘피네트웍스) ──
    'entity:테일릿(TAILIT)': ('wooof', '입점브랜드 위탁'),
    'entity:몽슈슈(MONCHOUCHOU Co.,Ltd.)': ('wooof', '입점브랜드 위탁'),
    'entity:엘피네트웍스': ('wooof', '입점브랜드 위탁'),
    # ── B2B/도매/벤더 (사업자몰·대리점·거래처 펫샵) ──
    'label:사업자몰(B2B)': ('wooof', 'B2B/도매/벤더'),
    'label:대리점/벤더매출': ('wooof', 'B2B/도매/벤더'),
    'entity:제이엔씨': ('wooof', 'B2B/도매/벤더'),
    'entity:독클래스': ('wooof', 'B2B/도매/벤더'),
    'entity:복댕이들의옷장': ('wooof', 'B2B/도매/벤더'),
    'entity:꾸순네': ('wooof', 'B2B/도매/벤더'),
    'entity:소일베이커': ('wooof', 'B2B/도매/벤더'),
    'entity:댕버랜드': ('wooof', 'B2B/도매/벤더'),
    'entity:두더지식물원': ('wooof', 'B2B/도매/벤더'),
    'entity:개구쟁이': ('wooof', 'B2B/도매/벤더'),
    'entity:반애': ('wooof', 'B2B/도매/벤더'),
    'entity:댕댕존': ('wooof', 'B2B/도매/벤더'),
    'entity:댕스기빙데이': ('wooof', 'B2B/도매/벤더'),
    'entity:더힐동물의료센터': ('wooof', 'B2B/도매/벤더'),
    'desc:철수마켓1월정산': ('PBbrand', '공구'),
    # ── 서비스용역 — KPI 제외 (DESIGN.md §1) ──
    'entity:모이(MOi)': ('exclude', '서비스용역'),
    'label:서비스/외주용역': ('exclude', '서비스용역'),
    # ── 픽키파크 대행료(월 2.2M 고정): 외주용역, 회생변제 재원 적립 — KPI 제외 (DESIGN.md §8)
    #    단, 대행료가 아닌 픽키파크 입금(예: 3월 629,802)은 필바이츠 NPB 위탁판매 수수료 매출
    #    → resolve_channel()에서 금액/월 기준으로 분기 처리 (매출장 "위탁판매 수수료" 패턴 근거)
    'label:픽키파크대행': ('exclude', '픽키파크 대행(외주용역·회생재원)'),
    # ── 마켓/행사·팝업 ──
    'label:마켓/행사 매출': ('wooof', '마켓/행사·팝업'),
    # ── 베럴즈 (우프컴퍼니 계좌에는 거의 없음 — 별도 법인) ──
    'label:PB매출': ('PBbrand', '자사몰 (PG)'),
    'label:별도(공구매출)': ('PBbrand', '공구'),
    # ── 픽키도기 (KPI 별도 입력칸) ──
    'label:픽키도기클럽매출': ('picky', None),
}


def resolve_channel(key, month):
    """Exact map first, then heuristics; None → 미분류(자동)."""
    # 픽키파크 입금 분기: 1월 17.6M=양수도금(제외), 그 외 entity:픽키파크 입금은
    # 필바이츠 NPB 위탁판매 수수료 매출 (대행료 2.2M 고정분은 label:픽키파크대행 키로 별도 제외됨)
    if key == 'entity:픽키파크':
        if month == '1':
            return ('exclude', '기타(양수도금)')
        return ('PBbrand', '필바이츠')
    hit = CHANNEL_MAP.get(key)
    if hit:
        return hit
    if key.startswith('desc:쿠팡페이'):
        return ('PBbrand', '쿠팡')
    # card-company settlements (팝업/행사 카드매출 정산)
    if key.startswith('entity:') and '카드' in key:
        return ('wooof', '마켓/행사·팝업')
    # remaining desc:* are person-name direct deposits (무통장입금 등)
    if key.startswith('desc:'):
        return ('wooof', '직접입금(개인/기타)')
    return None

COMMON_COST_ROW = '공통비용(자동)'
UNMAPPED_ROW = '미분류(자동)'

# ── 자사몰(카페24) 분리: "선매입·위탁 판매 월말 정산" 구글시트 (2026-07-23 대표 공유) ──
# total = 위탁+선매입+빠른정산 판매액(소비자 결제 기준), gonggamcat = 그중 공감캣(NPB 위탁) 판매액
# 주의: 판매월 기준이라 은행 실입금(정산월)과 시차 있음. 7월 시트 없음 → 7월은 분리 안 함.
JASAMOL_SHEET = {
    '1': {'total': 10569175, 'gonggamcat': 1396000},
    '2': {'total': 6471700, 'gonggamcat': 1396000},
    '3': {'total': 6918105, 'gonggamcat': 698000},
    '4': {'total': 4325530, 'gonggamcat': 513100},
    '5': {'total': 4991690, 'gonggamcat': 698000},
    '6': {'total': 5096005, 'gonggamcat': 0},
}
JASAMOL_ROW = '자사몰(카페24)'
COSTS_JSON = os.path.join(BASE, 'costs-monthly.json')


def add_field(entries, name, field, amount):
    """month_entry 리스트에서 name 행을 찾아 field에 amount를 더한다 (없으면 행 생성)."""
    for e in entries:
        if e['name'] == name:
            e[field] = e.get(field, 0) + round(amount)
            return
    entries.append({'name': name, field: round(amount)})


def allocate_costs(month_entry, m, warns):
    """매입장(costs-monthly.json) 월별 패턴 집계로 원가를 유닛 행에 배분.
    공통비용(자동) cogs에서 같은 금액을 차감해 총계를 보존한다 (커버리지: 4~6월)."""
    try:
        cost_split = json.load(open(COSTS_JSON))['months']
    except (OSError, ValueError):
        return
    mj = cost_split.get(m)
    if not mj:
        return
    ipjeom = mj.get('witak', 0) + mj.get('seonmaeip', 0)
    if ipjeom:
        add_field(month_entry['wooof'], '자사몰 입점(위탁·선매입)', 'cogs', ipjeom)
    if mj.get('pb_jache'):
        add_field(month_entry['PBbrand'], 'PB 생산원가(자동)', 'cogs', mj['pb_jache'])
    if mj.get('doton'):
        add_field(month_entry['PBbrand'], '도톤(NPB) 원가(자동)', 'cogs', mj['doton'])
    if mj.get('gonggu_fee'):
        add_field(month_entry['PBbrand'], '공구', 'fee', mj['gonggu_fee'])
    allocated = ipjeom + mj.get('pb_jache', 0) + mj.get('doton', 0) + mj.get('gonggu_fee', 0)
    for e in month_entry['PBbrand']:
        if e['name'] == COMMON_COST_ROW:
            remain = round(e.get('cogs', 0) - allocated)
            if remain < 0:
                warns.append(f'{m}월 원가배분: 매입장 배분액({allocated:,.0f})이 clobe 원가({e.get("cogs", 0):,.0f})를 '
                             f'초과 (발생주의 vs 현금주의 차이) — 공통 cogs 0으로 클램프')
                remain = 0
            e['cogs'] = remain
            return
    # 공통비용 행이 없는 달(비용 0)은 그대로 두되 기록
    warns.append(f'{m}월 원가배분: 공통비용(자동) 행이 없어 차감 생략 (배분액 {allocated:,.0f})')


def split_jasamol(rows, month):
    """카페24 실입금을 입점(위탁·선매입)/공감캣/PB 몫으로 분리. 반환: 경고 문자열 목록."""
    warns = []
    sheet = JASAMOL_SHEET.get(month)
    bank = rows['wooof'].pop(JASAMOL_ROW, 0)
    if not bank:
        return warns
    if not sheet:
        rows['wooof'][JASAMOL_ROW] = bank  # 시트 없음(7월 등) → 분리 없이 유지
        return warns
    ipjeom = sheet['total'] - sheet['gonggamcat']
    pb = bank - sheet['total']
    if pb < 0:
        warns.append(f"{month}월 카페24: 시트 판매액({sheet['total']:,})이 은행 실입금({bank:,})보다 큼 "
                     f"(차액 {-pb:,} — 판매월/정산월 시차). PB 몫은 0으로 처리")
        pb = 0
    rows['wooof']['자사몰 입점(위탁·선매입)'] = rows['wooof'].get('자사몰 입점(위탁·선매입)', 0) + ipjeom
    if sheet['gonggamcat']:
        rows['PBbrand']['공감캣'] = rows['PBbrand'].get('공감캣', 0) + sheet['gonggamcat']
    if pb:
        rows['PBbrand']['자사몰 (PG)'] = rows['PBbrand'].get('자사몰 (PG)', 0) + pb
    return warns


def main():
    raw = json.load(open(RAW))
    months_out = {}
    unmapped_report = {}
    excluded_report = {}
    split_warns = []

    for m, md in raw['months'].items():
        rows = {'wooof': {}, 'PBbrand': {}}
        picky = 0
        for key, agg in md.get('revenue', {}).items():
            amt = round(agg['sum'])
            if amt == 0:
                continue
            target = resolve_channel(key, m)
            if target is None:
                rows['wooof'][UNMAPPED_ROW] = rows['wooof'].get(UNMAPPED_ROW, 0) + amt
                unmapped_report.setdefault(key, 0)
                unmapped_report[key] += amt
                continue
            unit, row = target
            if unit == 'picky':
                picky += amt
            elif unit == 'exclude':
                # 서비스용역 — KPI 공헌이익에서 제외, 리포트로만 노출
                excluded_report.setdefault(m, {}).setdefault(row, 0)
                excluded_report[m][row] += amt
            else:
                rows[unit][row] = rows[unit].get(row, 0) + amt

        for w in split_jasamol(rows, m):
            split_warns.append(w)

        month_entry = {'wooof': [], 'PBbrand': []}
        for unit in ('wooof', 'PBbrand'):
            for name, amt in rows[unit].items():
                month_entry[unit].append({'name': name, 'net': amt})

        c = md.get('costs', {})
        common = {'name': COMMON_COST_ROW}
        if c.get('cogs'):
            common['cogs'] = round(c['cogs'])
        logi = (c.get('logi') or 0) + (c.get('storage') or 0)
        if logi:
            common['logi'] = round(logi)
        if c.get('fee'):
            common['fee'] = round(c['fee'])
        if c.get('refund'):
            common['ret'] = round(c['refund'])
        if c.get('ad'):
            common['ad'] = round(c['ad'])
        if len(common) > 1:
            month_entry['PBbrand'].append(common)

        allocate_costs(month_entry, m, split_warns)

        if picky:
            month_entry['picky'] = picky
        months_out[m] = month_entry

    payload = {
        'generatedAt': raw.get('generatedAt', ''),
        'source': 'clobe 은행거래 (우프컴퍼니 실입금 기준)',
        'months': months_out,
    }
    with open(OUT, 'w') as f:
        f.write('/* Auto-generated by generate-autofill.py — do not edit by hand. */\n')
        f.write('window.KPI_AUTOFILL = ')
        json.dump(payload, f, ensure_ascii=False, indent=2)
        f.write(';\n')

    print(f'wrote {OUT}')
    if unmapped_report:
        print('\n[unmapped channel keys → 미분류(자동)]')
        for k, v in sorted(unmapped_report.items(), key=lambda x: -x[1]):
            print(f'  {k}: {v:,.0f}')
    if excluded_report:
        print('\n[KPI 제외 (서비스용역)]')
        for m in sorted(excluded_report, key=int):
            for row, v in excluded_report[m].items():
                print(f'  {m}월 {row}: {v:,.0f}')
    if split_warns:
        print('\n[자사몰(카페24) 분리 경고]')
        for w in split_warns:
            print(f'  ⚠ {w}')


if __name__ == '__main__':
    main()
