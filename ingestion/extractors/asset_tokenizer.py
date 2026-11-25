import re

ASSET_PATTERNS = [
    (r'\b(hilux|vehicle|vehicles|bus|buses|car|cars|ambulance|patrol van|patrol vans|truck|trucks|motorcycle|motorcycles|suv|suvs|jeep|jeeps|aircraft|helicopter|boat|jet)\b', 'vehicles_mobility'),
    (r'\b(computer|computers|laptop|laptops|desktop|desktops|photocopy|photocopier|printer|printers|scanner|scanners|server|servers|ups|projector|projectors)\b', 'office_tech'),
    (r'\b(\d+(\.\d+)?\s*(km|kilometer|kilometers|metres|meters))\b|\b(road|roads|highway|highways|bridge|bridges|flyover|culvert|drainage|drainages)\b', 'road_infrastructure'),
    (r'\b(generator|generators|transformer|transformers|solar panel|solar panels|solar streetlight|solar streetlights|power plant)\b', 'power_utilities'),
    (r'\b(borehole|boreholes|water plant|water scheme|water project|water supply)\b', 'water_boreholes'),
    (r'\b(primary health|health centre|health center|hospital bed|hospital beds|dialysis|x-ray|ambulance|medical equipment|clinic)\b', 'healthcare'),
    (r'\b(classroom|classrooms|desk|desks|laboratory|laboratories|textbook|textbooks|library)\b', 'education')
]

class AssetTokenizer:
    """Stage 2: Extracts verbatim and benchmark estimated physical asset tokens from project titles."""

    @staticmethod
    def extract_asset_tokens(text: str, total_amount: int) -> list[dict]:
        tokens = []
        text_lower = text.lower()
        
        qty = None
        qty_unit = "units"
        is_estimated = True
        
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
