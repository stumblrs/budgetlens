import os
import json
import re
import sys
import fitz # PyMuPDF

ASSET_PATTERNS = [
    (r'\b(hilux|vehicle|vehicles|bus|buses|car|cars|ambulance|patrol van|patrol vans|truck|trucks|motorcycle|motorcycles|suv|suvs|jeep|jeeps|aircraft|helicopter|boat|jet)\b', 'vehicles_mobility'),
    (r'\b(computer|computers|laptop|laptops|desktop|desktops|photocopy|photocopier|printer|printers|scanner|scanners|server|servers|ups|projector|projectors)\b', 'office_tech'),
    (r'\b(\d+(\.\d+)?\s*(km|kilometer|kilometers|metres|meters))\b|\b(road|roads|highway|highways|bridge|bridges|flyover|culvert|drainage|drainages)\b', 'road_infrastructure'),
    (r'\b(generator|generators|transformer|transformers|solar panel|solar panels|solar streetlight|solar streetlights|power plant)\b', 'power_utilities'),
    (r'\b(borehole|boreholes|water plant|water scheme|water project|water supply)\b', 'water_boreholes'),
    (r'\b(primary health|health centre|health center|hospital bed|hospital beds|dialysis|x-ray|ambulance|medical equipment|clinic)\b', 'healthcare'),
    (r'\b(classroom|classrooms|desk|desks|laboratory|laboratories|textbook|textbooks|library)\b', 'education')
]

def extract_asset_tokens(text: str, total_amount: int):
    tokens = []
    text_lower = text.lower()
    
    # Try extracting explicit quantity (e.g. "10 NO.", "5 UNITS", "15KM")
    qty = None
    qty_unit = "units"
    is_estimated = True
    
    # Matching regex like "10 NO. HILUX", "5 UNITS OF GENERATOR", "15KM ROAD"
    km_match = re.search(r'(\d+(\.\d+)?)\s*(km|kilometers|kilometer)', text_lower)
    explicit_qty_match = re.search(r'(\d+)\s*(no|nos|unit|units|pcs|pieces|sets|blocks|lots)\b', text_lower)
    
    if km_match:
        qty = float(km_match.group(1))
        qty_unit = "km"
        is_estimated = False
    elif explicit_qty_match:
        qty = int(explicit_qty_match.group(1))
        qty_unit = explicit_qty_match.group(2)
        is_estimated = False

    for pattern, category in ASSET_PATTERNS:
        if re.search(pattern, text_lower):
            tokens.append({
                "category": category,
                "itemRawName": text,
                "quantity": qty,
                "quantityUnit": qty_unit,
                "isEstimated": is_estimated,
                "totalAllocationNaira": total_amount
            })

    return tokens

class BudgetIngestionPipeline:
    def __init__(self, pdf_path: str, financial_year: int):
        self.pdf_path = pdf_path
        self.financial_year = financial_year
        self.doc = fitz.open(pdf_path)
        self.total_pages = len(self.doc)
        
    def extract_all(self, output_dir: str = None):
        if output_dir is None:
            output_dir = f'public/datasets/{self.financial_year}'
            
        os.makedirs(output_dir, exist_ok=True)
        print(f"Starting BudgetLens Ingestion Pipeline for {self.financial_year} Appropriation Bill ({self.total_pages} pages)...")
        
        projects = []
        current_mda_code = ""
        current_mda_name = ""

        for page_idx in range(self.total_pages):
            page = self.doc[page_idx]
            text = page.get_text("text")
            if "PROJECT NAME" not in text and "LINE ITEM" not in text:
                continue

            lines = [l.strip() for l in text.split("\n") if l.strip()]
            
            # Detect MDA header context on page
            for k in range(min(15, len(lines))):
                line = lines[k]
                if re.match(r'^\d{4,10}$', line) and k + 1 < len(lines):
                    next_line = lines[k+1]
                    if not next_line.isdigit() and len(next_line) > 3 and not next_line.startswith("ERGP") and not next_line.startswith("LINE"):
                        current_mda_code = line
                        current_mda_name = next_line
                        break

            # Parse ERGP Capital Projects & Line items
            j = 0
            while j < len(lines):
                line = lines[j]
                if line.startswith("ERGP") or re.match(r'^[A-Z0-9_-]{8,15}$', line) and j + 1 < len(lines) and lines[j+1].isupper():
                    code = line
                    name_parts = []
                    idx = j + 1
                    amount = 0
                    proj_type = "ONGOING"

                    while idx < len(lines):
                        cand = lines[idx]
                        if cand in ["ONGOING", "NEW"]:
                            proj_type = cand
                            break
                        clean_num = cand.replace(",", "")
                        if clean_num.isdigit() and len(clean_num) > 0:
                            amount = int(clean_num)
                            if idx + 1 < len(lines) and lines[idx+1] in ["ONGOING", "NEW"]:
                                proj_type = lines[idx+1]
                            break
                        else:
                            name_parts.append(cand)
                        idx += 1

                    project_title = " ".join(name_parts)
                    if len(project_title) > 3:
                        asset_tokens = extract_asset_tokens(project_title, amount)
                        projects.append({
                            "id": f"P-{self.financial_year}-{len(projects)+1:05d}",
                            "budgetCode": current_mda_code,
                            "projectCode": code,
                            "projectName": project_title,
                            "agency": current_mda_name,
                            "financialYear": self.financial_year,
                            "amount": amount,
                            "projectType": proj_type,
                            "page": page_idx + 1,
                            "assetTokens": asset_tokens
                        })
                    j = idx
                j += 1

        # Save minified static JSON dataset
        projects_file = os.path.join(output_dir, "projects.min.json")
        stats_file = os.path.join(output_dir, "statistics.json")

        with open(projects_file, "w", encoding="utf-8") as f:
            json.dump(projects, f, separators=(',', ':'))

        stats = {
            "financialYear": self.financial_year,
            "totalPages": self.total_pages,
            "totalCapitalProjects": len(projects),
            "totalCapitalAmount": sum(p["amount"] for p in projects),
            "sourceFile": os.path.basename(self.pdf_path)
        }

        with open(stats_file, "w", encoding="utf-8") as f:
            json.dump(stats, f, indent=2)

        print(f"\nIngestion Complete for {self.financial_year}!")
        print(f"  - Extracted Projects: {len(projects):,}")
        print(f"  - Saved to: {projects_file}")
        print(f"  - Saved stats to: {stats_file}")

if __name__ == "__main__":
    if len(sys.argv) >= 3:
        pdf_file = sys.argv[1]
        year = int(sys.argv[2])
    else:
        # Default run all available years
        tasks = [
            ("2023-Appropriation_Bill.pdf", 2023),
            ("2024 Appropriation_Bill.pdf", 2024),
            ("2025 Appropriation_Bill.pdf", 2025),
            ("2026_Appropriation_Bill.pdf", 2026)
        ]
        for pdf_file, year in tasks:
            if os.path.exists(pdf_file):
                pipeline = BudgetIngestionPipeline(pdf_file, year)
                pipeline.extract_all()
