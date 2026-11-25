import json
from pathlib import Path

from ingestion.indexers.cascade import CascadeEngine
from ingestion.indexers.red_flag_convergence_builder import build_red_flag_convergence_index


def test_phase4_all_years_oaugf_staff_payouts_opaque_cash_and_convergence():
    # CP-1: All-years OAuGF multi-format findings & shards
    oa_path = Path("public/datasets/oaugf_audit_index.json")
    assert oa_path.is_file()
    oa = json.loads(oa_path.read_text(encoding="utf-8"))
    oh = oa["headline"]
    assert oh["reportsIndexed"] == 36
    assert oh["reportsWithFindingsCount"] >= 30
    assert oh["parsedAuditIssuesCount"] >= 6000
    assert len(oa.get("shardFiles", [])) >= 6
    assert len(oa.get("upstreamMissing404Reports", [])) == 8
    assert oa_path.stat().st_size < 2_500_000

    # CP-2: Staff/Individual (N1.49T) & Unclassified (N1.26T) Off-NOCOPO payouts
    vn_path = Path("public/datasets/vendor_network_index.json")
    vn = json.loads(vn_path.read_text(encoding="utf-8"))
    vh = vn["headline"]
    assert 10_000 <= vh["offNocopoStaffCount"] <= 11_000
    assert vh["offNocopoStaffPaidNaira"] >= 1_400_000_000_000
    assert len(vn["offNocopoAudit"]["topStaffOrIndividualPayees"]) >= 50
    assert len(vn["offNocopoAudit"]["topUnclassifiedPayees"]) >= 30

    # CP-3: Opaque & Discretionary Cash Forensics (₦1.91T after P7-CP-3 payroll tag exemption across 6 categories)
    gf_path = Path("public/datasets/govspend_forensics.json")
    gf = json.loads(gf_path.read_text(encoding="utf-8"))
    disc = gf["discretionaryAndOpaqueAudit"]
    assert disc["totalFlaggedVouchers"] >= 30000
    assert disc["totalFlaggedNaira"] >= 1_800_000_000_000
    assert disc["exemptedShortPayrollCount"] >= 50
    assert len(disc["categories"]) == 6

    # CP-4: Multi-Layer Red-Flag Convergence Index
    conv_path = Path("public/datasets/red_flag_convergence_index.json")
    assert conv_path.is_file()
    conv = json.loads(conv_path.read_text(encoding="utf-8"))
    ch = conv["headline"]
    assert ch["convergentContractorCount"] >= 15
    assert ch["convergentMdaCount"] >= 20

    # CP-5: Checkpoints recorded in ingestion/checkpoints_data/phase4_checkpoints.json
    ckpt_path = Path("ingestion/checkpoints_data/phase4_checkpoints.json")
    assert ckpt_path.is_file()
    ckpts = json.loads(ckpt_path.read_text(encoding="utf-8"))["checkpoints"]
    for cp_id in ("CP-1", "CP-2", "CP-3", "CP-4", "CP-5"):
        assert cp_id in ckpts
        assert ckpts[cp_id]["status"] == "COMPLETED"


def test_red_flag_convergence_dedups_contractors_mdas_and_mojibake(tmp_path: Path):
    ds = tmp_path / "datasets"
    ds.mkdir(parents=True)

    (ds / "vendor_network_index.json").write_text(
        json.dumps({"payoutDiscrepancies": [], "captivePairs": [], "multiMdaContractors": []}),
        encoding="utf-8",
    )
    (ds / "procurement_risk_index.json").write_text(
        json.dumps(
            {
                "topOverrunContracts": [
                    {
                        "contractorName": "Adroit Landstyle Limited",
                        "mdaName": "MINISTRY OF DEFENCE - MOD HQTRS",
                        "awardNaira": 645_450_000,
                        "overrunDeltaNaira": 50_000_000,
                    },
                    {
                        "contractorName": "Adroit Landstyle",
                        "mdaName": "FEDERAL MINISTRY OF DEFENCE - MAIN MOD",
                        "awardNaira": 100_000_000,
                        "overrunDeltaNaira": 10_000_000,
                    },
                ],
                "topNonCompetitiveAwards": [
                    {
                        "contractorName": "ADROIT - LAND STYLE LTD",
                        "mdaName": "HADEJIA-JAMA\u00c3\u0084\u00c2\u00bbARE RBDA",
                        "awardNaira": 645_450_000,
                        "procurementMethod": "Direct Procurement",
                    }
                ],
            }
        ),
        encoding="utf-8",
    )
    (ds / "follow_the_money_links.json").write_text(
        json.dumps({"diffLinksById": {}, "lineageLinksById": {}}), encoding="utf-8"
    )
    (ds / "govspend_forensics.json").write_text(
        json.dumps(
            {
                "decemberRush": {
                    "topDecemberRushMdas": [
                        {"organizationName": "10,250,000", "decemberRushRatio": 5.0, "decemberSharePct": 80},
                        {
                            "organizationName": "MINISTRY OF DEFENCE - MOD HQTRS",
                            "decemberRushRatio": 3.2,
                            "decemberSharePct": 41.0,
                        },
                    ]
                },
                "discretionaryAndOpaqueAudit": {
                    "categories": [
                        {
                            "label": "Opaque/Blank Description",
                            "topMdas": [
                                {"organizationName": "FEDERAL MINISTRY OF DEFENCE - MAIN MOD", "voucherCount": 95},
                                {"organizationName": "10,250,000", "voucherCount": 20},
                                {"organizationName": "HADEJIA-JAMA\u00c3\u0084\u00c2\u00bbARE RBDA", "voucherCount": 14},
                            ],
                        }
                    ]
                },
            }
        ),
        encoding="utf-8",
    )
    (ds / "mda_integrity_scorecards.json").write_text(
        json.dumps(
            {
                "mdas": [
                    {
                        "mdaName": "HADEJIA-JAMA\u00c3\u0084\u00c2\u00bbARE RBDA",
                        "grade": "D",
                        "compositeScore": 41.0,
                        "totalTrackedExposureNaira": 500_000_000,
                        "pillars": {"paddingRestraint": {"paddingSharePct": 30.0}, "openBiddingShare": {}},
                    },
                    {
                        "mdaName": "FEDERAL MINISTRY OF DEFENCE - MAIN MOD",
                        "grade": "C",
                        "compositeScore": 58.0,
                        "totalTrackedExposureNaira": 900_000_000,
                        "pillars": {},
                    },
                ]
            }
        ),
        encoding="utf-8",
    )
    (ds / "oaugf_audit_index.json").write_text(
        json.dumps(
            {
                "byMda": {
                    "def": {
                        "mdaName": "FEDERAL MINISTRY OF DEFENCE",
                        "findingCount": 12,
                        "repeatNeglectCount": 2,
                        "recoveryDirectiveCount": 1,
                    }
                }
            }
        ),
        encoding="utf-8",
    )

    payload = build_red_flag_convergence_index(datasets_dir=ds, write=False)
    contractors = payload["contractors"]
    assert len(contractors) == 1
    assert contractors[0]["contractorName"] == "Adroit Landstyle Limited"
    assert contractors[0]["overrunDeltaNaira"] == 60_000_000
    assert "HADEJIA-JAMA'ARE RBDA" in contractors[0]["mdasInvolved"]
    assert all("\u00c4" not in m and "\u00c3" not in m for m in contractors[0]["mdasInvolved"])

    mdas = payload["mdas"]
    mda_keys = [m["mdaKey"] for m in mdas]
    assert "10 250 000" not in mda_keys
    assert mda_keys.count("DEFENCE") == 1
    def_row = next(m for m in mdas if m["mdaKey"] == "DEFENCE")
    assert def_row["mdaName"] == "FEDERAL MINISTRY OF DEFENCE"
    assert def_row["grade"] == "C"
    had_row = next(m for m in mdas if m["mdaKey"] == "HADEJIA JAMA ARE RBDA")
    assert had_row["mdaName"] == "HADEJIA-JAMA'ARE RBDA"
