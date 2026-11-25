import os
import re
from typing import Optional
import fitz  # PyMuPDF


SECTOR_KEYWORD_RULES: list[tuple[str, tuple[str, ...]]] = [
    ("Works & Housing", ("works", "housing", "urban development", "highway", "road", "bridge", "ferma")),
    ("Power & Energy", ("power", "energy", "electricity", "transmission", "rural electrification", "solar", "petroleum", "gas")),
    ("Health & Social Welfare", ("health", "medical", "hospital", "clinic", "nhis", "nphcda", "nafdac", "disease")),
    ("Education", ("education", "university", "polytechnic", "college", "school", "ubec", "tetfund", "scholarship", "nysc")),
    ("Defence & Security", ("defence", "defense", "army", "navy", "air force", "police", "interior", "immigration", "prisons", "correctional", "nsdc", "nscdc", "security", "nsa")),
    ("Agriculture & Water", ("agriculture", "food", "water resources", "irrigation", "river basin", "dam", "borehole", "fisheries", "livestock")),
    ("Transport & Aviation", ("transport", "aviation", "railway", "rail", "maritime", "ports", "airport", "marine", "blue economy")),
    ("ICT & Science", ("science", "technology", "innovation", "communications", "digital", "nitda", "ict", "space")),
    ("Finance & Economy", ("finance", "budget", "economic planning", "revenue", "customs", "firs", "trade", "industry", "investment", "cbn")),
    ("Justice & Legislature", ("justice", "judiciary", "court", "national assembly", "senate", "house of representatives", "inec", "code of conduct")),
]

ROLLUP_TITLE_KEYWORDS = (
    "EXPENDITURE", "MAIN ENVELOP", "PERSONNEL COST", "OVERHEAD COST",
    "SALARIES AND WAGES", "SALARY", "ALLOWANCES", "SOCIAL CONTRIBUTION",
    "TOTAL PERSONNEL", "TOTAL OVERHEAD", "TOTAL RECURRENT", "TOTAL CAPITAL",
    "TOTAL ALLOCATION", "TOTAL EXPENDITURE", "GRAND TOTAL", "SUB-TOTAL",
    "CONSOLIDATED SALARY", "RENT SUBSIDY", "FEDERAL GOVERNMENT SHARE",
    "GOODS AND NON", "CAPITAL EXPENDITURE", "RECURRENT EXPENDITURE",
    "STATUTORY TRANSFERS", "OIL & GAS DEDUCTIONS", "OPERATING SURPLUS",
    "GOVERNMENT-OWNED ENTERPRISES", "DEBT SERVICE", "SINKING FUND",
    "SPECIAL INTERVENTION", "CONSOLIDATED REVENUE FUND",
    "ACQUISITION OF NON TANGIBLE ASSETS", "CONSTRUCTION / PROVISION",
    "REHABILITATION / REPAIRS", "PURCHASE OF FIXED ASSETS",
    "RESEARCH AND DEVELOPMENT",
)

# Max plausible single Nigerian federal line item (₦10 Trillion)
MAX_PLAUSIBLE_LINE_AMOUNT = 10_000_000_000_000
MIN_PLAUSIBLE_LINE_AMOUNT = 100


def infer_sector(agency: str = "", title: str = "") -> str:
    """Infers a canonical functional budget sector from executing MDA or project title."""
    combined = f"{agency} {title}".lower()
    for sector, keywords in SECTOR_KEYWORD_RULES:
        if any(kw in combined for kw in keywords):
            return sector
    return "General Administration"


# Official 2000-2008 Gazette Schedule Act PDFs whose rows are curated verbatim leaf schedules
SCHEDULE_ACT_FILENAMES = {
    "appropriation act, 2000.pdf",
    "2001 appropriation act.pdf",
    "appropriation act, 2002.pdf",
    "appropriation act 2003.pdf",
    "the appropriation act, 2004.pdf",
    "the appropriation act, 2005.pdf",
    "the appropriation act, 2006.pdf",
    "the appropriation act, 2007.pdf",
    "the appropriation act, 2008.pdf",
}


def classify_ipsas_record(
    code: str,
    title: str,
    amount: int,
    financial_year: Optional[int] = None,
    source_file: str = "",
) -> tuple[bool, str]:
    """
    Validates a parsed budget line item and classifies its IPSAS spending level.
    Returns (is_valid_leaf_record, spending_type).
    """
    title_clean = (title or "").strip()
    if len(title_clean) <= 2:
        return False, "INVALID"
    if re.fullmatch(r'[\d\s\W_]+', title_clean):
        return False, "INVALID"
    if not MIN_PLAUSIBLE_LINE_AMOUNT <= amount <= MAX_PLAUSIBLE_LINE_AMOUNT:
        return False, "INVALID"
    if financial_year and amount == financial_year:
        return False, "INVALID"

    upper_title = title_clean.upper()
    is_verbatim_schedule = (source_file or "").strip().lower() in SCHEDULE_ACT_FILENAMES
    if not is_verbatim_schedule:
        if upper_title.startswith(("(I)", "(II)", "(III)", "CLASSIFICATION NO", "CTASSI", "SECTION ")):
            return False, "INVALID"
        if "APPROPRIATION (" in upper_title and "ACT" in upper_title and amount >= 100_000_000_000:
            return False, "INVALID"

    code_clean = (code or "").strip()
    is_ergp_like = code_clean.upper().startswith(("ERGP", "ZIP", "NASS", "P-"))

    # Reject rows where the title is pure OCR noise / classification header / multi-code concatenation
    alpha_cnt = sum(1 for c in title_clean if c.isalpha())
    if alpha_cnt < 4:
        return False, "INVALID"
    if "(TOTAL)" in upper_title or upper_title.startswith(("TOTAL ", "TOTAL:", "TOTAL-")):
        return False, "SUMMARY_ROLLUP"
    if len(re.findall(r'\b0?\d{8,14}\b', upper_title)) >= 2:
        return False, "INVALID"

    # Reject pre-2010 Amendment Act single-line OCR blowups > 150B unless statutory/debt schedule item
    if financial_year and financial_year == 2008 and amount > 150_000_000_000:
        if not upper_title.startswith(("DOMESTIC DEBT", "STATUTORY")):
            return False, "INVALID"

    # Reject rows where a >=5-digit numeric code (or leading-zero-stripped code) was read as the amount
    stripped_code = code_clean.lstrip("0")
    if stripped_code.isdigit() and len(stripped_code) >= 5:
        try:
            if abs(int(stripped_code) - amount) <= 1000 or str(amount).startswith(stripped_code[:5]):
                return False, "INVALID"
        except ValueError:
            pass

    # Curated 2000-2008 Gazette Schedule Act rows are leaf national-assembly appropriations
    if is_verbatim_schedule:
        if code_clean.endswith(("-C", "-NC")) or "(CAPITAL)" in upper_title:
            return True, "CAPITAL"
        if any(kw in upper_title for kw in ("STATUTORY TRANSFER", "DEBT SERVICE", "CONTINGENC", "OVERHEAD", "SERVICE-WIDE", "INTERNATIONAL ORGANI")):
            return True, "OVERHEAD"
        return True, "PERSONNEL"

    if not is_ergp_like:
        # In 2016+ IPSAS budgets, 1..6 digit numeric economic codes (2, 21, 2101, 210101, 220607, 230501)
        # and 3-digit ministry summary codes (111, 234, 243) are parent rollup headers, not leaf line items.
        if code_clean.isdigit() and len(code_clean) <= 6:
            if financial_year is None or financial_year >= 2012 or amount >= 500_000_000:
                return False, "SUMMARY_ROLLUP"

        # 9-10 digit MDA header totals ending in 001..999 whose title is a Ministry/Agency name or ends in '0 0 0'
        if code_clean.isdigit() and len(code_clean) in (9, 10) and amount >= 5_000_000_000:
            if upper_title.endswith("0 0") or upper_title.startswith(("FEDERAL MINISTRY", "MINISTRY OF", "PRESIDENCY", "NATIONAL ASSEMBLY", "STATE HOUSE", "NIGERIAN ")):
                return False, "SUMMARY_ROLLUP"

        if any(term in upper_title for term in ROLLUP_TITLE_KEYWORDS):
            is_2011_leaf_coa = (
                financial_year == 2011
                and code_clean.isdigit()
                and len(code_clean) == 8
                and code_clean.startswith(("21", "22", "23"))
                and not upper_title.endswith("- GENERAL")
                and upper_title not in ROLLUP_TITLE_KEYWORDS
            )
            if not is_2011_leaf_coa and (len(code_clean) <= 8 or upper_title in ROLLUP_TITLE_KEYWORDS):
                return False, "SUMMARY_ROLLUP"

    if code_clean.startswith("21"):
        return True, "PERSONNEL"
    if code_clean.startswith("22"):
        return True, "OVERHEAD"
    return True, "CAPITAL"


class PdfParser:
    """Stage 1: Parses raw PDF files using PyMuPDF to extract project line items adaptively (1999-2026)."""

    def __init__(self, pdf_path: str, financial_year: int, file_tag: str = ""):
        self.pdf_path = pdf_path
        self.financial_year = financial_year
        self.file_tag = file_tag
        if not os.path.exists(pdf_path):
            raise FileNotFoundError(f"PDF file not found: {pdf_path}")
        self.doc = fitz.open(pdf_path)
        self.total_pages = len(self.doc)

    @classmethod
    def _clean_single_column_amount(cls, col_text: str, financial_year: Optional[int] = None) -> int:
        """Parses a single isolated column token sequence without multi-column concatenation."""
        s = (col_text or "").strip()
        if not s:
            return 0
        s_clean = s.replace("=N=", "").replace("₦", "").replace("NGN", "").replace("(=N=)", "").strip()
        parts = s_clean.split()
        val = 0

        # Check spaced-thousands currency integer: e.g. "3 193 239 879" or "212 057 158"
        if (
            len(parts) >= 2
            and len(parts) <= 5
            and all(p.isdigit() for p in parts)
            and 1 <= len(parts[0]) <= 3
            and all(len(p) == 3 for p in parts[1:])
        ):
            val = int("".join(parts))
        else:
            tokens = re.findall(
                r'(?:(?:=N=|₦|NGN)\s*)?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?)',
                s
            )
            if not tokens:
                return 0
            raw_tok = tokens[-1]
            digits_only = raw_tok.split(".")[0].replace(",", "")
            if not digits_only.isdigit():
                return 0
            has_fmt = ("," in raw_tok) or ("." in raw_tok) or ("=N=" in s) or ("₦" in s) or ("NGN" in s)
            if len(digits_only) >= 5 and not has_fmt:
                return 0
            val = int(digits_only)

        if financial_year and val == financial_year:
            return 0
        if not MIN_PLAUSIBLE_LINE_AMOUNT <= val <= MAX_PLAUSIBLE_LINE_AMOUNT:
            return 0
        return val

    @classmethod
    def _clean_amount(cls, text: str, financial_year: Optional[int] = None) -> int:
        """
        Extracts a monetary value from a budget line without merging adjacent columns.
        Splits wide multi-column gaps (`2+ spaces` or tabs) first, scanning right-to-left.
        """
        if not text:
            return 0
        s = text.replace("\xa0", " ").strip()
        columns = [c.strip() for c in re.split(r'\s{2,}|\t+', s) if c.strip()]
        for col in reversed(columns):
            val = cls._clean_single_column_amount(col, financial_year)
            if val > 0:
                return val
        return cls._clean_single_column_amount(s, financial_year)

    @staticmethod
    def _parse_code_and_title(line: str) -> tuple[str, str]:
        """
        Parses single, double, multi-digit, quoted, or alphanumeric project codes.
        Supports codes on standalone lines or embedded at the start of title lines.
        Returns (code, title_remainder).
        """
        line_clean = line.strip()
        if not line_clean:
            return "", ""

        # If line is purely spaced numbers (e.g., '3 241 389 773' or '900 000 000'), it's an amount, not a code
        spaced_parts = line_clean.split()
        if len(spaced_parts) > 1 and all(p.isdigit() for p in spaced_parts):
            return "", line_clean

        # Quoted 2010 codes like 0'036...
        m_quoted = re.match(r"^(0?'?\d{1,16})\s+(.*)$", line_clean)
        if m_quoted and len(m_quoted.group(1).replace("'", "").lstrip("0")) > 0:
            return m_quoted.group(1), m_quoted.group(2).strip()

        # Alphanumeric codes (ERGP..., ZIP-..., NASS-..., P-...) followed by title
        m_alpha = re.match(r"^([A-Z0-9_-]{2,18})\s+([A-Za-z].*)$", line_clean)
        if m_alpha and any(c.isdigit() for c in m_alpha.group(1)):
            return m_alpha.group(1), m_alpha.group(2).strip()

        # Digit code (single, double, or multi-digit) followed by text title
        m_digits = re.match(r"^(\d{1,16})\s+([A-Za-z].*)$", line_clean)
        if m_digits:
            return m_digits.group(1), m_digits.group(2).strip()

        # Standalone code line (single token)
        if " " not in line_clean:
            clean_code = line_clean.lstrip("0'").lstrip("'")
            if (
                re.match(r"^\d{1,16}$", clean_code)
                or line_clean.startswith("ERGP")
                or (re.match(r"^[A-Z0-9_-]{2,18}$", clean_code) and any(c.isdigit() for c in clean_code))
            ):
                return clean_code, ""

        return "", line_clean

    def _parse_2004_capital_budget(self) -> tuple[list[dict], int]:
        """Parses the 2004_Capital_Budget.pdf mixed coded and uncoded project tables."""
        projects = []
        current_agency = "Federal Government"
        id_prefix = f"P-{self.financial_year}-{self.file_tag}" if self.file_tag else f"P-{self.financial_year}"
        skip_exact = {
            "FEDERAL REPUBLIC OF NIGERIA", "2004 APPROPRIATION ACT", "2004",
            "PART D - CAPITAL EXPENDITURE", "PART D -  CAPITAL EXPENDITURE",
            "CLASSIFICATION CODE", "CLASSIFICATION", "CODE",
            "DETAILS OF EXPENDITURE", "APPROPRIATION", "ACT",
            "ANTICIPATED TARGET", "=N=", "A", "B", "C", "A CAPITAL SUPPLEMENTATION:-",
        }
        rollup_markers = ("TOTAL", "SUB-TOTAL", "SUB TOTAL", "SUB-TOAL", "SUB TOAL", "GRAND TOTAL")

        for page_idx in range(self.total_pages):
            lines = [l.replace("\xa0", " ").strip() for l in self.doc[page_idx].get_text("text").split("\n") if l.strip()]
            pending_code = ""
            desc_parts: list[str] = []

            for line in lines:
                up = re.sub(r"\s+", " ", line.upper()).strip()
                if up == "SUMMARY":
                    break
                if up in skip_exact or re.fullmatch(r"\d{1,2}/\d{1,2}/\d{4}", line) or re.fullmatch(r"\d{1,3}", line):
                    continue

                # Standalone formatted currency line
                m_amt = re.fullmatch(r"(?:=N=|₦|NGN)?\s*(\d{1,3}(?:,\d{3})+)(?:\.\d{2})?", line)
                if m_amt:
                    amt = int(m_amt.group(1).replace(",", ""))
                    title = " ".join(desc_parts).strip()
                    title_up = title.upper()
                    if (
                        MIN_PLAUSIBLE_LINE_AMOUNT <= amt <= 50_000_000_000
                        and len(title) > 2
                        and sum(c.isalpha() for c in title) >= 4
                        and not any(term in title_up for term in rollup_markers)
                    ):
                        code_val = pending_code or f"2004-CAP-{len(projects)+1:04d}"
                        projects.append({
                            "id": f"{id_prefix}-{len(projects)+1:05d}",
                            "budgetCode": pending_code[:6] if pending_code else "",
                            "projectCode": code_val,
                            "projectName": title,
                            "agency": current_agency,
                            "sector": infer_sector(current_agency, title),
                            "spendingType": "CAPITAL",
                            "financialYear": self.financial_year,
                            "amount": amt,
                            "projectType": "ONGOING",
                            "page": page_idx + 1,
                        })
                    pending_code = ""
                    desc_parts = []
                    continue

                # Update current executing MDA header
                if (
                    line.isupper()
                    and len(line) >= 8
                    and not any(ch.isdigit() for ch in line)
                    and not any(term in up for term in rollup_markers)
                    and any(kw in up for kw in ("MINISTRY", "COMMISSION", "PRESIDENCY", "ASSEMBLY", "POLICE", "DEFENCE", "AGENCY", "OFFICE OF", "COUNCIL", "INSTITUTE"))
                ):
                    current_agency = line.title()
                    pending_code = ""
                    desc_parts = []
                    continue

                m_code = re.match(r"^(\d{9,16})(?:\s+(.*))?$", line)
                if m_code:
                    pending_code = m_code.group(1)
                    desc_parts = [m_code.group(2).strip()] if m_code.group(2) else []
                else:
                    desc_parts.append(line)

        return projects, self.total_pages

    def _is_web_capture_pdf(self) -> bool:
        """Detects HTML webpage navigation captures (e.g. BudgetOffice web sidebar dumps)."""
        if self.total_pages == 0:
            return True
        sample_text = "\n".join(self.doc[i].get_text("text") for i in range(min(2, self.total_pages)))
        if (
            "Media Center" in sample_text
            and "Budget Documents" in sample_text
            and "Executive Order" in sample_text
            and not re.search(r'\d{1,3}(?:,\d{3})+|\d{1,3}(?:\s\d{3}){2,}', sample_text)
        ):
            return True
        return False

    def _parse_2011_summary_page(self, page_idx: int, text: str, id_prefix: str, seq_start: int) -> list[dict]:
        """
        Parses 2011 5-column MDA allocation schedules:
        CODE | MDA | TOTAL PERSONNEL COST | TOTAL OVERHEAD COST | TOTAL RECURRENT | TOTAL CAPITAL | TOTAL ALLOCATION
        Emits distinct PERSONNEL, OVERHEAD, and CAPITAL components only when arithmetic P+O=Rec & Rec+Cap=Total holds.
        """
        lines = [l.replace("\xa0", " ").strip() for l in text.split("\n") if l.strip()]
        blocks: list[tuple[str, list[str]]] = []
        curr_code = ""
        curr_lines: list[str] = []

        for line in lines:
            up_line = line.upper().strip()
            if up_line in ("TOTAL", "SUMMARY", "GRAND TOTAL"):
                if curr_code and curr_lines:
                    blocks.append((curr_code, curr_lines))
                    curr_code = ""
                    curr_lines = []
                continue
            m = re.match(r"^(0\d{5,9})(?:\s+(.*))?$", line)
            if m:
                if curr_code and curr_lines:
                    blocks.append((curr_code, curr_lines))
                curr_code = m.group(1)
                curr_lines = [m.group(2).strip()] if m.group(2) else []
            elif curr_code:
                curr_lines.append(line)
        if curr_code and curr_lines:
            blocks.append((curr_code, curr_lines))

        items: list[dict] = []
        seq = seq_start
        # Spaced thousands strictly use single spaces inside one number; 2+ spaces separate columns
        num_rx = re.compile(r'(?<!\d)(\d{1,3}(?: \d{3}){1,4}|0)(?!\d)')

        for mda_code, blines in blocks:
            title_parts: list[str] = []
            nums: list[int] = []
            for bl in blines:
                found = [int(re.sub(r"\s+", "", tok)) for tok in num_rx.findall(bl)]
                clean_non_num = num_rx.sub("", bl).strip()
                if clean_non_num and any(ch.isalpha() for ch in clean_non_num):
                    title_parts.append(clean_non_num)
                nums.extend(found)

            mda_name = " ".join(title_parts).strip()
            if not mda_name or len(nums) < 5:
                continue

            # Look for a 5-tuple [Personnel, Overhead, Recurrent, Capital, Total]
            matched_tuple = None
            for k in range(len(nums) - 4):
                p_val, o_val, rec_val, cap_val, tot_val = nums[k:k + 5]
                if (
                    tot_val > 0
                    and abs((p_val + o_val) - rec_val) <= 50
                    and abs((rec_val + cap_val) - tot_val) <= 50
                    and tot_val <= MAX_PLAUSIBLE_LINE_AMOUNT
                ):
                    matched_tuple = (p_val, o_val, cap_val)
                    break

            if not matched_tuple:
                continue

            p_val, o_val, cap_val = matched_tuple
            for suffix, label, stype, amt in (
                ("PER", "Personnel Cost Allocation", "PERSONNEL", p_val),
                ("OVH", "Overhead Cost Allocation", "OVERHEAD", o_val),
                ("CAP", "Capital Expenditure Allocation", "CAPITAL", cap_val),
            ):
                if amt < MIN_PLAUSIBLE_LINE_AMOUNT:
                    continue
                seq += 1
                desc = f"{mda_name.title()} — {label}"
                items.append({
                    "id": f"{id_prefix}-{seq:05d}",
                    "budgetCode": mda_code,
                    "projectCode": f"{mda_code}-{suffix}",
                    "projectName": desc,
                    "agency": mda_name.title(),
                    "sector": infer_sector(mda_name, desc),
                    "spendingType": stype,
                    "financialYear": self.financial_year,
                    "amount": amt,
                    "projectType": "ONGOING",
                    "page": page_idx + 1,
                })

        return items

    def _parse_2011_capital_details_page(self, page_idx: int, text: str, id_prefix: str, seq_start: int) -> list[dict]:
        """Parses 2011 Capital Expenditure Details pages where child project titles omit ERGP prefixes."""
        lines = [l.replace("\xa0", " ").strip() for l in text.split("\n") if l.strip()]
        mda_name = "Federal Government"
        mda_code = ""
        for idx, line in enumerate(lines[:15]):
            if line.upper().startswith("MDA:") and idx + 1 < len(lines):
                cand = line[4:].strip() or lines[idx + 1].strip()
                if cand and not cand.upper().startswith("CODE:"):
                    mda_name = cand
            if line.upper().startswith("CODE:") and idx + 1 < len(lines):
                cand_c = line[5:].strip() or lines[idx + 1].strip()
                if re.match(r"^\d{5,10}$", cand_c):
                    mda_code = cand_c

        skip_exact = {
            "ONGOING PROJECTS", "NEW PROJECTS", "CODE", "LINE ITEM", "AMOUNT (=N=)",
            "ZONE", "STATE", "LGA", "LOCATION", "NORTH - CENTRAL", "NORTH-CENTRAL",
            "NORTH - EAST", "NORTH-EAST", "NORTH - WEST", "NORTH-WEST",
            "SOUTH - EAST", "SOUTH-EAST", "SOUTH - WEST", "SOUTH-WEST",
            "SOUTH - SOUTH", "SOUTH-SOUTH", "FCT", "ABUJA",
        }
        items: list[dict] = []
        seq = seq_start
        pending_title = ""
        last_coa_amount = 0

        for line in lines:
            up = re.sub(r"\s+", " ", line.upper()).strip()
            if up in skip_exact or "TOTAL" in up or "REHABILITATION / REPAIRS OF" in up:
                if up.startswith("23") or "REHABILITATION / REPAIRS OF" in up:
                    amt_hdr = self._clean_amount(line, self.financial_year)
                    if amt_hdr > 0:
                        last_coa_amount = amt_hdr
                pending_title = ""
                continue
            if re.match(r"^\d{6,10}$", line):
                pending_title = ""
                continue

            amt = self._clean_amount(line, self.financial_year)
            # Standalone amount line following a child title
            only_num = re.sub(r"[=N=₦NGN\s,.\d]", "", line) == ""
            if only_num and amt > 0 and pending_title:
                # Emit leaf project even if amount equals parent COA group when no distinct children exist
                seq += 1
                items.append({
                    "id": f"{id_prefix}-{seq:05d}",
                    "budgetCode": mda_code,
                    "projectCode": f"CAP-{self.financial_year}-{page_idx+1}-{len(items)+1:03d}",
                    "projectName": pending_title,
                    "agency": mda_name,
                    "sector": infer_sector(mda_name, pending_title),
                    "spendingType": "CAPITAL",
                    "financialYear": self.financial_year,
                    "amount": amt,
                    "projectType": "ONGOING",
                    "page": page_idx + 1,
                })
                pending_title = ""
                last_coa_amount = 0
                continue

            if len(line) >= 8 and sum(c.isalpha() for c in line) >= 6 and not up.startswith(("BUDGET OFFICE", "FEDERAL MINISTRY OF FINANCE", "2011 FGN BUDGET")):
                pending_title = line

        return items

    def _parse_statutory_transfer_fallback(self, filename: str, id_prefix: str) -> list[dict]:
        """Extracts headline Statutory Transfer / Debt Service allocation when summary-only PDF yields 0 child rows."""
        if self.total_pages == 0:
            return []
        text = self.doc[0].get_text("text")
        lines = [l.replace("\xa0", " ").strip() for l in text.split("\n") if l.strip()]
        entity = os.path.splitext(filename)[0].replace("_", " ").strip()
        for line in lines:
            up = line.upper()
            if any(k in up for k in ("NATIONAL ASSEMBLY", "INDEPENDENT NATIONAL ELECTORAL", "NATIONAL JUDICIAL COUNCIL", "PUBLIC COMPLAINTS COMMISSION")):
                entity = line.strip()
                break
        for line in lines:
            m = re.match(r"^(\d{1,3}(?:,\d{3}){2,})\b", line)
            if m:
                amt = int(m.group(1).replace(",", ""))
                if 100_000_000 <= amt <= MAX_PLAUSIBLE_LINE_AMOUNT:
                    title = f"Statutory Transfer Allocation — {entity.title()}"
                    return [{
                        "id": f"{id_prefix}-00001",
                        "budgetCode": "STAT-TRANSFER",
                        "projectCode": "STATUTORY-01",
                        "projectName": title,
                        "agency": entity.title(),
                        "sector": infer_sector(entity, title),
                        "spendingType": "OVERHEAD",
                        "financialYear": self.financial_year,
                        "amount": amt,
                        "projectType": "ONGOING",
                        "page": 1,
                    }]
        return []

    def parse(self) -> tuple[list[dict], int]:
        from ingestion.parsers.schedule_acts_2000_2008 import get_schedule_act_records

        if self.total_pages == 0:
            return [], 0

        filename = os.path.basename(self.pdf_path)
        schedule_records = get_schedule_act_records(self.financial_year, filename, self.file_tag)
        if schedule_records is not None:
            return schedule_records, self.total_pages

        if self.financial_year == 2004 and "2004_capital_budget" in filename.lower():
            return self._parse_2004_capital_budget()

        if self._is_web_capture_pdf():
            return [], self.total_pages

        projects = []
        id_prefix = f"P-{self.financial_year}-{self.file_tag}" if self.file_tag else f"P-{self.financial_year}"
        current_mda_code = ""
        current_mda_name = ""

        # Summary line terms to ignore
        summary_terms = [
            "TOTAL PERSONNEL", "CONSOLIDATED SALARY", "RENT SUBSIDY",
            "SOCIAL CONTRIBUTION", "TOTAL ALLOCATION", "TOTAL CAPITAL PROJECT",
            "TOTAL GOODS AND NON", "TOTAL RECURRENT", "TOTAL OVERHEAD",
            "SUB-TOTAL", "TOTAL EXPENDITURE", "GRAND TOTAL"
        ]

        # Table header keywords to confirm page relevance (1999-2026 formats + Schedules)
        table_keywords = [
            "PROJECT NAME", "LINE ITEM", "APPROPRIATIONS", "TOTAL CAPITAL",
            "ON-GOING PROJECTS", "NEW PROJECTS", "=N=", "TOTAL ALLOCATION",
            "CAPITAL PROJECT", "EXPENDITURE", "DETAILS", "ALLOCATION", "SUB-TOTAL",
            "SCHEDULE", "FIRST SCHEDULE", "SECOND SCHEDULE", "PART A", "PART B",
            "HEAD", "SUB-HEAD", "RECURRENT", "CAPITAL"
        ]

        for page_idx in range(self.total_pages):
            page = self.doc[page_idx]
            text = page.get_text("text")
            upper_text = text.upper()
            norm_upper = re.sub(r"\s+", " ", upper_text)

            if (
                self.financial_year == 2011
                and "TOTAL PERSONNEL" in norm_upper
                and "TOTAL OVERHEAD" in norm_upper
                and "TOTAL CAPITAL" in norm_upper
                and "TOTAL ALLOCATION" in norm_upper
            ):
                summary_rows = self._parse_2011_summary_page(page_idx, text, id_prefix, len(projects))
                if summary_rows:
                    projects.extend(summary_rows)
                    continue

            if (
                self.financial_year == 2011
                and "CAPITAL EXPENDITURE DETAILS" in norm_upper
                and ("ONGOING PROJECTS" in norm_upper or "NEW PROJECTS" in norm_upper)
            ):
                cap_rows = self._parse_2011_capital_details_page(page_idx, text, id_prefix, len(projects))
                if cap_rows:
                    projects.extend(cap_rows)
                    continue

            # Skip pages that have no relevant financial / table text
            if not any(kw in upper_text for kw in table_keywords) and not re.search(r'\d{6,16}', upper_text):
                continue

            lines = [l.replace('\xa0', ' ').strip() for l in text.split("\n") if l.strip()]

            # Detect MDA header context on page
            for k in range(min(15, len(lines))):
                line = lines[k]
                clean_line = line.lstrip("0'").lstrip("'")
                if re.match(r'^\d{4,10}$', clean_line) and k + 1 < len(lines):
                    next_line = lines[k+1]
                    if not next_line.isdigit() and len(next_line) > 3 and not next_line.startswith("ERGP") and not next_line.startswith("LINE"):
                        current_mda_code = clean_line
                        current_mda_name = next_line
                        break

            # Parse line items adaptively across all year eras (1999-2026)
            j = 0
            while j < len(lines):
                line = lines[j]
                code, rem_title = self._parse_code_and_title(line)

                if code:
                    name_parts = [rem_title] if rem_title else []
                    idx = j + 1
                    amount = 0
                    proj_type = "ONGOING"

                    while idx < len(lines):
                        cand = lines[idx]
                        if cand in ["ONGOING", "NEW", "ONGOING PROJECTS", "NEW PROJECTS"]:
                            proj_type = "NEW" if "NEW" in cand else "ONGOING"
                            idx += 1
                            continue

                        cand_amt = self._clean_amount(cand, self.financial_year)
                        if cand_amt > 0:
                            amount = cand_amt
                            if idx + 1 < len(lines) and lines[idx+1] in ["ONGOING", "NEW", "ONGOING PROJECTS", "NEW PROJECTS"]:
                                proj_type = "NEW" if "NEW" in lines[idx+1] else "ONGOING"
                            break
                        else:
                            # Avoid appending next code as part of title
                            next_code, _ = self._parse_code_and_title(cand)
                            if next_code:
                                break
                            name_parts.append(cand)
                        idx += 1

                    project_title = " ".join(p for p in name_parts if p).strip()
                    upper_title = project_title.upper()
                    is_summary = (
                        code == str(self.financial_year)
                        or any(term in upper_title for term in summary_terms)
                    )
                    is_valid, spending_type = classify_ipsas_record(
                        code, project_title, amount, self.financial_year
                    )

                    if is_valid and not is_summary:
                        projects.append({
                            "id": f"{id_prefix}-{len(projects)+1:05d}",
                            "budgetCode": current_mda_code,
                            "projectCode": code,
                            "projectName": project_title,
                            "agency": current_mda_name,
                            "sector": infer_sector(current_mda_name, project_title),
                            "spendingType": spending_type,
                            "financialYear": self.financial_year,
                            "amount": amount,
                            "projectType": proj_type,
                            "page": page_idx + 1
                        })
                        j = idx
                        continue

                j += 1

        if not projects and "statutory transfers" in filename.lower():
            projects = self._parse_statutory_transfer_fallback(filename, id_prefix)

        return projects, self.total_pages
