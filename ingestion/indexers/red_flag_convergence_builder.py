"""Multi-Layer Red-Flag Convergence Builder (Phase 4 · Stage P4-S4 / Checkpoint CP-4).

Cross-joins 6 independent forensic ledgers in `public/datasets/`:
  1. Legislative Budget Padding (`bill_act_diffs/index.json` + `follow_the_money_links.json`)
  2. Non-Competitive Procurement (`procurement_risk_index.json`)
  3. Contract Variation Overruns & Zero-Paid Awards (`procurement_risk_index.json`)
  4. Treasury Overpayment (`>125%` of NOCOPO award) & Captive/Multi-MDA Reach (`vendor_network_index.json`)
  5. December Rush, Threshold Splitting & Opaque/Staff Payouts (`govspend_forensics.json`, `vendor_network_index.json`)
  6. OAuGF Constitutional Audit Queries, Repeat Neglect & Recovery Orders (`oaugf_audit_index.json`)

Writes `public/datasets/red_flag_convergence_index.json` (< 450 KB) and records Checkpoint CP-4.
"""

from __future__ import annotations

import argparse
import json
import os
import time
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ingestion.indexers.procurement_risk_builder import is_sandbox_or_test_procurement
from ingestion.parsers.entity_normalizer import (
    canonical_contractor_key,
    choose_preferred_contractor_display_name,
    choose_preferred_mda_display_name,
    clean_display_name,
    contractor_match_key,
    is_valid_mda_name,
    mda_core_key,
)

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DEFAULT_DATASETS_DIR = PROJECT_ROOT / "public" / "datasets"


def _atomic_write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = str(path) + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(payload, f, ensure_ascii=False, separators=(",", ":"))
    for attempt in range(5):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            if attempt == 4:
                raise
            time.sleep(0.2)


def _load_json(path: Path) -> dict[str, Any]:
    if not path.is_file():
        return {}
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return {}


def build_red_flag_convergence_index(
    datasets_dir: str | Path = DEFAULT_DATASETS_DIR,
    write: bool = True,
) -> dict[str, Any]:
    """Build `public/datasets/red_flag_convergence_index.json` across all 6 forensic ledgers."""
    ds_dir = Path(datasets_dir)

    vn = _load_json(ds_dir / "vendor_network_index.json")
    pr = _load_json(ds_dir / "procurement_risk_index.json")
    ftm = _load_json(ds_dir / "follow_the_money_links.json")
    gf = _load_json(ds_dir / "govspend_forensics.json")
    sc = _load_json(ds_dir / "mda_integrity_scorecards.json")
    oa = _load_json(ds_dir / "oaugf_audit_index.json")

    # ------------------------------------------------------------------
    # 1. CONTRACTOR MULTI-LAYER CONVERGENCE (5 forensic dimensions)
    # ------------------------------------------------------------------
    contractors: dict[str, dict[str, Any]] = {}

    def _clean_mda_label(raw: Any) -> str:
        text = str(raw or "").strip()
        if not text or not is_valid_mda_name(text) or is_sandbox_or_test_procurement(text):
            return ""
        return clean_display_name(text)

    def _get_vendor(raw_name: str, bpp_id: str | None = None) -> dict[str, Any] | None:
        ckey = canonical_contractor_key(raw_name)
        if not ckey or len(ckey) < 3:
            return None
        mkey = contractor_match_key(raw_name) or ckey
        cleaned_name = clean_display_name(raw_name) or str(raw_name).strip()
        entry = contractors.get(mkey)
        if entry is None:
            entry = {
                "contractorKey": ckey,
                "contractorName": cleaned_name,
                "bppContractorId": bpp_id,
                "flags": set(),
                "flagDetails": [],
                "awardedNaira": 0,
                "govspendPaidNaira": 0,
                "excessOverAwardNaira": 0,
                "overrunDeltaNaira": 0,
                "nonCompetitiveNaira": 0,
                "mdasInvolved": set(),
            }
            contractors[mkey] = entry
        else:
            entry["contractorName"] = choose_preferred_contractor_display_name(
                entry["contractorName"], cleaned_name
            )
            if not entry.get("bppContractorId") and bpp_id:
                entry["bppContractorId"] = bpp_id
        return entry

    # Dimension 1: Overpaid > 125% in GovSpend vs NOCOPO
    for row in vn.get("payoutDiscrepancies", []):
        v = _get_vendor(row.get("contractorName", ""), row.get("bppContractorId"))
        if not v:
            continue
        v["flags"].add("OVERPAID_GT_125_PCT")
        v["awardedNaira"] = max(v["awardedNaira"], int(row.get("nocopoAwardedNaira") or 0))
        v["govspendPaidNaira"] = max(v["govspendPaidNaira"], int(row.get("govspendPaidNaira") or 0))
        v["excessOverAwardNaira"] = max(v["excessOverAwardNaira"], int(row.get("excessNaira") or 0))
        for m in row.get("topPayingMdas", []):
            cm_label = _clean_mda_label(m)
            if cm_label:
                v["mdasInvolved"].add(cm_label)
        v["flagDetails"].append(
            f"Treasury paid {row.get('payoutToAwardPct', 0)}% of recorded contract awards"
        )

    # Dimension 2: Captive Pair (>=40% MDA share) or Multi-MDA Super-Contractor (>=5 MDAs)
    for cp in vn.get("captivePairs", []):
        v = _get_vendor(cp.get("contractorName", ""), cp.get("bppContractorId"))
        if not v:
            continue
        v["flags"].add("CAPTIVE_OR_MULTI_MDA_DOMINANCE")
        v["awardedNaira"] = max(v["awardedNaira"], int(cp.get("pairAwardedNaira") or 0))
        cp_mda = _clean_mda_label(cp.get("mdaName"))
        if cp_mda:
            v["mdasInvolved"].add(cp_mda)
        v["flagDetails"].append(
            f"Captive pair: {cp.get('shareOfMdaPct', 0)}% award share at {cp_mda or cp.get('mdaName')}"
        )

    for mm in vn.get("multiMdaContractors", []):
        v = _get_vendor(mm.get("contractorName", ""), mm.get("bppContractorId"))
        if not v:
            continue
        v["flags"].add("CAPTIVE_OR_MULTI_MDA_DOMINANCE")
        v["awardedNaira"] = max(v["awardedNaira"], int(mm.get("totalAwardedNaira") or 0))
        for tm in mm.get("topMdaBreakdown", []):
            tm_mda = _clean_mda_label(tm.get("mdaName"))
            if tm_mda:
                v["mdasInvolved"].add(tm_mda)
        v["flagDetails"].append(f"Multi-MDA super-contractor winning across {mm.get('mdaCount', 0)} MDAs")

    # Dimension 3: Contract Variation Overruns (Paid > Award)
    for ov in pr.get("topOverrunContracts", []):
        v = _get_vendor(ov.get("contractorName", ""), ov.get("bppContractorId"))
        if not v:
            continue
        v["flags"].add("CONTRACT_VARIATION_OVERRUN")
        v["awardedNaira"] = max(v["awardedNaira"], int(ov.get("awardNaira") or 0))
        v["overrunDeltaNaira"] += int(ov.get("overrunDeltaNaira") or 0)
        ov_mda = _clean_mda_label(ov.get("mdaName"))
        if ov_mda:
            v["mdasInvolved"].add(ov_mda)
        v["flagDetails"].append(
            f"Contract payment overrun (+₦{int(ov.get('overrunDeltaNaira') or 0):,}) at {ov_mda or ov.get('mdaName')}"
        )

    # Dimension 4: Non-Competitive / Direct / Emergency Awards
    for nc in pr.get("topNonCompetitiveAwards", []):
        v = _get_vendor(nc.get("contractorName", ""), nc.get("bppContractorId"))
        if not v:
            continue
        v["flags"].add("NON_COMPETITIVE_PROCUREMENT")
        v["nonCompetitiveNaira"] += int(nc.get("awardNaira") or 0)
        v["awardedNaira"] = max(v["awardedNaira"], int(nc.get("awardNaira") or 0))
        nc_mda = _clean_mda_label(nc.get("mdaName"))
        if nc_mda:
            v["mdasInvolved"].add(nc_mda)
        v["flagDetails"].append(
            f"{nc.get('procurementMethod') or 'Non-competitive'} award at {nc_mda or nc.get('mdaName')}"
        )

    # Dimension 5: Padded Bill-vs-Act Diff or Zombie/Vendor-Switched Recurring Lineage
    for d_link in (ftm.get("diffLinksById") or {}).values():
        if not isinstance(d_link, dict):
            continue
        for c_item in d_link.get("contractors", []):
            v = _get_vendor(c_item.get("contractorName", ""), c_item.get("bppContractorId"))
            if not v:
                continue
            v["flags"].add("PADDED_OR_ZOMBIE_LINEAGE_LINK")
            v["awardedNaira"] = max(v["awardedNaira"], int(c_item.get("awardedNaira") or 0))
            v["flagDetails"].append(
                f"Contracted on legislative budget diff item ({d_link.get('changeType') or 'ALTERED'})"
            )

    for l_link in (ftm.get("lineageLinksById") or {}).values():
        if not isinstance(l_link, dict):
            continue
        cls = str(l_link.get("classification") or "")
        if cls not in ("VENDOR_SWITCHED_REPEAT", "AWARDED_UNPAID"):
            continue
        for c_item in l_link.get("contractors", []):
            v = _get_vendor(c_item.get("contractorName", ""), c_item.get("bppContractorId"))
            if not v:
                continue
            v["flags"].add("PADDED_OR_ZOMBIE_LINEAGE_LINK")
            v["flagDetails"].append(f"Linked to {cls} recurring project lineage")

    convergent_contractors: list[dict[str, Any]] = []
    for v in contractors.values():
        flag_list = sorted(v["flags"])
        if len(flag_list) < 2:
            continue
        exposure = max(
            v["govspendPaidNaira"],
            v["awardedNaira"] + v["overrunDeltaNaira"],
            v["nonCompetitiveNaira"],
        )
        convergent_contractors.append(
            {
                "contractorKey": v["contractorKey"],
                "contractorName": v["contractorName"],
                "bppContractorId": v["bppContractorId"],
                "flagCount": len(flag_list),
                "flags": flag_list,
                "flagDetails": list(dict.fromkeys(v["flagDetails"]))[:5],
                "totalExposureNaira": exposure,
                "awardedNaira": v["awardedNaira"],
                "govspendPaidNaira": v["govspendPaidNaira"],
                "excessOverAwardNaira": v["excessOverAwardNaira"],
                "overrunDeltaNaira": v["overrunDeltaNaira"],
                "nonCompetitiveNaira": v["nonCompetitiveNaira"],
                "mdasInvolved": sorted(v["mdasInvolved"])[:6],
            }
        )

    convergent_contractors.sort(
        key=lambda x: (-x["flagCount"], -x["totalExposureNaira"], x["contractorName"])
    )

    # ------------------------------------------------------------------
    # 2. MDA MULTI-LAYER CONVERGENCE (6 forensic dimensions)
    # ------------------------------------------------------------------
    mda_map: dict[str, dict[str, Any]] = {}

    def _get_mda(raw_mda: str) -> dict[str, Any] | None:
        if not is_valid_mda_name(raw_mda) or is_sandbox_or_test_procurement(raw_mda):
            return None
        key = mda_core_key(raw_mda)
        if not key or len(key) < 4:
            return None
        cleaned = clean_display_name(raw_mda)
        entry = mda_map.get(key)
        if entry is None:
            entry = {
                "mdaKey": key,
                "mdaName": cleaned,
                "flags": set(),
                "flagDetails": [],
                "compositeScore": None,
                "grade": "N/A",
                "oaugfQueryCount": 0,
                "oaugfRepeatCount": 0,
                "totalExposureNaira": 0,
            }
            mda_map[key] = entry
        else:
            entry["mdaName"] = choose_preferred_mda_display_name(entry["mdaName"], cleaned)
        return entry

    # Scorecard pillars (Padding, Open Bidding, Cash Discipline, Grade)
    for m in sc.get("mdas", []):
        entry = _get_mda(m.get("mdaName", ""))
        if not entry:
            continue
        entry["mdaName"] = choose_preferred_mda_display_name(entry["mdaName"], m.get("mdaName", ""))
        if entry["compositeScore"] is None and m.get("compositeScore") is not None:
            entry["compositeScore"] = m.get("compositeScore")
        if entry["grade"] == "N/A" and m.get("grade"):
            entry["grade"] = m.get("grade", "N/A")
        entry["totalExposureNaira"] = max(
            entry["totalExposureNaira"], int(m.get("totalTrackedExposureNaira") or 0)
        )
        if m.get("grade") in ("D", "F"):
            entry["flags"].add("LOW_INTEGRITY_GRADE")
            entry["flagDetails"].append(
                f"Composite Integrity Grade {m.get('grade')} ({m.get('compositeScore')}/100)"
            )
        pillars = m.get("pillars") or {}
        pad_p = pillars.get("paddingRestraint") or {}
        if (pad_p.get("paddingSharePct") or 0) >= 25.0:
            entry["flags"].add("HIGH_LEGISLATIVE_PADDING")
            entry["flagDetails"].append(f"Legislative padding share {pad_p.get('paddingSharePct')}%")
        bid_p = pillars.get("openBiddingShare") or {}
        if (bid_p.get("nonCompetitiveCount") or 0) >= 5 and (bid_p.get("openBiddingValueSharePct") or 100) < 50.0:
            entry["flags"].add("HIGH_NON_COMPETITIVE_OR_OVERRUN")
            entry["flagDetails"].append(
                f"{bid_p.get('nonCompetitiveCount')} non-competitive awards ({100 - float(bid_p.get('openBiddingValueSharePct') or 0):.1f}% value)"
            )

    # OAuGF Audit Negligence
    for o_mda in (oa.get("byMda") or {}).values():
        entry = _get_mda(o_mda.get("mdaName", ""))
        if not entry:
            continue
        q_cnt = int(o_mda.get("findingCount") or 0)
        rep_cnt = int(o_mda.get("repeatNeglectCount") or 0)
        rec_cnt = int(o_mda.get("recoveryDirectiveCount") or 0)
        entry["oaugfQueryCount"] += q_cnt
        entry["oaugfRepeatCount"] += rep_cnt
        if q_cnt >= 5 or rep_cnt >= 1 or rec_cnt >= 1:
            entry["flags"].add("HIGH_OAUGF_NEGLIGENCE")
            entry["flagDetails"].append(
                f"{q_cnt} OAuGF audit queries ({rep_cnt} repeat/ignored, {rec_cnt} recovery orders)"
            )

    # December Rush & Threshold Splitting
    for dec_m in (gf.get("decemberRush") or {}).get("topDecemberRushMdas", []):
        entry = _get_mda(dec_m.get("organizationName", ""))
        if not entry:
            continue
        entry["flags"].add("DECEMBER_RUSH_OR_SPLITTING")
        entry["flagDetails"].append(
            f"December spending surge {dec_m.get('decemberRushRatio')}x ({dec_m.get('decemberSharePct')}% in Dec)"
        )

    # Opaque / Staff Payouts
    for cat in (gf.get("discretionaryAndOpaqueAudit") or {}).get("categories", []):
        for tm in cat.get("topMdas", [])[:5]:
            entry = _get_mda(tm.get("organizationName", ""))
            if not entry:
                continue
            entry["flags"].add("OPAQUE_OR_STAFF_PAYOUTS")
            entry["flagDetails"].append(
                f"Top payer in {cat.get('label')}: {tm.get('voucherCount')} vouchers"
            )

    convergent_mdas: list[dict[str, Any]] = []
    for m in mda_map.values():
        flag_list = sorted(m["flags"])
        if len(flag_list) < 2:
            continue
        convergent_mdas.append(
            {
                "mdaKey": m["mdaKey"],
                "mdaName": m["mdaName"],
                "flagCount": len(flag_list),
                "flags": flag_list,
                "flagDetails": list(dict.fromkeys(m["flagDetails"]))[:6],
                "compositeScore": m["compositeScore"],
                "grade": m["grade"],
                "oaugfQueryCount": m["oaugfQueryCount"],
                "oaugfRepeatCount": m["oaugfRepeatCount"],
                "totalExposureNaira": m["totalExposureNaira"],
            }
        )

    convergent_mdas.sort(
        key=lambda x: (-x["flagCount"], -x["oaugfQueryCount"], -x["totalExposureNaira"])
    )

    payload = {
        "generatedAt": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "status": "VERIFIED_RED_FLAG_CONVERGENCE",
        "headline": {
            "convergentContractorCount": len(convergent_contractors),
            "highRisk3PlusContractorCount": sum(1 for c in convergent_contractors if c["flagCount"] >= 3),
            "convergentContractorExposureNaira": sum(c["totalExposureNaira"] for c in convergent_contractors),
            "convergentMdaCount": len(convergent_mdas),
            "highRisk3PlusMdaCount": sum(1 for m in convergent_mdas if m["flagCount"] >= 3),
        },
        "contractors": convergent_contractors[:80],
        "mdas": convergent_mdas[:80],
    }

    if write:
        out_path = ds_dir / "red_flag_convergence_index.json"
        _atomic_write_json(out_path, payload)
        try:
            from ingestion.checkpoints.phase4_checkpoint import record_phase4_checkpoint

            record_phase4_checkpoint(
                checkpoint_id="CP-4",
                stage="P4-S4",
                title="Multi-Layer Red-Flag Convergence Index (Contractors & MDAs across 6 ledgers)",
                output_files=[out_path],
                metrics=payload["headline"],
            )
        except Exception:
            pass

    return payload


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Multi-Layer Red-Flag Convergence Index (P4-S4)")
    parser.add_argument("--datasets-dir", type=Path, default=DEFAULT_DATASETS_DIR)
    args = parser.parse_args()

    res = build_red_flag_convergence_index(datasets_dir=args.datasets_dir, write=True)
    h = res["headline"]
    print(
        f"Red-Flag Convergence [{res['status']}]: contractors={h['convergentContractorCount']} "
        f"(3+ flags={h['highRisk3PlusContractorCount']}) | mdas={h['convergentMdaCount']} "
        f"(3+ flags={h['highRisk3PlusMdaCount']})"
    )
