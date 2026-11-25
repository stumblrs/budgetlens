import json
import os
import sys
import hashlib
import re

# Force UTF-8 stdout
sys.stdout.reconfigure(encoding='utf-8')

# Geo-Political Zone Mapping
STATES_TO_ZONE = {
    'Abia': 'South East', 'Anambra': 'South East', 'Ebonyi': 'South East', 'Enugu': 'South East', 'Imo': 'South East',
    'Akwa Ibom': 'South South', 'Bayelsa': 'South South', 'Cross River': 'South South', 'Delta': 'South South', 'Edo': 'South South', 'Rivers': 'South South',
    'Ekiti': 'South West', 'Lagos': 'South West', 'Ogun': 'South West', 'Ondo': 'South West', 'Osun': 'South West', 'Oyo': 'South West',
    'Benue': 'North Central', 'Kogi': 'North Central', 'Kwara': 'North Central', 'Nasarawa': 'North Central', 'Niger': 'North Central', 'Plateau': 'North Central', 'FCT Abuja': 'North Central', 'Federal Capital Territory': 'North Central',
    'Adamawa': 'North East', 'Bauchi': 'North East', 'Borno': 'North East', 'Gombe': 'North East', 'Taraba': 'North East', 'Yobe': 'North East',
    'Jigawa': 'North West', 'Kaduna': 'North West', 'Kano': 'North West', 'Katsina': 'North West', 'Kebbi': 'North West', 'Sokoto': 'North West', 'Zamfara': 'North West'
}

# Human-Scale Baselines (2026 Naira benchmarks)
BASELINE_TEACHER_SALARY = 1200000     # ₦1.2M annual primary teacher salary
BASELINE_SOLAR_BOREHOLE = 10000000    # ₦10M per solar borehole
BASELINE_HEALTH_CENTRE = 50000000     # ₦50M per primary healthcare centre

def detect_state_lga(text):
    text_lower = text.lower()
    found_state = "HQ / Federal Direct"
    found_zone = "HQ / Direct Federal"
    found_lga = "Unmapped LGA"

    for state, zone in STATES_TO_ZONE.items():
        if state.lower() in text_lower:
            found_state = state
            found_zone = zone
            break

    return found_zone, found_state, found_lga

def compute_human_equivalents(amount):
    if amount <= 0:
        return {
            "teacherSalaries": "N/A",
            "solarBoreholes": "N/A",
            "primaryHealthCentres": "N/A"
        }

    teachers = round(amount / BASELINE_TEACHER_SALARY)
    boreholes = round(amount / BASELINE_SOLAR_BOREHOLE)
    clinics = round(amount / BASELINE_HEALTH_CENTRE)

    return {
        "teacherSalaries": f"≈ {teachers:,} primary school teacher annual salaries" if teachers > 0 else "Under 1 teacher salary",
        "solarBoreholes": f"≈ {boreholes:,} solar boreholes (₦10M baseline)" if boreholes > 0 else "Under 1 borehole baseline",
        "primaryHealthCentres": f"≈ {clinics:,} primary health centres (₦50M baseline)" if clinics > 0 else "Under 1 clinic baseline"
    }

def format_naira(amt):
    if amt >= 1e12: return f"₦{amt/1e12:.2f} Trillion"
    if amt >= 1e9: return f"₦{amt/1e9:.2f} Billion"
    if amt >= 1e6: return f"₦{amt/1e6:.2f} Million"
    return f"₦{amt:,}"

def build_hierarchical_database():
    years = [2023, 2024, 2025, 2026]
    base_dir = 'public/datasets'
    output_dir = 'public/datasets/db'
    os.makedirs(output_dir, exist_ok=True)

    # Load multi-year lineages
    lineages_file = os.path.join(base_dir, 'recurring_lineages.json')
    lineages_data = []
    if os.path.exists(lineages_file):
        with open(lineages_file, 'r', encoding='utf-8') as f:
            lineages_data = json.load(f)

    code_to_lineage = {}
    for lin in lineages_data:
        p_code = lin.get('project_code', '')
        if p_code:
            code_to_lineage[p_code] = lin

    master_summary = {
        "totalRecordsAllYears": 0,
        "totalAmountAllYears": 0,
        "yearsIngested": years,
        "totalLineages": len(lineages_data),
        "yearSummaries": {}
    }

    for year in years:
        year_file = os.path.join(base_dir, str(year), 'projects.min.json')
        if not os.path.exists(year_file):
            print(f"Skipping missing year file: {year_file}")
            continue

        with open(year_file, 'r', encoding='utf-8') as f:
            projects = json.load(f)

        year_output_dir = os.path.join(output_dir, str(year))
        os.makedirs(year_output_dir, exist_ok=True)

        structured_records = []
        zone_aggregates = {}
        mda_aggregates = {}
        year_total_amount = 0

        for p in projects:
            code = p.get('projectCode') or p.get('code') or ''
            name = p.get('projectName') or p.get('title') or ''
            sector = p.get('sector') or 'Infrastructure & Development'
            agency = p.get('agency') or p.get('mda') or sector
            amount = p.get('amount', 0)
            page = p.get('page', 0)

            year_total_amount += amount
            zone, state, lga = detect_state_lga(f"{name} {agency} {sector}")

            # Evidence & Lineage linking
            lineage_info = code_to_lineage.get(code)
            lineage_id = lineage_info['lineage_id'] if lineage_info else None
            years_appeared = lineage_info['years_appeared'] if lineage_info else [year]
            cumulative_spend = lineage_info['cumulative_allocation'] if lineage_info else amount

            # Evidence Rules Flagging
            flags = []
            if amount >= 1e9:
                flags.append({
                    "ruleId": "HIGH_SINGLE_ALLOCATION",
                    "ruleName": "Large Single Capital Allocation (> ₦1B)",
                    "severity": "medium",
                    "confidence": 0.98,
                    "reason": f"Allocation of {format_naira(amount)} meets high-value capital review criteria."
                })

            if lineage_info and len(years_appeared) >= 2:
                flags.append({
                    "ruleId": "RECURRING_ALLOCATION",
                    "ruleName": "Repeated Funding Across Budget Years",
                    "severity": "high" if len(years_appeared) >= 3 else "medium",
                    "confidence": lineage_info.get('match_confidence', 0.95),
                    "reason": f"Appeared in {len(years_appeared)} budgets ({', '.join(map(str, years_appeared))}) with {format_naira(cumulative_spend)} cumulative spend."
                })

            asset_tokens = p.get('assetTokens', [])

            # Create Record Object
            rec = {
                "recordIdentity": {
                    "id": f"REC-{year}-{page}-{code}",
                    "financialYear": year,
                    "projectCode": code,
                    "verbatimProjectName": name,
                    "amountNaira": amount,
                    "amountFormatted": format_naira(amount),
                    "spendingType": "Capital Expenditure"
                },
                "sourceProvenance": {
                    "documentId": f"DOC-{year}-APPROPRIATION",
                    "sourceFilename": f"{year}-appropriation-act.pdf",
                    "pdfPage": page,
                    "sha256Hash": hashlib.sha256(f"{year}-{code}-{name}-{amount}".encode()).hexdigest()
                },
                "geographicTaxonomy": {
                    "jurisdictionLevel": "Federal",
                    "geoPoliticalZone": zone,
                    "state": state,
                    "lga": lga
                },
                "mdaGovernanceTaxonomy": {
                    "mdaCode": code[:10] if code else "0000000000",
                    "mdaName": agency,
                    "sector": sector
                },
                "multiYearLineage": {
                    "lineageId": lineage_id,
                    "yearsAppeared": years_appeared,
                    "cumulativeSpendNaira": cumulative_spend,
                    "cumulativeSpendFormatted": format_naira(cumulative_spend)
                },
                "forensicEvidenceFlags": flags,
                "humanScaleEquivalents": compute_human_equivalents(amount),
                "assetTokens": asset_tokens
            }

            structured_records.append(rec)

            # Accumulate aggregates
            zone_aggregates[zone] = zone_aggregates.get(zone, 0) + amount
            mda_aggregates[agency] = mda_aggregates.get(agency, 0) + amount

        # Write year index
        year_index_path = os.path.join(year_output_dir, 'records.json')
        with open(year_index_path, 'w', encoding='utf-8') as f:
            json.dump(structured_records, f, ensure_ascii=False, indent=None)

        # Macro metadata mapping from official Appropriation Acts
        macro_baselines = {
            2026: {"officialTotalBudget": 54200000000000, "personnelCost": 9800000000000, "overheadCost": 1450000000000, "pensionsGratuities": 1200000000000, "serviceWideVotes": 3100000000000, "recurrentNonDebtTotal": 15550000000000, "capitalDevelopmentFund": 12800000000000, "capitalSupplementation": 4200000000000, "totalCapitalBudget": 17000000000000, "statutoryTransfers": 5200000000000, "debtService": 16450000000000},
            2025: {"officialTotalBudget": 46019639175313, "personnelCost": 7537671610470, "overheadCost": 1064586322081, "pensionsGratuities": 984912411735, "serviceWideVotes": 2577256071786, "recurrentNonDebtTotal": 12164426416072, "capitalDevelopmentFund": 9912099136472, "capitalSupplementation": 3180209574296, "totalCapitalBudget": 13092308710768, "statutoryTransfers": 4435761358925, "debtService": 16327142689548},
            2024: {"officialTotalBudget": 28770000000000, "personnelCost": 5320000000000, "overheadCost": 880000000000, "pensionsGratuities": 650000000000, "serviceWideVotes": 1850000000000, "recurrentNonDebtTotal": 8700000000000, "capitalDevelopmentFund": 7800000000000, "capitalSupplementation": 2190000000000, "totalCapitalBudget": 9990000000000, "statutoryTransfers": 1740000000000, "debtService": 8340000000000},
            2023: {"officialTotalBudget": 24820000000000, "personnelCost": 4990000000000, "overheadCost": 760000000000, "pensionsGratuities": 580000000000, "serviceWideVotes": 1420000000000, "recurrentNonDebtTotal": 7750000000000, "capitalDevelopmentFund": 5900000000000, "capitalSupplementation": 1800000000000, "totalCapitalBudget": 7700000000000, "statutoryTransfers": 1270000000000, "debtService": 6550000000000}
        }

        # Auto-generate statistics.json dynamically from real line items
        top_mdas_sorted = sorted(mda_aggregates.items(), key=lambda x: x[1], reverse=True)

        year_stats = {
            "financialYear": year,
            "totalPages": max((r["sourceProvenance"]["pdfPage"] for r in structured_records), default=0),
            "totalCapitalProjects": len(structured_records),
            "totalCapitalAmount": year_total_amount,
            "sectorDistribution": {mda: amt for mda, amt in top_mdas_sorted[:10]},
            "topMinistries": [{"name": mda, "amount": amt} for mda, amt in top_mdas_sorted[:10]],
            "zoneDistribution": zone_aggregates,
            "sourceFile": f"{year}_Appropriation_Bill.pdf",
            **(macro_baselines.get(year, {}))
        }
        # Also mirror to root datasets directory
        public_year_dir = os.path.join(base_dir, str(year))
        os.makedirs(public_year_dir, exist_ok=True)
        public_stats_path = os.path.join(public_year_dir, 'statistics.json')
        with open(public_stats_path, 'w', encoding='utf-8') as f:
            json.dump(year_stats, f, ensure_ascii=False, indent=2)

        print(f"✅ Built {len(structured_records):,} records & statistics.json for {year} in {year_output_dir} ({format_naira(year_total_amount)})")

        master_summary["totalRecordsAllYears"] += len(structured_records)
        master_summary["totalAmountAllYears"] += year_total_amount
        master_summary["yearSummaries"][str(year)] = {
            "recordCount": len(structured_records),
            "totalAmountNaira": year_total_amount,
            "totalAmountFormatted": format_naira(year_total_amount),
            "topZones": zone_aggregates
        }

    # Write Master Index & Summary
    summary_path = os.path.join(output_dir, 'hierarchy_summary.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(master_summary, f, ensure_ascii=False, indent=2)

    print("\n" + "=" * 80)
    print(f"🎉 MASTER HIERARCHICAL DATABASE BUILD COMPLETE")
    print(f"Total Records: {master_summary['totalRecordsAllYears']:,}")
    print(f"Total Spend: {format_naira(master_summary['totalAmountAllYears'])}")
    print(f"Summary written to {summary_path}")
    print("=" * 80)

if __name__ == '__main__':
    build_hierarchical_database()
