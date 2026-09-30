"""Shared design system for wooofpay trade documents (발주서/견적서/거래명세서).

Architecture, per doc-style-ref.png and docs/erp reference material:

  compute_layout(item_count, info_rows, notes_rows)  -- the ONE place that
                                   maps every dynamic section to a row
                                   number. Nothing else in this module (or
                                   the three CLI scripts) hardcodes a row
                                   offset.
  apply_template(ws, ...)      -- "template" phase: draws every static
                                   piece of chrome (borders, fills, column
                                   widths, section labels, table header,
                                   footer labels) but writes NO transaction
                                   data.
  write_values(ws, ...)        -- "data" phase: writes the actual values
                                   and formulas into the cells the template
                                   phase laid out, then widens/heightens
                                   whatever cells the actual content needs
                                   more room than the static defaults give.

A doc-type's shape (which info-block fields it shows, its title, its
closing verb) is declared once in DOC_CONFIGS and read by both phases, so
발주서/견적서/거래명세서 share one code path and one look.

No logo: real content is free-text and unpredictable in length (item
names, specs, notes, delivery-place lines, addresses), so every section
that holds free text sizes itself to what was actually written rather
than assuming a fixed line count -- a cramped fixed box just moves the
"where did the text get clipped" problem from column width to row height.
"""

from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter

# ---------------------------------------------------------------------------
# Style constants (colors, fonts, borders) -- shared by all three documents.
# ---------------------------------------------------------------------------

FONT_NAME = "맑은 고딕"

CHARCOAL = "4D4D4D"        # table header / notes label bar background
CHARCOAL_TEXT = "FFFFFF"
LABEL_GRAY = "808080"      # info-block field labels
BORDER_GRAY = "BFBFBF"     # thin hairline borders throughout
AMOUNT_TINT = "DCE6F1"     # light-blue band over the amount column
TOTAL_TINT = "DCE6F1"      # grand-total row / amount-in-words bar

_THIN = Side(style="thin", color=BORDER_GRAY)
BORDER_THIN_BOTTOM = Border(bottom=_THIN)
BORDER_THIN_RIGHT = Border(right=_THIN)
BORDER_BOX = Border(top=_THIN, bottom=_THIN, left=_THIN, right=_THIN)
BORDER_TOP_BOTTOM = Border(top=_THIN, bottom=_THIN)

FONT_ISSUER_NAME = Font(name=FONT_NAME, size=15, bold=True)
FONT_TITLE = Font(name=FONT_NAME, size=24, bold=True)
FONT_DOC_NO = Font(name=FONT_NAME, size=8, color=LABEL_GRAY)
FONT_SECTION_LABEL = Font(name=FONT_NAME, size=9, bold=True)
FONT_FIELD_LABEL = Font(name=FONT_NAME, size=9, color=LABEL_GRAY)
FONT_FIELD_VALUE = Font(name=FONT_NAME, size=9)
FONT_FIELD_VALUE_BOLD = Font(name=FONT_NAME, size=9, bold=True)
FONT_TABLE_HEADER = Font(name=FONT_NAME, size=9, bold=True, color=CHARCOAL_TEXT)
FONT_TABLE_CELL = Font(name=FONT_NAME, size=9)
FONT_NOTES_LABEL = Font(name=FONT_NAME, size=9, bold=True, color=CHARCOAL_TEXT)
FONT_NOTES_BODY = Font(name=FONT_NAME, size=9)
FONT_TOTAL_LABEL = Font(name=FONT_NAME, size=9)
FONT_TOTAL_VALUE = Font(name=FONT_NAME, size=9)
FONT_GRAND_TOTAL_LABEL = Font(name=FONT_NAME, size=10, bold=True)
FONT_GRAND_TOTAL_VALUE = Font(name=FONT_NAME, size=10, bold=True)
FONT_WORDS_BAR = Font(name=FONT_NAME, size=9, bold=True)
FONT_CLOSING = Font(name=FONT_NAME, size=10)

FILL_CHARCOAL = PatternFill("solid", fgColor=CHARCOAL)
FILL_AMOUNT_TINT = PatternFill("solid", fgColor=AMOUNT_TINT)
FILL_TOTAL_TINT = PatternFill("solid", fgColor=TOTAL_TINT)

CENTER = Alignment(horizontal="center", vertical="center", wrap_text=True)
LEFT = Alignment(horizontal="left", vertical="center")
LEFT_WRAP = Alignment(horizontal="left", vertical="center", wrap_text=True)
RIGHT = Alignment(horizontal="right", vertical="center")
LEFT_TOP = Alignment(horizontal="left", vertical="top", wrap_text=True)

MONEY_FMT = "#,##0;;\"-\""
QTY_FMT = "#,##0;;\"-\""

# 7-column item table shared by every document: 순번·품목명·규격·수량·단위·단가·공급가액.
TABLE_HEADERS = ["순번", "품목명", "규격", "수량", "단위", "단가", "공급가액"]
# Column A doubles as the item-table's 순번 column AND the left info-block's
# field-label column ("사업자번호"/"유효기간"/"거래일자" are 5 Hangul glyphs
# wide); column D doubles as the item-table's 수량 column AND the right
# info-block's field-label column -- both must be sized for the label use.
COLUMN_WIDTHS = [10, 27, 10, 10, 8, 12, 14]
DEFAULT_ITEM_ROWS = 10

# ---------------------------------------------------------------------------
# Per-document configuration. This is the only place doc-type differences
# (title, closing verb, which info-block fields to show) are declared.
# Field keys are dotted paths into the `spec` dict the CLI script builds;
# a script may add derived keys to `spec` (e.g. a combined contact line)
# before calling render() -- see purchase_order_excel.py.
# ---------------------------------------------------------------------------

DOC_CONFIGS = {
    "purchase_order": {
        "title": "발  주  서",
        "left_label": "수신 To",
        "right_label": "발주처 Provider",
        "left_fields": [
            ("수신", "partner.displayName"),
            ("사업자번호", "partner.businessNumber"),
            ("대표자", "partner.representativeName"),
            ("주소", "partner.address"),
            ("담당자", "partner.contactLine"),
            # 담당자 개인 이메일(contactLine)과는 별개로, 거래처의 세금계산서
            # 발행 메일(invoiceEmail)을 보여준다 -- 발행자가 아니라 이 거래처
            # 자신이 세금계산서를 발행/수신할 때 쓰는 주소다.
            ("이메일", "partner.invoiceEmail"),
            ("발주일", "orderDate"),
        ],
        "right_fields": [
            ("사업자번호", "issuer.businessNumber"),
            ("상호", "issuer.businessName"),
            ("대표자", "issuer.representativeName"),
            ("주소", "issuer.address"),
            # 거래처 쪽 이메일(왼쪽 블록)과는 별개 필드다 -- 이쪽은 우리
            # 발행자가 세금계산서를 받을 때 쓰는 주소.
            ("이메일", "issuer.invoiceEmail"),
            ("계좌", "issuer.bankInfo"),
        ],
        "closing": "위와 같이 발주합니다.",
        "extra_note_label": "납품장소",
        "extra_note_key": "deliveryPlaceLine",
    },
    "quote": {
        "title": "견  적  서",
        "left_label": "수신 To",
        "right_label": "공급자 Provider",
        "left_fields": [
            ("수신", "partner.displayName"),
            ("담당자", "partner.contactLine"),
            ("견적일", "quoteDate"),
            ("유효기간", "validUntil"),
        ],
        "right_fields": [
            ("사업자번호", "issuer.businessNumber"),
            ("상호", "issuer.businessName"),
            ("대표자", "issuer.representativeName"),
            ("담당자", "issuer.contactLine"),
            ("참조", "reference"),
        ],
        "closing": "위와 같이 견적합니다.",
        "extra_note_label": None,
        "extra_note_key": None,
    },
    "statement": {
        "title": "거래명세서",
        "left_label": "수신 To",
        "right_label": "공급자 Provider",
        "left_fields": [
            ("수신", "partner.displayName"),
            ("담당자", "partner.contactLine"),
            ("거래일자", "transactionDate"),
        ],
        "right_fields": [
            ("사업자번호", "issuer.businessNumber"),
            ("상호", "issuer.businessName"),
            ("대표자", "issuer.representativeName"),
            ("계좌", "issuer.bankInfo"),
        ],
        "closing": "위와 같이 청구합니다.",
        "extra_note_label": None,
        "extra_note_key": None,
    },
}

# ---------------------------------------------------------------------------
# Korean amount-in-words ("일금 ○○○원 정"). Pure function, no Excel formula.
# ---------------------------------------------------------------------------

_DIGITS = ["", "일", "이", "삼", "사", "오", "육", "칠", "팔", "구"]
_SMALL_UNITS = ["", "십", "백", "천"]
_BIG_UNITS = ["", "만", "억", "조", "경"]


def _four_digit_chunk(n):
    """Render 0-9999 using standard Korean numeral reading (일십/일백/일천
    are contracted to 십/백/천, matching normal Korean usage)."""
    if n == 0:
        return ""
    out = []
    digits = [int(d) for d in f"{n:04d}"]  # [천의자리, 백의자리, 십의자리, 일의자리]
    for i, d in enumerate(digits):
        unit = _SMALL_UNITS[3 - i]
        if d == 0:
            continue
        if d == 1 and unit:
            out.append(unit)
        else:
            out.append(_DIGITS[d] + unit)
    return "".join(out)


def korean_won_words(amount):
    """Convert a non-negative integer won amount to Korean numeral words,
    e.g. 1600500 -> '백육십만오백'. Returns '영' for 0."""
    n = int(round(amount))
    if n == 0:
        return "영"
    if n < 0:
        raise ValueError("korean_won_words expects a non-negative amount")
    groups = []
    remaining = n
    while remaining > 0:
        groups.append(remaining % 10000)
        remaining //= 10000
    parts = []
    for i in range(len(groups) - 1, -1, -1):
        chunk = groups[i]
        if chunk == 0:
            continue
        parts.append(_four_digit_chunk(chunk) + _BIG_UNITS[i])
    return "".join(parts)


def amount_in_words_line(amount):
    return f"(일금 {korean_won_words(amount)}원 정)"


# ---------------------------------------------------------------------------
# Text-fit helpers: every free-text section (info-block values, item name /
# spec, notes) sizes its row height to what the actual content needs,
# instead of assuming a fixed number of lines. Undershooting clips text in
# the printed/PDF output; overshooting only costs a little whitespace -- so
# these deliberately round up.
# ---------------------------------------------------------------------------

def _chars_per_line(width_units):
    """Rough glyph capacity of one wrapped line in a column whose Excel
    width is `width_units`. wooofpay trade documents are Hangul-heavy, and
    a full-width Hangul glyph takes roughly 1.8x the horizontal space a
    width-unit is calibrated against (a Latin/digit character) -- so this
    assumes the pessimistic (all-Hangul) case rather than a mixed-content
    average, which is what keeps this a safe *minimum* line count."""
    return max(1, int(max(width_units - 1, 1) / 1.8))


def _wrapped_line_count(text, width_units):
    """How many lines `text` needs when wrapped in a column of the given
    width, respecting any literal newlines already in the text (e.g. a
    multi-bullet note)."""
    text = str(text or "")
    if not text:
        return 0
    capacity = _chars_per_line(width_units)
    total = 0
    for segment in text.split("\n"):
        total += max(1, -(-len(segment) // capacity))  # ceil division
    return total


def _row_height_for_lines(lines, line_pt=15, min_pt=15):
    return max(min_pt, lines * line_pt)


def _numeric_width_for(max_value, base_width, padding=2):
    """A number column stays at its stylistic default width until the
    actual data would overflow it (Excel renders an overflowing numeric
    cell as `###...`, unlike text which just clips silently) -- then it
    grows just enough to fit the widest formatted value."""
    try:
        magnitude = abs(int(round(float(max_value))))
    except (TypeError, ValueError):
        magnitude = 0
    digits = len(f"{magnitude:,}") if magnitude else 1
    return max(base_width, digits + padding)


def _notes_lines(cfg, spec):
    """Build the Notes-box text as a list of logical lines: the doc type's
    extra note (e.g. PO's 납품장소) first, then the free-form note field."""
    lines = []
    if cfg.get("extra_note_label"):
        extra_value = _get(spec, cfg["extra_note_key"])
        if extra_value:
            lines.append(f"{cfg['extra_note_label']}: {extra_value}")
    if spec.get("note"):
        lines.append(str(spec["note"]))
    return lines


# ---------------------------------------------------------------------------
# Layout: the single source of truth for row numbers.
# ---------------------------------------------------------------------------

class Layout:
    def __init__(self, item_count):
        self.item_count = max(item_count, DEFAULT_ITEM_ROWS)

        # doc_no (row 1, F:G) and title (rows 2-5, D:G) must never share a
        # row in columns D-G, or their merges overlap and openpyxl raises.
        # issuer_name spans the same row range as both (rows 1-5) but stays
        # in columns A-C, so there is no column overlap either.
        self.doc_no_row = 1
        self.issuer_name_row_start = 1
        self.issuer_name_row_end = 5
        self.title_row_start = 2
        self.title_row_end = 5

        self.section_label_row = 7
        self.info_row_start = 8
        # info block height = tallest of the two field lists, computed by
        # the caller (needs DOC_CONFIGS) and passed in via `info_rows`.
        self.info_rows = 0  # set by compute_layout()
        self.info_row_end = 0

        self.table_header_row = 0
        self.table_first_data_row = 0
        self.table_last_data_row = 0

        self.footer_row_start = 0  # Notes box / totals block start
        self.notes_label_row = 0
        self.notes_body_row_start = 0
        self.notes_body_row_end = 0
        self.total_supply_row = 0
        self.total_vat_row = 0
        self.total_grand_row = 0
        self.words_bar_row = 0
        self.closing_row = 0
        self.last_row = 0


def compute_layout(item_count, info_rows, notes_rows=3):
    """The single place that maps every section of a trade document to a
    row number. `info_rows` is max(len(left_fields), len(right_fields));
    `notes_rows` is how many grid rows the Notes box body needs to hold
    its actual (already wrapped) text without clipping it -- both
    computed by the caller before this runs, since they depend on the
    content, not just the document type."""
    layout = Layout(item_count)
    layout.info_rows = max(info_rows, 1)
    layout.info_row_end = layout.info_row_start + layout.info_rows - 1

    layout.table_header_row = layout.info_row_end + 2
    layout.table_first_data_row = layout.table_header_row + 1
    layout.table_last_data_row = layout.table_first_data_row + layout.item_count - 1

    footer_body_rows = max(3, notes_rows)
    layout.footer_row_start = layout.table_last_data_row + 1
    layout.notes_label_row = layout.footer_row_start
    layout.notes_body_row_start = layout.notes_label_row + 1
    layout.notes_body_row_end = layout.notes_body_row_start + footer_body_rows - 1

    layout.total_supply_row = layout.footer_row_start
    layout.total_vat_row = layout.total_supply_row + 1
    layout.total_grand_row = layout.total_vat_row + 1

    layout.words_bar_row = max(layout.notes_body_row_end, layout.total_grand_row) + 1
    layout.closing_row = layout.words_bar_row + 1
    layout.last_row = layout.closing_row
    return layout


# ---------------------------------------------------------------------------
# Template phase: static chrome only, no transaction data.
# ---------------------------------------------------------------------------

def _merge(ws, r1, c1, r2, c2):
    ws.merge_cells(start_row=r1, start_column=c1, end_row=r2, end_column=c2)


def apply_template(ws, doc_type, layout, issuer):
    cfg = DOC_CONFIGS[doc_type]
    ws.sheet_view.showGridLines = False
    ws.page_setup.orientation = "portrait"
    ws.page_setup.paperSize = ws.PAPERSIZE_A4
    ws.page_setup.fitToWidth = 1
    ws.page_setup.fitToHeight = 0
    ws.sheet_properties.pageSetUpPr.fitToPage = True
    ws.page_margins.left = 0.4
    ws.page_margins.right = 0.4
    ws.page_margins.top = 0.5
    ws.page_margins.bottom = 0.5
    ws.print_area = f"A1:G{layout.last_row}"

    for idx, width in enumerate(COLUMN_WIDTHS, start=1):
        ws.column_dimensions[get_column_letter(idx)].width = width

    # --- issuer name (top-left, where a logo would sit) ------------------
    # No logo: it would need re-uploading per issuing entity and most
    # small vendors don't have print-ready art on hand. The issuing
    # company's name carries the same "who sent this" role in plain text.
    _merge(ws, layout.issuer_name_row_start, 1, layout.issuer_name_row_end, 3)
    issuer_name_cell = ws.cell(row=layout.issuer_name_row_start, column=1,
                                value=issuer.get("businessName", ""))
    issuer_name_cell.font = FONT_ISSUER_NAME
    issuer_name_cell.alignment = Alignment(horizontal="left", vertical="center", wrap_text=True)

    # --- doc number + title (top-right) -------------------------------
    _merge(ws, layout.doc_no_row, 6, layout.doc_no_row, 7)
    doc_no_cell = ws.cell(row=layout.doc_no_row, column=6)
    doc_no_cell.font = FONT_DOC_NO
    doc_no_cell.alignment = RIGHT

    _merge(ws, layout.title_row_start, 4, layout.title_row_end, 7)
    title_cell = ws.cell(row=layout.title_row_start, column=4, value=cfg["title"])
    title_cell.font = FONT_TITLE
    title_cell.alignment = Alignment(horizontal="right", vertical="center")

    # --- info block section labels + divider ---------------------------
    left_label_cell = ws.cell(row=layout.section_label_row, column=1, value=cfg["left_label"])
    left_label_cell.font = FONT_SECTION_LABEL
    left_label_cell.border = BORDER_THIN_BOTTOM
    _merge(ws, layout.section_label_row, 1, layout.section_label_row, 2)
    ws.cell(row=layout.section_label_row, column=2).border = BORDER_THIN_BOTTOM

    right_label_cell = ws.cell(row=layout.section_label_row, column=4, value=cfg["right_label"])
    right_label_cell.font = FONT_SECTION_LABEL
    right_label_cell.border = BORDER_THIN_BOTTOM
    _merge(ws, layout.section_label_row, 4, layout.section_label_row, 5)
    ws.cell(row=layout.section_label_row, column=5).border = BORDER_THIN_BOTTOM

    for offset, (label, _key) in enumerate(cfg["left_fields"]):
        r = layout.info_row_start + offset
        lc = ws.cell(row=r, column=1, value=label)
        lc.font = FONT_FIELD_LABEL
        lc.alignment = LEFT
        ws.cell(row=r, column=2).alignment = LEFT_WRAP
        ws.cell(row=r, column=3).border = BORDER_THIN_RIGHT  # vertical divider

    for offset, (label, _key) in enumerate(cfg["right_fields"]):
        r = layout.info_row_start + offset
        lc = ws.cell(row=r, column=4, value=label)
        lc.font = FONT_FIELD_LABEL
        lc.alignment = LEFT
        # merge E:G for the value -- a single narrow table column (E, sized
        # for 단위) is nowhere near wide enough for a business name/address.
        _merge(ws, r, 5, r, 7)
        ws.cell(row=r, column=5).alignment = LEFT_WRAP

    # divider continues down through any rows left blank on the shorter side.
    # Row heights are set per-row in write_values() once the actual field
    # values (and how many lines they need) are known.
    for r in range(layout.info_row_start, layout.info_row_end + 1):
        ws.cell(row=r, column=3).border = BORDER_THIN_RIGHT

    # --- item table header ----------------------------------------------
    for ci, header in enumerate(TABLE_HEADERS, start=1):
        c = ws.cell(row=layout.table_header_row, column=ci, value=header)
        c.font = FONT_TABLE_HEADER
        c.fill = FILL_CHARCOAL
        c.alignment = CENTER

    for r in range(layout.table_first_data_row, layout.table_last_data_row + 1):
        for ci in range(1, 8):
            cell = ws.cell(row=r, column=ci)
            cell.font = FONT_TABLE_CELL
            cell.border = BORDER_THIN_BOTTOM
            if ci in (6, 7):
                cell.alignment = RIGHT
            elif ci in (1, 4, 5):
                cell.alignment = CENTER
            else:  # 2 품목명, 3 규격 -- free text, must wrap or it clips
                cell.alignment = LEFT_WRAP
        ws.cell(row=r, column=7).fill = FILL_AMOUNT_TINT
        ws.cell(row=r, column=7).number_format = MONEY_FMT
        ws.cell(row=r, column=6).number_format = MONEY_FMT
        ws.cell(row=r, column=4).number_format = QTY_FMT

    # --- notes box (bottom-left) -----------------------------------------
    _merge(ws, layout.notes_label_row, 1, layout.notes_label_row, 3)
    notes_label = ws.cell(row=layout.notes_label_row, column=1, value="Notes")
    notes_label.font = FONT_NOTES_LABEL
    notes_label.fill = FILL_CHARCOAL
    notes_label.alignment = Alignment(horizontal="left", vertical="center", indent=1)
    ws.cell(row=layout.notes_label_row, column=2).fill = FILL_CHARCOAL
    ws.cell(row=layout.notes_label_row, column=3).fill = FILL_CHARCOAL

    _merge(ws, layout.notes_body_row_start, 1, layout.notes_body_row_end, 3)
    notes_body = ws.cell(row=layout.notes_body_row_start, column=1)
    notes_body.font = FONT_NOTES_BODY
    notes_body.alignment = LEFT_TOP
    notes_body.border = BORDER_BOX

    # --- totals block (bottom-right) -------------------------------------
    for label_row, label_text, value_font, label_font, fill in (
        (layout.total_supply_row, "총 공급가액", FONT_TOTAL_VALUE, FONT_TOTAL_LABEL, None),
        (layout.total_vat_row, "총 부가세", FONT_TOTAL_VALUE, FONT_TOTAL_LABEL, None),
        (layout.total_grand_row, "총 합계금액", FONT_GRAND_TOTAL_VALUE, FONT_GRAND_TOTAL_LABEL, FILL_TOTAL_TINT),
    ):
        _merge(ws, label_row, 4, label_row, 5)
        lc = ws.cell(row=label_row, column=4, value=label_text)
        lc.font = label_font
        lc.alignment = CENTER
        lc.border = BORDER_BOX
        _merge(ws, label_row, 6, label_row, 7)
        vc = ws.cell(row=label_row, column=6)
        vc.font = value_font
        vc.alignment = RIGHT
        vc.number_format = MONEY_FMT
        vc.border = BORDER_BOX
        if fill:
            lc.fill = fill
            vc.fill = fill

    # --- amount-in-words bar ------------------------------------------
    _merge(ws, layout.words_bar_row, 1, layout.words_bar_row, 7)
    words_cell = ws.cell(row=layout.words_bar_row, column=1)
    words_cell.font = FONT_WORDS_BAR
    words_cell.alignment = CENTER
    words_cell.fill = FILL_TOTAL_TINT

    # --- closing sentence -----------------------------------------------
    _merge(ws, layout.closing_row, 1, layout.closing_row, 7)
    closing_cell = ws.cell(row=layout.closing_row, column=1, value=cfg["closing"])
    closing_cell.font = FONT_CLOSING
    closing_cell.alignment = CENTER


# ---------------------------------------------------------------------------
# Data phase: writes the transaction values/formulas the template reserved,
# then grows whatever row/column the actual content needs more room than
# the static defaults provide.
# ---------------------------------------------------------------------------

def _get(spec, dotted_key):
    """spec['issuer']['businessNumber'] via 'issuer.businessNumber'."""
    node = spec
    for part in dotted_key.split("."):
        if node is None:
            return ""
        node = node.get(part) if isinstance(node, dict) else None
    return node if node is not None else ""


def write_values(ws, doc_type, layout, spec):
    """Writes every value/formula, then sizes rows/columns to fit what was
    actually written. Returns the grand total (int won) so the caller can
    spell it out in the amount-in-words bar."""
    cfg = DOC_CONFIGS[doc_type]

    ws.cell(row=layout.doc_no_row, column=6, value=spec.get("docNo", ""))

    left_value_width = COLUMN_WIDTHS[1]
    right_value_width = sum(COLUMN_WIDTHS[4:7])
    line_counts = {}

    for offset, (_label, key) in enumerate(cfg["left_fields"]):
        r = layout.info_row_start + offset
        value = _get(spec, key)
        cell = ws.cell(row=r, column=2, value=value)
        cell.font = FONT_FIELD_VALUE_BOLD if key == "partner.displayName" else FONT_FIELD_VALUE
        line_counts[r] = max(line_counts.get(r, 0), _wrapped_line_count(value, left_value_width))

    for offset, (_label, key) in enumerate(cfg["right_fields"]):
        r = layout.info_row_start + offset
        value = _get(spec, key)
        cell = ws.cell(row=r, column=5, value=value)
        cell.font = FONT_FIELD_VALUE_BOLD if key == "issuer.businessName" else FONT_FIELD_VALUE
        line_counts[r] = max(line_counts.get(r, 0), _wrapped_line_count(value, right_value_width))

    for r in range(layout.info_row_start, layout.info_row_end + 1):
        ws.row_dimensions[r].height = _row_height_for_lines(max(line_counts.get(r, 0), 1))

    items = spec.get("lineItems", [])
    subtotal = 0
    max_unit_price = 0
    max_quantity = 0
    max_line_total = 0
    for i in range(layout.item_count):
        r = layout.table_first_data_row + i
        if i >= len(items):
            continue
        item = items[i]
        name_val = item.get("itemName", "")
        spec_val = item.get("spec", "")
        quantity = item.get("quantity") or 0
        unit_price = item.get("unitPrice") or 0
        line_total = round(quantity * unit_price)
        subtotal += line_total
        max_unit_price = max(max_unit_price, unit_price)
        max_quantity = max(max_quantity, quantity)
        max_line_total = max(max_line_total, line_total)

        ws.cell(row=r, column=1, value=i + 1)
        ws.cell(row=r, column=2, value=name_val)
        ws.cell(row=r, column=3, value=spec_val)
        ws.cell(row=r, column=4, value=quantity)
        ws.cell(row=r, column=5, value=item.get("unit", ""))
        ws.cell(row=r, column=6, value=unit_price)
        # line total is a formula, never a stored number, so editing qty/price
        # in Excel recalculates it live.
        ws.cell(row=r, column=7, value=f"=D{r}*F{r}")

        lines = max(
            _wrapped_line_count(name_val, COLUMN_WIDTHS[1]),
            _wrapped_line_count(spec_val, COLUMN_WIDTHS[2]),
            1,
        )
        if lines > 1:
            ws.row_dimensions[r].height = _row_height_for_lines(lines)

    vat = round(subtotal * 0.1)
    grand_total = subtotal + vat

    supply_range = f"G{layout.table_first_data_row}:G{layout.table_last_data_row}"
    ws.cell(row=layout.total_supply_row, column=6, value=f"=SUM({supply_range})")
    ws.cell(row=layout.total_vat_row, column=6,
            value=f"=ROUND(F{layout.total_supply_row}*0.1,0)")
    ws.cell(row=layout.total_grand_row, column=6,
            value=f"=F{layout.total_supply_row}+F{layout.total_vat_row}")

    # A formula cell renders as "###..." exactly like a literal number does
    # when its column is too narrow -- widen 단가/공급가액 (and 수량, for a
    # very large order) if the real data needs more room than the default.
    qty_width = _numeric_width_for(max_quantity, COLUMN_WIDTHS[3], padding=1)
    price_width = _numeric_width_for(max_unit_price, COLUMN_WIDTHS[5])
    amount_width = _numeric_width_for(max(max_line_total, grand_total), COLUMN_WIDTHS[6])
    for col_idx, width in ((4, qty_width), (6, price_width), (7, amount_width)):
        letter = get_column_letter(col_idx)
        if width > ws.column_dimensions[letter].width:
            ws.column_dimensions[letter].width = width

    notes_lines = _notes_lines(cfg, spec)
    ws.cell(row=layout.notes_body_row_start, column=1, value="\n".join(notes_lines))
    # amount-in-words bar is written by render() -- Excel has no function to
    # spell a number out in Korean, so the caller writes the pre-computed
    # words string once render() has this return value.

    return grand_total


def render(ws, doc_type, spec):
    """Full pipeline: size the layout to the actual content, draw the
    template, write the values. `spec` must already contain resolved
    issuer/partner dicts and lineItems (plus any derived fields the doc
    type's DOC_CONFIGS entry references -- see the CLI script for each
    doc type)."""
    cfg = DOC_CONFIGS[doc_type]
    info_rows = max(len(cfg["left_fields"]), len(cfg["right_fields"]))
    notes_box_width = sum(COLUMN_WIDTHS[0:3])
    notes_rows = max(3, _wrapped_line_count("\n".join(_notes_lines(cfg, spec)), notes_box_width))

    layout = compute_layout(len(spec.get("lineItems", [])), info_rows, notes_rows)
    apply_template(ws, doc_type, layout, spec.get("issuer", {}))
    grand_total = write_values(ws, doc_type, layout, spec)
    # amount-in-words must be a literal string (Excel can't spell numbers in
    # Korean), computed here now that the actual grand total is known.
    ws.cell(row=layout.words_bar_row, column=1, value=amount_in_words_line(grand_total))
    return layout
