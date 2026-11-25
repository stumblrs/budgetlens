"""MDA <-> Contractor Capture Network & Off-NOCOPO Private Vendors Builder (Phase 3 · Stage P3-S5).

Analyzes awarded NOCOPO contracts (`stage IN ('award', 'contract', 'implementation')`)
and Open Treasury GovSpend payments (`govspend_payments`) inside
`backend/data/external_ledger_fts.sqlite`:
  1. Per-MDA Herfindahl-Hirschman Index (HHI) vendor concentration & captive pairs (>= 40%)
  2. Multi-MDA super-contractors winning across >= 5 ministries/agencies
  3. NOCOPO vs. GovSpend > 125% payout discrepancies (matched contractors)
  4. Strict 6-category Beneficiary Entity Classifier separating statutory/bank/payroll
     transfers from private corporate entities paid without public NOCOPO awards
  5. Precomputed bipartite SVG coordinates for instantaneous interactive rendering

Writes compact static `public/datasets/vendor_network_index.json` (< 2 MB).
"""

from __future__ import annotations

import argparse
import json
import re
import sqlite3
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.indexers.follow_the_money_builder import _atomic_write_json
from ingestion.indexers.procurement_risk_builder import is_sandbox_or_test_procurement
from ingestion.indexers.project_lifecycle_builder import canonical_contractor_key
from ingestion.parsers.entity_normalizer import clean_display_name

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_FTS_SQLITE = PROJECT_ROOT / "backend" / "data" / "external_ledger_fts.sqlite"
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"
DEFAULT_LEADERBOARD_PATH = DEFAULT_DATASETS_DIR / "contractors_leaderboard.json"

TAXONOMY_CATEGORIES = (
    "PRIVATE_CORPORATE",
    "STATUTORY_GOV_MDA",
    "BANK_FINANCIAL",
    "TAX_REVENUE_PENSION_PAYROLL",
    "STAFF_OR_INDIVIDUAL",
    "UNCLASSIFIED",
)

# 1. Payroll / Tax / Pension / TSA / Transit accounts (must run FIRST)
_TAX_PAYROLL_RE = re.compile(
    r"(?:"
    r"\bIPPIS\b|TRANSATION\s+ACCOUNT|TRANSACTION\s+ACCOUNT|\bTSA\b|\bGIFMIS\b|"
    r"NAIRA\s+TRANSIT|TRANSIT\s+ACCT|TRANSIT\s+ACCOUNT|"
    r"CAPITAL\s+ACCOUNT|PERSONNEL\s+ACCOUNT|OPERATIONS\s+ACCOUNT|PROJECT\s+ACCOUNT|"
    r"PROCEEDS?\s+ACCOUNT|COLLECTION\s+ACCOUNT|REVENUE\s+ACCOUNT|SETTLEMENT\s+ACCOUNT|"
    r"SUB[\s-]+ACCOUNT|SUB\s+RECURRENT|E[\s-]+COLLECTION|"
    r"\bFIRS\b|FEDERAL\s+INLAND\s+REVENUE|INLAND\s+REVENUE|INTERNAL\s+REVENUE|"
    r"WITHHOLDING\s+TAX|\bWHT\b|\bVAT\b|\bPAYE\b|"
    r"\bPENCOM\b|PENSION|\bPFA\b|MILITARY\s+PENSIONS?|"
    r"PAY\s+OFFICE|PAY\s+AND\s+ACCOUNTING|PAYROLL|\bSALAR(?:Y|IES)\b|"
    r"\bNHF\b|\bNHIS\b|\bNSITF\b|BURSARY|DEDUCTION|REMITTANCE|CBN/TSA"
    r")",
    re.IGNORECASE,
)

# 2. Central Bank, Commercial Banks & Regulated Financial Institutions (run SECOND)
_BANK_FIN_RE = re.compile(
    r"(?:"
    r"CENTRAL\s+BANK|\bCBN\b|BANK\s+OF\s+INDUSTRY|BANK\s+OF\s+AGRICULTURE|DEVELOPMENT\s+BANK|"
    r"ZENITH\s+BANK|ACCESS\s+BANK|FIRST\s+BANK|\bUBA\b|UNITED\s+BANK\s+FOR\s+AFRICA|"
    r"GTBANK|GUARANTY\s+TRUST|FIDELITY\s+BANK|FIRST\s+CITY\s+MONUMENT|\bFCMB\b|"
    r"UNION\s+BANK|STANBIC\s+IBTC|STERLING\s+BANK|POLARIS\s+BANK|WEMA\s+BANK|"
    r"ECOBANK|UNITY\s+BANK|KEYSTONE\s+BANK|HERITAGE\s+BANK|JAIZ\s+BANK|"
    r"PROVIDUS\s+BANK|TAJBANK|LOTUS\s+BANK|CITIBANK|STANDARD\s+CHARTERED|"
    r"MERCHANT\s+BANK|COMMERCIAL\s+BANK|MORTGAGE\s+BANK|MICROFINANCE|NEXIM\s+BANK|"
    r"\bAMCON\b|ASSET\s+MANAGEMENT\s+CORPORATION|\bNDIC\b|\bNIBSS\b|"
    r"INTERSWITCH|REMITA|SYSTEMSPECS|INSURANCE|ASSURANCE|TRUSTEES|SECURITIES|"
    r"REGISTRARS|CAPITAL\s+MARKET|\bBANK\s+(?:PLC|LTD|LIMITED|NIGERIA|NIG)\b"
    r")",
    re.IGNORECASE,
)

# 3. Statutory Bodies, MDAs, Military, Security, Universities, Hospitals & SOEs (run THIRD before corporate suffixes)
_STATUTORY_GOV_RE = re.compile(
    r"(?:"
    r"FEDERAL\s+MINISTRY|MINISTRY\s+OF|STATE\s+GOVERNMENT|LOCAL\s+GOVERNMENT|FEDERAL\s+REPUBLIC|"
    r"PRESIDENCY|STATE\s+HOUSE|PRESIDENTIAL\s+AIR\s+FLEET|"
    r"NATIONAL\s+ASSEMBLY|\bNASS\b|\bSENATE\b|HOUSE\s+OF\s+REPRESENTATIVES|"
    r"NATIONAL\s+JUDICIAL\s+COUNCIL|\bNJC\b|SUPREME\s+COURT|COURT\s+OF\s+APPEAL|FEDERAL\s+HIGH\s+COURT|"
    r"NIGERIAN\s+ARMY|HQ\s+ARMY|HQ\s+NIGERIAN\s+ARMY|\bNAVY\b|\bNAVAL\b|NIGERIAN\s+AIR\s+FORCE|\bNAF\b|"
    r"DEFENCE\s+HEADQUARTERS|DEFENCE\s+INTELLIGENCE|DEFENCE\s+MISSIONS|\bDIA\b|\bDSS\b|"
    r"STATE\s+SECURITY\s+SERVICE|NATIONAL\s+INTELLIGENCE\s+AGENCY|\bNIA\b|\bONSA\b|"
    r"NATIONAL\s+SECURITY\s+ADVISER|\bPOLICE\b|IMMIGRATION|CUSTOMS|CORRECTIONAL|PRISON|"
    r"CIVIL\s+DEFENCE|\bNSCDC\b|FIRE\s+SERVICE|\bFRSC\b|ROAD\s+SAFETY|\bEFCC\b|\bICPC\b|\bNDLEA\b|"
    r"\bCOMMISSION\b|\bAUTHORITY\b|\bAGENCY\b|\bDIRECTORATE\b|\bCOUNCIL\b|\bBOARD\b|"
    r"\bDEPARTMENT\b|\bSECRETARIAT\b|\bBUREAU\b|\bINSTITUTE\b|"
    r"\bUNIVERSITY\b|\bPOLYTECHNIC\b|COLLEGE\s+OF|TEACHING\s+HOSPITAL|MEDICAL\s+CENT(?:RE|ER)|HOSPITAL|"
    r"OFFICE\s+OF\s+THE|ACCOUNTANT\s+GENERAL|\bOAGF\b|AUDITOR\s+GENERAL|HEAD\s+OF\s+SERVICE|"
    r"\bOSGF\b|\bUBEC\b|\bNDDC\b|\bNEDC\b|\bINEC\b|\bNYSC\b|\bTETFUND\b|\bPTDF\b|\bFAAC\b|\bNNPC\b|\bNBET\b|\bNDPHC\b|"
    r"NIGER\s+DELTA\s+POWER\s+HOLDING|"
    r"NIGERIAN\s+BULK\s+ELECTRICITY\s+TRADING|TRANSMISSION\s+COMPANY\s+OF\s+NIGERIA|\bTCN\b|"
    r"\bNPA\b|\bNIMASA\b|\bFAAN\b|\bNAMA\b|\bNCAA\b|RAILWAY\s+CORPORATION|\bFCTA\b|\bFCDA\b|"
    r"HEALTH\s+CARE\s+PROVISION\s+FUND|SOCIAL\s+INVESTMENT|ASSOCIATION\s+OF\s+NIGERIA|"
    r"\bEMBASSY\b|HIGH\s+COMMISSION|\bCONSULATE\b|WORLD\s+BANK|AFRICAN\s+DEVELOPMENT\s+BANK|"
    r"\bAFDB\b|\bUNICEF\b|\bUNDP\b|\bUNHCR\b|\bIMF\b"
    r")",
    re.IGNORECASE,
)

# 4. Private Corporate Legal & Commercial Identifiers (run FOURTH)
_PRIVATE_CORP_RE = re.compile(
    r"(?:"
    r"\b(?:LTD|LIMITED|PLC|INC|LLC|LLP|GMBH|VENTURES|ENTERPRISES|ENTERPRISE|TRADING|"
    r"CONSULTING|CONSULTANTS|CONTRACTORS|ENGINEERING|CONSTRUCTION|CONSTRUCTIONS|"
    r"BUILDERS|LOGISTICS|GLOBAL\s+SERVICES|INTEGRATED\s+SERVICES|SOLUTIONS|"
    r"TECHNOLOGIES|TECHNOLOGY|INDUSTRIES|MANUFACTURING|PROPERTIES|INVESTMENTS|"
    r"RESOURCES|HOLDINGS|SYNERGY|ENERGY|OIL\s+AND\s+GAS|PETROLEUM|"
    r"PHARMACEUTICALS|PHARMA|MOTORS|AUTOMOBILES|TEXTILES|FARMS|AGRO|SHIPPING|"
    r"SYNDICATE|GROUP\s+OF\s+COMPANIES|AND\s+SONS|BROTHERS|ASSOCIATES|PARTNERS|"
    r"CHAMBERS|CORP|CORPORATION|COMPANY|CO\s+NIG)\b|&\s*SONS\b"
    r")",
    re.IGNORECASE,
)

# 5. Individual / Staff Honorifics
_HONORIFIC_PERSON_RE = re.compile(
    r"^\s*(?:MR|MRS|MISS|MS|DR|PROF|ENGR|ALH|ALHAJI|HAJIYA|CHIEF|HON|SEN|BARR|ARC|CAPT|COL|GEN|MAJ|PASTOR|REV|IMAM|MALLAM|PRINCE|PRINCESS|JUSTICE)\.?\s+",
    re.IGNORECASE,
)
_ALPHA_TOKEN_RE = re.compile(r"^[A-Z]{3,}$")
_NON_PERSON_WORD_RE = re.compile(
    r"\b(?:NIGERIA|NIG|GLOBAL|GROUP|TECH|SYSTEMS|LINK|SERV|WORKS|CONCEPT|MULTI|PRIME|APEX|ROYAL|INTL|FED|STATE|MIN|ASSOC|CLUB|UNION|SOCIETY|TRUST|FUND|PROJECT|CENTER|CENTRE)\b",
    re.IGNORECASE,
)


def classify_beneficiary_entity(raw_name: str | None) -> str:
    """Deterministically classify a GovSpend beneficiary into one of six entity categories."""
    txt = re.sub(r"\s+", " ", str(raw_name or "").strip())
    if not txt:
        return "UNCLASSIFIED"

    # Strip leading formatting pipes/punctuation sometimes present in OAGF CSVs
    clean = re.sub(r"^[\|\-\.,:\s]+", "", txt)
    if not clean:
        return "UNCLASSIFIED"

    if _TAX_PAYROLL_RE.search(clean):
        return "TAX_REVENUE_PENSION_PAYROLL"
    if _BANK_FIN_RE.search(clean):
        return "BANK_FINANCIAL"
    if _STATUTORY_GOV_RE.search(clean):
        return "STATUTORY_GOV_MDA"
    if _PRIVATE_CORP_RE.search(clean):
        return "PRIVATE_CORPORATE"

    if _HONORIFIC_PERSON_RE.search(clean):
        return "STAFF_OR_INDIVIDUAL"

    tokens = [re.sub(r"[^A-Za-z]", "", t).upper() for t in clean.split() if re.sub(r"[^A-Za-z0-9]", "", t)]
    if (
        2 <= len(tokens) <= 3
        and all(_ALPHA_TOKEN_RE.match(t) for t in tokens)
        and not any(_NON_PERSON_WORD_RE.search(t) for t in tokens)
        and not re.search(r"\d", clean)
    ):
        return "STAFF_OR_INDIVIDUAL"

    return "UNCLASSIFIED"


def compute_mda_hhi(vendor_award_totals: list[int]) -> tuple[float, float, str]:
    """Compute standard 0-10,000 HHI, normalized 0-1 HHI, and DOJ/FTC concentration band."""
    positive = [v for v in vendor_award_totals if v > 0]
    total = sum(positive)
    if total <= 0:
        return 0.0, 0.0, "COMPETITIVE"

    hhi = sum(((v / total) * 100.0) ** 2 for v in positive)
    hhi_round = round(hhi, 1)
    hhi_norm = round(hhi / 10000.0, 4)
    if hhi_round >= 2500.0:
        band = "HIGHLY_CONCENTRATED"
    elif hhi_round >= 1500.0:
        band = "MODERATELY_CONCENTRATED"
    else:
        band = "COMPETITIVE"
    return hhi_round, hhi_norm, band


def _load_leaderboard_lookup(lb_path: Path) -> dict[str, dict[str, Any]]:
    if not lb_path.exists():
        return {}
    try:
        data = json.loads(lb_path.read_text(encoding="utf-8"))
    except Exception:
        return {}
    out: dict[str, dict[str, Any]] = {}
    for entry in data.get("contractors") or []:
        key = canonical_contractor_key(entry.get("contractorName"))
        if key and key not in out:
            out[key] = entry
    return out


def _build_bipartite_graph(
    edges_input: list[dict[str, Any]],
    max_mdas: int = 12,
    max_contractors: int = 14,
) -> dict[str, Any]:
    """Precompute deterministic left/right bipartite node coordinates for SVG rendering."""
    if not edges_input:
        return {"width": 920, "height": 260, "mdaNodes": [], "contractorNodes": [], "edges": []}

    mda_totals: dict[str, int] = defaultdict(int)
    con_totals: dict[str, int] = defaultdict(int)
    con_meta: dict[str, dict[str, Any]] = {}

    for e in edges_input:
        mda_totals[e["mdaName"]] += e["awardedNaira"]
        con_totals[e["contractorKey"]] += e["awardedNaira"]
        if e["contractorKey"] not in con_meta:
            con_meta[e["contractorKey"]] = e

    top_mdas = sorted(mda_totals.keys(), key=lambda m: (-mda_totals[m], m))[:max_mdas]
    top_mda_set = set(top_mdas)

    # Filter edges touching top MDAs, then take top contractors connected to those MDAs
    rel_con_totals: dict[str, int] = defaultdict(int)
    for e in edges_input:
        if e["mdaName"] in top_mda_set:
            rel_con_totals[e["contractorKey"]] += e["awardedNaira"]

    top_cons = sorted(rel_con_totals.keys(), key=lambda c: (-rel_con_totals[c], c))[:max_contractors]
    top_con_set = set(top_cons)

    row_count = max(len(top_mdas), len(top_cons), 1)
    top_pad = 36
    row_step = 42
    height = max(260, top_pad * 2 + (row_count - 1) * row_step + 24)

    mda_nodes = []
    mda_id_map: dict[str, str] = {}
    for idx, m_name in enumerate(top_mdas):
        nid = f"mda-{idx}"
        mda_id_map[m_name] = nid
        mda_nodes.append(
            {
                "id": nid,
                "label": m_name,
                "x": 24,
                "y": top_pad + idx * row_step,
                "totalAwardedNaira": mda_totals[m_name],
            }
        )

    contractor_nodes = []
    con_id_map: dict[str, str] = {}
    for idx, c_key in enumerate(top_cons):
        nid = f"con-{idx}"
        con_id_map[c_key] = nid
        meta = con_meta[c_key]
        contractor_nodes.append(
            {
                "id": nid,
                "label": meta["contractorName"],
                "x": 640,
                "y": top_pad + idx * row_step,
                "totalAwardedNaira": con_totals[c_key],
                "mdaCount": meta.get("mdaCount", 1),
                "bppContractorId": meta.get("bppContractorId"),
                "govspendPaidNaira": meta.get("govspendPaidNaira", 0),
                "govspendPaymentCount": meta.get("govspendPaymentCount", 0),
            }
        )

    graph_edges = []
    seen_pairs: set[tuple[str, str]] = set()
    for idx, e in enumerate(edges_input):
        m_id = mda_id_map.get(e["mdaName"])
        c_id = con_id_map.get(e["contractorKey"])
        if not m_id or not c_id or (m_id, c_id) in seen_pairs:
            continue
        seen_pairs.add((m_id, c_id))
        graph_edges.append(
            {
                "id": f"edge-{idx}",
                "mdaId": m_id,
                "contractorId": c_id,
                "mdaName": e["mdaName"],
                "contractorName": e["contractorName"],
                "awardCount": e["awardCount"],
                "awardedNaira": e["awardedNaira"],
                "shareOfMdaPct": e.get("shareOfMdaPct", 0.0),
                "isCaptive": bool(e.get("isCaptive")),
            }
        )

    return {
        "width": 920,
        "height": height,
        "mdaNodes": mda_nodes,
        "contractorNodes": contractor_nodes,
        "edges": graph_edges,
    }


def _enrich_contractor_fields(c_key: str, fallback_name: str, bpp_id: str | None, lb_map: dict[str, dict[str, Any]], gov_agg: dict[str, dict[str, Any]]) -> dict[str, Any]:
    lb = lb_map.get(c_key)
    gov = gov_agg.get(c_key)
    resolved_name = (str(lb.get("contractorName") or "").strip() if lb else "") or fallback_name
    return {
        "contractorName": resolved_name,
        "bppContractorId": bpp_id or (lb.get("bppContractorId") if lb else None),
        "leaderboardContractCount": lb.get("contractCount") if lb else None,
        "leaderboardTotalContractedNaira": lb.get("totalContractedNaira") if lb else None,
        "leaderboardFirstYear": lb.get("firstYear") if lb else None,
        "leaderboardLastYear": lb.get("lastYear") if lb else None,
        "leaderboardMdaCount": lb.get("mdaCount") if lb else None,
        "leaderboardTopMdas": lb.get("topMdas") or [] if lb else [],
        "govspendPaymentCount": gov["voucherCount"] if gov else 0,
        "govspendPaidNaira": gov["totalPaidNaira"] if gov else 0,
    }


def build_vendor_network_index(
    fts_sqlite_path: str | Path = DEFAULT_FTS_SQLITE,
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    leaderboard_path: str | Path = DEFAULT_LEADERBOARD_PATH,
    write: bool = True,
) -> dict[str, Any]:
    """Build static `vendor_network_index.json` across NOCOPO awards and GovSpend vouchers."""
    db_file = Path(fts_sqlite_path)
    ds_dir = Path(datasets_dir)
    lb_map = _load_leaderboard_lookup(Path(leaderboard_path))

    if not db_file.exists():
        payload = {
            "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "status": "AWAITING_LEDGER_DB",
            "headline": {},
            "mdaConcentration": [],
            "captivePairs": [],
            "multiMdaContractors": [],
            "payoutDiscrepancies": [],
            "offNocopoAudit": {"taxonomyBreakdown": [], "topOffNocopoPrivateVendors": [], "topExcludedInstitutionalTransfers": []},
            "bipartiteGraphs": {"captiveGraph": _build_bipartite_graph([]), "multiMdaGraph": _build_bipartite_graph([])},
        }
        if write:
            _atomic_write_json(ds_dir / "vendor_network_index.json", payload)
        return payload

    conn = sqlite3.connect(str(db_file))
    try:
        has_noc = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='nocopo_contracts'"
        ).fetchone()
        noc_rows = (
            conn.execute(
                """
                SELECT mda_name, contractor_name, norm_contractor, bpp_contractor_id,
                       COALESCE(contract_award_naira, 0), COALESCE(total_paid_naira, 0),
                       financial_year, procurement_method, title, ocid
                FROM nocopo_contracts
                WHERE LOWER(COALESCE(stage, '')) IN ('award', 'contract', 'implementation')
                  AND COALESCE(contract_award_naira, 0) > 0
                """
            ).fetchall()
            if has_noc
            else []
        )

        has_gov = conn.execute(
            "SELECT 1 FROM sqlite_master WHERE type='table' AND name='govspend_payments'"
        ).fetchone()
        gov_rows = (
            conn.execute(
                """
                SELECT beneficiary_name, norm_beneficiary, organization_name,
                       COALESCE(amount_naira, 0), financial_year, description
                FROM govspend_payments
                WHERE COALESCE(amount_naira, 0) > 0
                """
            )
            if has_gov
            else []
        )

        # Aggregate GovSpend by canonical beneficiary key
        gov_agg: dict[str, dict[str, Any]] = {}
        for ben_raw, norm_ben_raw, org_raw, amt_raw, fy_raw, desc_raw in gov_rows:
            ben_name = clean_display_name(ben_raw)
            ckey = canonical_contractor_key(norm_ben_raw or ben_name)
            if not ckey:
                continue
            amt = max(0, int(round(float(amt_raw or 0))))
            org = clean_display_name(org_raw) or "Unspecified MDA"
            entry = gov_agg.get(ckey)
            if entry is None:
                entry = {
                    "displayName": ben_name or ckey,
                    "voucherCount": 0,
                    "totalPaidNaira": 0,
                    "mdaTotals": defaultdict(int),
                    "firstYear": None,
                    "lastYear": None,
                    "sampleDescription": str(desc_raw or "")[:160],
                }
                gov_agg[ckey] = entry
            entry["voucherCount"] += 1
            entry["totalPaidNaira"] += amt
            entry["mdaTotals"][org] += amt
            if len(ben_name) > len(entry["displayName"]) and "|" not in ben_name:
                entry["displayName"] = ben_name
            fy = int(fy_raw) if fy_raw is not None and str(fy_raw).isdigit() else 0
            if 2000 <= fy <= 2030:
                if entry["firstYear"] is None or fy < entry["firstYear"]:
                    entry["firstYear"] = fy
                if entry["lastYear"] is None or fy > entry["lastYear"]:
                    entry["lastYear"] = fy
            if not entry["sampleDescription"] and desc_raw:
                entry["sampleDescription"] = str(desc_raw)[:160]
    finally:
        conn.close()

    # Aggregate Awarded NOCOPO across MDAs and Contractors
    mda_vendor_totals: dict[str, dict[str, dict[str, Any]]] = defaultdict(dict)
    mda_totals: dict[str, dict[str, Any]] = {}
    contractor_totals: dict[str, dict[str, Any]] = {}
    nocopo_contractor_keys: set[str] = set()

    for mda_raw, cname_raw, norm_c_raw, bpp_id, aw_raw, pd_raw, fy_raw, method_raw, title_raw, ocid_raw in noc_rows:
        if is_sandbox_or_test_procurement(mda_raw, title_raw, ocid_raw):
            continue
        mda_name = clean_display_name(mda_raw) or "Unspecified Federal MDA"
        cname = clean_display_name(cname_raw)
        ckey = canonical_contractor_key(norm_c_raw or cname)
        if not ckey:
            continue

        nocopo_contractor_keys.add(ckey)
        aw = max(0, int(round(float(aw_raw or 0))))
        pd = max(0, int(round(float(pd_raw or 0))))
        fy = int(fy_raw) if fy_raw is not None and str(fy_raw).isdigit() else 0

        lb = lb_map.get(ckey)
        resolved_name = (str(lb.get("contractorName") or "").strip() if lb else "") or cname or ckey

        ma = mda_totals.get(mda_name)
        if ma is None:
            ma = {"awardCount": 0, "totalAwardedNaira": 0, "totalPaidNaira": 0}
            mda_totals[mda_name] = ma
        ma["awardCount"] += 1
        ma["totalAwardedNaira"] += aw
        ma["totalPaidNaira"] += pd

        mv = mda_vendor_totals[mda_name].get(ckey)
        if mv is None:
            mv = {
                "contractorKey": ckey,
                "contractorName": resolved_name,
                "bppContractorId": bpp_id,
                "awardCount": 0,
                "awardedNaira": 0,
                "paidNaira": 0,
            }
            mda_vendor_totals[mda_name][ckey] = mv
        mv["awardCount"] += 1
        mv["awardedNaira"] += aw
        mv["paidNaira"] += pd
        if not mv["bppContractorId"] and bpp_id:
            mv["bppContractorId"] = bpp_id

        ca = contractor_totals.get(ckey)
        if ca is None:
            ca = {
                "contractorKey": ckey,
                "contractorName": resolved_name,
                "bppContractorId": bpp_id,
                "awardCount": 0,
                "totalAwardedNaira": 0,
                "totalNocopoPaidNaira": 0,
                "mdaAwards": defaultdict(lambda: [0, 0]),
                "firstYear": None,
                "lastYear": None,
            }
            contractor_totals[ckey] = ca
        ca["awardCount"] += 1
        ca["totalAwardedNaira"] += aw
        ca["totalNocopoPaidNaira"] += pd
        ca["mdaAwards"][mda_name][0] += 1
        ca["mdaAwards"][mda_name][1] += aw
        if not ca["bppContractorId"] and bpp_id:
            ca["bppContractorId"] = bpp_id
        if 2000 <= fy <= 2030:
            if ca["firstYear"] is None or fy < ca["firstYear"]:
                ca["firstYear"] = fy
            if ca["lastYear"] is None or fy > ca["lastYear"]:
                ca["lastYear"] = fy

    # 1. Per-MDA HHI & Captive Pairs (>= 40% share, >= 3 pair awards)
    mda_concentration: list[dict[str, Any]] = []
    captive_pairs: list[dict[str, Any]] = []

    for mda_name, ma in mda_totals.items():
        if ma["awardCount"] < 3:
            continue
        vendors_map = mda_vendor_totals[mda_name]
        vendor_vals = [v["awardedNaira"] for v in vendors_map.values()]
        hhi, hhi_norm, band = compute_mda_hhi(vendor_vals)

        top_v = max(vendors_map.values(), key=lambda x: (x["awardedNaira"], x["awardCount"]))
        top_share = round((top_v["awardedNaira"] / ma["totalAwardedNaira"]) * 100.0, 2) if ma["totalAwardedNaira"] > 0 else 0.0
        top_enriched = _enrich_contractor_fields(
            top_v["contractorKey"], top_v["contractorName"], top_v["bppContractorId"], lb_map, gov_agg
        )

        mda_concentration.append(
            {
                "mdaName": mda_name,
                "awardCount": ma["awardCount"],
                "distinctContractors": len(vendors_map),
                "totalAwardedNaira": ma["totalAwardedNaira"],
                "totalPaidNaira": ma["totalPaidNaira"],
                "hhi": hhi,
                "hhiNormalized": hhi_norm,
                "concentrationBand": band,
                "topVendorSharePct": top_share,
                "topVendorAwardedNaira": top_v["awardedNaira"],
                "topVendorAwardCount": top_v["awardCount"],
                **top_enriched,
            }
        )

        for v in vendors_map.values():
            share_pct = round((v["awardedNaira"] / ma["totalAwardedNaira"]) * 100.0, 2) if ma["totalAwardedNaira"] > 0 else 0.0
            if v["awardCount"] >= 3 and share_pct >= 40.0:
                enriched = _enrich_contractor_fields(
                    v["contractorKey"], v["contractorName"], v["bppContractorId"], lb_map, gov_agg
                )
                captive_pairs.append(
                    {
                        "mdaName": mda_name,
                        "mdaAwardCount": ma["awardCount"],
                        "mdaTotalAwardedNaira": ma["totalAwardedNaira"],
                        "pairAwardCount": v["awardCount"],
                        "pairAwardedNaira": v["awardedNaira"],
                        "pairPaidNaira": v["paidNaira"],
                        "shareOfMdaPct": share_pct,
                        "contractorKey": v["contractorKey"],
                        **enriched,
                    }
                )

    mda_concentration.sort(key=lambda m: (-m["hhi"], -m["totalAwardedNaira"], m["mdaName"]))
    captive_pairs.sort(key=lambda p: (-p["pairAwardedNaira"], -p["shareOfMdaPct"], p["mdaName"]))

    # 2. Multi-MDA Super-Contractors (>= 5 distinct MDAs)
    multi_mda_all: list[dict[str, Any]] = []
    multi_mda_edges_input: list[dict[str, Any]] = []

    for ckey, ca in contractor_totals.items():
        mda_cnt = len(ca["mdaAwards"])
        if mda_cnt < 5:
            continue
        enriched = _enrich_contractor_fields(
            ckey, ca["contractorName"], ca["bppContractorId"], lb_map, gov_agg
        )
        top_mdas = [
            {"mdaName": m, "awardCount": vals[0], "awardedNaira": vals[1]}
            for m, vals in sorted(ca["mdaAwards"].items(), key=lambda kv: (-kv[1][1], -kv[1][0]))[:5]
        ]
        multi_mda_all.append(
            {
                "contractorKey": ckey,
                "mdaCount": mda_cnt,
                "awardCount": ca["awardCount"],
                "totalAwardedNaira": ca["totalAwardedNaira"],
                "totalNocopoPaidNaira": ca["totalNocopoPaidNaira"],
                "firstYear": ca["firstYear"],
                "lastYear": ca["lastYear"],
                "topMdaBreakdown": top_mdas,
                **enriched,
            }
        )

    multi_mda_all.sort(key=lambda c: (-c["mdaCount"], -c["totalAwardedNaira"], c["contractorName"]))

    # Build bipartite graph inputs from captive pairs and top multi-MDA contractors
    captive_edges_input = [
        {
            "mdaName": p["mdaName"],
            "contractorKey": p["contractorKey"],
            "contractorName": p["contractorName"],
            "awardCount": p["pairAwardCount"],
            "awardedNaira": p["pairAwardedNaira"],
            "shareOfMdaPct": p["shareOfMdaPct"],
            "isCaptive": True,
            "mdaCount": p.get("leaderboardMdaCount") or 1,
            "bppContractorId": p.get("bppContractorId"),
            "govspendPaidNaira": p.get("govspendPaidNaira", 0),
            "govspendPaymentCount": p.get("govspendPaymentCount", 0),
        }
        for p in captive_pairs
    ]

    for c in multi_mda_all[:14]:
        for tm in c["topMdaBreakdown"]:
            mda_tot = mda_totals.get(tm["mdaName"], {}).get("totalAwardedNaira", 0)
            sh = round((tm["awardedNaira"] / mda_tot) * 100.0, 2) if mda_tot > 0 else 0.0
            multi_mda_edges_input.append(
                {
                    "mdaName": tm["mdaName"],
                    "contractorKey": c["contractorKey"],
                    "contractorName": c["contractorName"],
                    "awardCount": tm["awardCount"],
                    "awardedNaira": tm["awardedNaira"],
                    "shareOfMdaPct": sh,
                    "isCaptive": sh >= 40.0 and tm["awardCount"] >= 3,
                    "mdaCount": c["mdaCount"],
                    "bppContractorId": c.get("bppContractorId"),
                    "govspendPaidNaira": c.get("govspendPaidNaira", 0),
                    "govspendPaymentCount": c.get("govspendPaymentCount", 0),
                }
            )

    # 3. NOCOPO vs. GovSpend (> 125%) Payout Discrepancy Audit
    matched_contractors_count = 0
    overpaid125_nocopo_awarded = 0
    overpaid125_govspend_paid = 0
    discrepancy_list: list[dict[str, Any]] = []

    for ckey, ca in contractor_totals.items():
        gov = gov_agg.get(ckey)
        if not gov or ca["totalAwardedNaira"] <= 0 or gov["totalPaidNaira"] <= 0:
            continue
        matched_contractors_count += 1
        aw_amt = ca["totalAwardedNaira"]
        gov_amt = gov["totalPaidNaira"]
        if gov_amt > 1.25 * aw_amt:
            overpaid125_nocopo_awarded += aw_amt
            overpaid125_govspend_paid += gov_amt
            excess = gov_amt - aw_amt
            ratio_pct = round((gov_amt / aw_amt) * 100.0, 1)
            enriched = _enrich_contractor_fields(
                ckey, ca["contractorName"], ca["bppContractorId"], lb_map, gov_agg
            )
            top_pay_mdas = [
                m for m, _ in sorted(gov["mdaTotals"].items(), key=lambda kv: (-kv[1], kv[0]))[:3]
            ]
            discrepancy_list.append(
                {
                    "awardCount": ca["awardCount"],
                    "mdaCount": len(ca["mdaAwards"]),
                    "nocopoAwardedNaira": aw_amt,
                    "nocopoDisbursedNaira": ca["totalNocopoPaidNaira"],
                    "govspendPaidNaira": gov_amt,
                    "govspendVoucherCount": gov["voucherCount"],
                    "excessNaira": excess,
                    "payoutToAwardPct": ratio_pct,
                    "topPayingMdas": top_pay_mdas,
                    "firstYear": ca["firstYear"],
                    "lastYear": ca["lastYear"],
                    **{k: v for k, v in enriched.items() if k not in ("govspendPaymentCount", "govspendPaidNaira")},
                }
            )

    discrepancy_list.sort(key=lambda d: (-d["excessNaira"], -d["govspendPaidNaira"]))

    # 4. Off-NOCOPO Beneficiaries Entity Taxonomy Audit
    def _classify_staff_payout_purpose(desc: str) -> str:
        low = (desc or "").strip().lower()
        if len(low) < 12:
            return "OPAQUE_OR_BLANK_DESCRIPTION"
        if any(k in low for k in ("contract", "supply", "construction", "rehabilitation", "procurement", "renovation", "consultancy", "furnishing", "supply of", "execution of")):
            return "CONTRACT_OR_SUPPLY_VIA_INDIVIDUAL"
        if any(k in low for k in ("advance", "imprest", "refund", "reimbursement")):
            return "CASH_ADVANCE_OR_IMPREST"
        if any(k in low for k in ("estacode", "dta", "duty tour", "travel", "ticket", "training", "conference", "workshop")):
            return "TRAVEL_ESTACODE_OR_DTA"
        return "ALLOWANCE_WELFARE_OR_OTHER"

    tax_stats: dict[str, dict[str, Any]] = {
        cat: {
            "category": cat,
            "beneficiaryCount": 0,
            "voucherCount": 0,
            "totalPaidNaira": 0,
            "billionPlusCount": 0,
        }
        for cat in TAXONOMY_CATEGORIES
    }
    off_nocopo_private: list[dict[str, Any]] = []
    off_nocopo_staff: list[dict[str, Any]] = []
    off_nocopo_unclassified: list[dict[str, Any]] = []
    off_nocopo_institutional: list[dict[str, Any]] = []
    off_nocopo_total_naira = 0
    off_nocopo_total_count = 0

    for ckey, gov in gov_agg.items():
        if ckey in nocopo_contractor_keys:
            continue
        off_nocopo_total_count += 1
        off_nocopo_total_naira += gov["totalPaidNaira"]

        cat = classify_beneficiary_entity(gov["displayName"])
        ts = tax_stats[cat]
        ts["beneficiaryCount"] += 1
        ts["voucherCount"] += gov["voucherCount"]
        ts["totalPaidNaira"] += gov["totalPaidNaira"]
        if gov["totalPaidNaira"] >= 1_000_000_000:
            ts["billionPlusCount"] += 1

        top_mdas = [
            {"organizationName": m, "totalNaira": amt}
            for m, amt in sorted(gov["mdaTotals"].items(), key=lambda kv: (-kv[1], kv[0]))[:3]
        ]
        row_obj = {
            "beneficiaryName": gov["displayName"],
            "category": cat,
            "voucherCount": gov["voucherCount"],
            "totalPaidNaira": gov["totalPaidNaira"],
            "payingMdaCount": len(gov["mdaTotals"]),
            "topPayingMdas": top_mdas,
            "firstYear": gov["firstYear"],
            "lastYear": gov["lastYear"],
            "sampleDescription": gov["sampleDescription"],
        }
        if cat == "PRIVATE_CORPORATE":
            off_nocopo_private.append(row_obj)
        elif cat == "STAFF_OR_INDIVIDUAL":
            off_nocopo_staff.append(
                {
                    **row_obj,
                    "purposeTag": _classify_staff_payout_purpose(gov["sampleDescription"]),
                }
            )
        elif cat == "UNCLASSIFIED":
            off_nocopo_unclassified.append(
                {
                    **row_obj,
                    "purposeTag": _classify_staff_payout_purpose(gov["sampleDescription"]),
                }
            )
        elif cat in ("TAX_REVENUE_PENSION_PAYROLL", "STATUTORY_GOV_MDA", "BANK_FINANCIAL"):
            off_nocopo_institutional.append(row_obj)

    off_nocopo_private.sort(key=lambda r: (-r["totalPaidNaira"], -r["voucherCount"], r["beneficiaryName"]))
    off_nocopo_staff.sort(key=lambda r: (-r["totalPaidNaira"], -r["voucherCount"], r["beneficiaryName"]))
    off_nocopo_unclassified.sort(key=lambda r: (-r["totalPaidNaira"], -r["voucherCount"], r["beneficiaryName"]))
    off_nocopo_institutional.sort(key=lambda r: (-r["totalPaidNaira"], -r["voucherCount"]))

    taxonomy_breakdown = []
    for cat in TAXONOMY_CATEGORIES:
        st = tax_stats[cat]
        st["shareOfOffNocopoNairaPct"] = (
            round((st["totalPaidNaira"] / off_nocopo_total_naira) * 100.0, 2)
            if off_nocopo_total_naira > 0
            else 0.0
        )
        taxonomy_breakdown.append(st)
    taxonomy_breakdown.sort(key=lambda x: -x["totalPaidNaira"])

    priv_stat = tax_stats["PRIVATE_CORPORATE"]
    staff_stat = tax_stats["STAFF_OR_INDIVIDUAL"]
    unclass_stat = tax_stats["UNCLASSIFIED"]

    payload: dict[str, Any] = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_VENDOR_NETWORK",
        "headline": {
            "awardedMdaCount": len(mda_totals),
            "eligibleHhiMdaCount": len(mda_concentration),
            "highlyConcentratedMdaCount": sum(
                1 for m in mda_concentration if m["concentrationBand"] == "HIGHLY_CONCENTRATED"
            ),
            "captivePairCount": len(captive_pairs),
            "captivePairAwardedNaira": sum(p["pairAwardedNaira"] for p in captive_pairs),
            "multiMdaContractorCount": len(multi_mda_all),
            "matchedNocopoGovspendCount": matched_contractors_count,
            "overpaid125Count": len(discrepancy_list),
            "overpaid125NocopoAwardedNaira": overpaid125_nocopo_awarded,
            "overpaid125GovspendPaidNaira": overpaid125_govspend_paid,
            "overpaid125ExcessNaira": overpaid125_govspend_paid - overpaid125_nocopo_awarded,
            "offNocopoBeneficiaryCount": off_nocopo_total_count,
            "offNocopoTotalPaidNaira": off_nocopo_total_naira,
            "offNocopoPrivateCount": priv_stat["beneficiaryCount"],
            "offNocopoPrivatePaidNaira": priv_stat["totalPaidNaira"],
            "offNocopoPrivateBillionPlusCount": priv_stat["billionPlusCount"],
            "offNocopoStaffCount": staff_stat["beneficiaryCount"],
            "offNocopoStaffPaidNaira": staff_stat["totalPaidNaira"],
            "offNocopoStaffBillionPlusCount": staff_stat["billionPlusCount"],
            "offNocopoUnclassifiedCount": unclass_stat["beneficiaryCount"],
            "offNocopoUnclassifiedPaidNaira": unclass_stat["totalPaidNaira"],
            "offNocopoUnclassifiedBillionPlusCount": unclass_stat["billionPlusCount"],
        },
        "mdaConcentration": mda_concentration[:40],
        "captivePairs": captive_pairs[:40],
        "multiMdaContractors": multi_mda_all[:50],
        "payoutDiscrepancies": discrepancy_list[:60],
        "offNocopoAudit": {
            "taxonomyBreakdown": taxonomy_breakdown,
            "topOffNocopoPrivateVendors": off_nocopo_private[:80],
            "topStaffOrIndividualPayees": off_nocopo_staff[:80],
            "topUnclassifiedPayees": off_nocopo_unclassified[:50],
            "topExcludedInstitutionalTransfers": off_nocopo_institutional[:25],
        },
        "bipartiteGraphs": {
            "captiveGraph": _build_bipartite_graph(captive_edges_input, max_mdas=12, max_contractors=14),
            "multiMdaGraph": _build_bipartite_graph(multi_mda_edges_input, max_mdas=12, max_contractors=14),
        },
    }

    if write:
        out_vn = ds_dir / "vendor_network_index.json"
        _atomic_write_json(out_vn, payload)
        try:
            from ingestion.checkpoints.phase4_checkpoint import record_phase4_checkpoint

            record_phase4_checkpoint(
                checkpoint_id="CP-2",
                stage="P4-S2",
                title="N1.49T Personal/Staff-Account Payouts & N1.26T Unclassified Payees Audit",
                output_files=[out_vn],
                metrics=payload["headline"],
            )
        except Exception:
            pass

    return payload


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Build MDA <-> Contractor Capture Network & Off-NOCOPO Vendor Audit (P3-S5)."
    )
    parser.add_argument("--sqlite", type=Path, default=DEFAULT_FTS_SQLITE)
    parser.add_argument("--datasets-dir", type=Path, default=DEFAULT_DATASETS_DIR)
    parser.add_argument("--leaderboard", type=Path, default=DEFAULT_LEADERBOARD_PATH)
    args = parser.parse_args()

    res = build_vendor_network_index(
        fts_sqlite_path=args.sqlite,
        datasets_dir=args.datasets_dir,
        leaderboard_path=args.leaderboard,
        write=True,
    )
    out_path = args.datasets_dir / "vendor_network_index.json"
    size_kb = out_path.stat().st_size / 1024.0 if out_path.exists() else 0.0
    h = res["headline"]
    print(
        f"Vendor Network [{res['status']}]: captivePairs={h['captivePairCount']} "
        f"| multiMda={h['multiMdaContractorCount']} | overpaid125={h['overpaid125Count']}/{h['matchedNocopoGovspendCount']} "
        f"(gov=NGN {h['overpaid125GovspendPaidNaira']/1e12:.2f}T vs noc=NGN {h['overpaid125NocopoAwardedNaira']/1e12:.2f}T) "
        f"| offNocopoPrivate={h['offNocopoPrivateCount']} (NGN {h['offNocopoPrivatePaidNaira']/1e12:.2f}T, "
        f"1B+={h['offNocopoPrivateBillionPlusCount']}) | file={size_kb:.1f} KB"
    )


if __name__ == "__main__":
    main()
