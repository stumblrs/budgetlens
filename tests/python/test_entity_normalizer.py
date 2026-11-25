import json
from pathlib import Path

from ingestion.parsers.entity_normalizer import (
    canonical_contractor_key,
    clean_display_name,
    contractor_match_key,
    extract_bpp_contractor_id,
    extract_ergp_codes,
    is_valid_mda_name,
    mda_core_key,
    normalize_admin_code,
    normalize_entity_name,
    normalize_mda_name,
)


def test_normalize_admin_code_padding_and_extraction():
    assert normalize_admin_code("NG-BPP-BPP-NOC-517001001") == "0517001001"
    assert normalize_admin_code("145001001") == "0145001001"
    assert normalize_admin_code("0145001001") == "0145001001"
    assert normalize_admin_code("1234567") == "1234567"
    assert normalize_admin_code("12345678") == "12345678"
    assert normalize_admin_code("12345") == ""
    assert normalize_admin_code("") == ""
    assert normalize_admin_code(None) == ""


def test_normalize_mda_name_and_core_key():
    assert normalize_mda_name("FEDERAL MINISTRY OF EDUCATION - HQTRS") == "FEDERAL MINISTRY OF EDUCATION"
    assert normalize_mda_name("Federal Ministry of Defence - Main MOD") == "FEDERAL MINISTRY OF DEFENCE"
    assert normalize_mda_name("Works, Power & Housing HQTRS") == "WORKS POWER AND HOUSING"
    assert mda_core_key("FEDERAL MINISTRY OF WORKS - HQTRS") == "WORKS"
    assert mda_core_key("Ministry of Agriculture & Rural Development") == "AGRICULTURE AND RURAL DEVELOPMENT"
    assert mda_core_key("Office of the Accountant General") == "ACCOUNTANT GENERAL"


def test_normalize_entity_name():
    assert (
        normalize_entity_name("Zenith International Construction Nigeria Limited & Sons")
        == "ZENITH INTL CONSTRUCTION NIG LTD AND SONS"
    )
    assert (
        normalize_entity_name("Alpha-Beta Enterprises Company Services")
        == "ALPHA BETA ENT CO SVCS"
    )
    assert normalize_entity_name(None) == ""


def test_extract_ergp_and_bpp_ids():
    assert extract_ergp_codes("Procurement for ERGP14101515 and ERGP-2024001 and ergp 14101515") == [
        "ERGP14101515",
        "ERGP2024001",
    ]
    assert extract_ergp_codes("No project code here") == []
    assert extract_bpp_contractor_id("NG-BPP-BPP-CI-4582") == "BPP-CI-4582"
    assert extract_bpp_contractor_id("bpp-ci-99") == "BPP-CI-99"
    assert extract_bpp_contractor_id("RC-123456") is None


def test_source_provenance_external_sources_sha256():
    prov_path = Path("public/datasets/source_provenance.json")
    assert prov_path.exists()
    data = json.loads(prov_path.read_text(encoding="utf-8"))
    assert data["yearCount"] == 28
    assert len(data["years"]) == 28
    ext = data.get("externalSources")
    assert isinstance(ext, dict)
    for key in ("bir_pdfs", "policy_pdfs", "NocopoJson", "govspend_data"):
        assert key in ext
        assert ext[key]["fileCount"] >= 1
        for f in ext[key]["files"]:
            assert len(f["sha256"]) == 64
            assert int(f["sha256"], 16) >= 0
            assert not f["filename"].endswith("pages.jsonl")


def test_is_valid_mda_name_rejects_numeric_and_noise():
    invalid_inputs = [
        "10,250,000",
        "10 250 000",
        "₦500,000",
        "TOTAL",
        "N/A",
        "NONE",
        "LOT 1",
        "KM 10",
        "PHASE 2",
        "",
        None,
    ]
    for raw in invalid_inputs:
        assert is_valid_mda_name(raw) is False, f"Expected invalid MDA: {raw!r}"
        assert mda_core_key(raw) == ""

    for valid in (
        "EFCC",
        "CBN",
        "FEDERAL MINISTRY OF WORKS",
        "HADEJIA-JAMA\u00c4\u00bbARE RBDA",
    ):
        assert is_valid_mda_name(valid) is True


def test_mojibake_and_typo_repair():
    assert clean_display_name("HADEJIA-JAMA\u00c4\u00bbARE RBDA") == "HADEJIA-JAMA'ARE RBDA"
    assert (
        clean_display_name("HADEJIA-JAMA\u00c3\u0084\u00c2\u00bbARE RBDA")
        == "HADEJIA-JAMA'ARE RBDA"
    )
    assert normalize_mda_name("FEDERAL UNIVERSITYOF GASHUA") == "FEDERAL UNIVERSITY OF GASHUA"
    assert (
        normalize_mda_name("NATIONAL EMERGENCY MANAGEMANT AGENCY")
        == "NATIONAL EMERGENCY MANAGEMENT AGENCY"
    )
    assert clean_display_name("DEFENCE HEADQURTERS") == "DEFENCE HEADQUARTERS"
    assert normalize_mda_name("MINSITRY OF ENERGY") == "MINISTRY OF ENERGY"


def test_truncated_and_mod_mda_canonicalization():
    mod_hq = mda_core_key("MINISTRY OF DEFENCE - MOD HQTRS")
    main_mod = mda_core_key("FEDERAL MINISTRY OF DEFENCE - MAIN MOD")
    assert mod_hq == "DEFENCE"
    assert main_mod == "DEFENCE"

    sci_trunc = mda_core_key("FEDERAL MINISTRY OF SCIENCE, TECHNOLOGY AND")
    sci_full = mda_core_key("FEDERAL MINISTRY OF SCIENCE, TECHNOLOGY AND INNOVATION")
    assert sci_trunc == "SCIENCE TECHNOLOGY AND INNOVATION"
    assert sci_full == "SCIENCE TECHNOLOGY AND INNOVATION"

    for wrapped in (
        "MINISTRY OF HUMANITARIAN AFFAIRS, DISASTER MANAGEMENT",
        "MINISTRY OF HUMANITARIAN AFFAIRS, DISASTER MANAGEMENT AND",
        "MINISTRY OF HUMANITARIAN AFFAIRS, DISASTER MANAGEMENT AND SOCIAL",
        "MINISTRY OF HUMANITARIAN AFFAIRS, DISASTER MANAGEMENT AND SOCIAL DEVELOPMENT",
    ):
        assert (
            mda_core_key(wrapped)
            == "HUMANITARIAN AFFAIRS DISASTER MANAGEMENT AND SOCIAL DEVELOPMENT"
        )


def test_canonical_contractor_and_match_key_dedups_adroit_variants():
    variants = [
        "Adroit Landstyle Limited",
        "Adroit Landstyle",
        "ADROIT - LAND STYLE LTD",
        "M/s Adroit Landstyle Ltd.",
    ]
    match_keys = {contractor_match_key(v) for v in variants}
    assert match_keys == {"ADROITLANDSTYLE"}

    assert canonical_contractor_key("M/s Julius Berger Nig. Plc.") == canonical_contractor_key(
        "Julius Berger Nigeria Plc"
    )
    assert canonical_contractor_key("MESSRS KOPEK CONSTRUCTION LIMITED") == canonical_contractor_key(
        "Kopek Construction Ltd."
    )
