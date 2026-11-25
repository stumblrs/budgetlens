"""
Structured prompt templates for Gemma analyst jobs (Line-item analysis & Narrative extraction).

Design principles:
  - Every prompt enforces JSON-only output (no prose, no explanation)
  - Persona: Senior Nigerian government budget analyst
  - Temperature is 0.0 at the model level for determinism
  - Max tokens are capped per job to avoid runaway generation
"""


def build_narrative_extraction_prompt(filename: str, text_excerpt: str, year: int) -> str:
    """
    Extracts macroeconomic targets, fiscal aggregates, and policy priorities from narrative PDFs.
    Max tokens: 350
    """
    return f"""<start_of_turn>user
You are a senior Nigerian government budget analyst. Extract macroeconomic framework benchmarks and key policy commitments from this budget document excerpt ({filename}, Year {year}).
Respond ONLY with valid JSON. No explanation. No prose.

Document Excerpt:
{text_excerpt[:3000]}

Respond with this exact JSON structure:
{{
  "benchmarkOilPriceUSD": <number or null>,
  "dailyOilProductionMBPD": <number or null>,
  "exchangeRateNairaPerUSD": <number or null>,
  "projectedGdpGrowthPercent": <number or null>,
  "policyPriorities": ["Priority 1", "Priority 2", "Priority 3"],
  "executiveSummary": "<concise 2-sentence summary of the document's core message>"
}}
<end_of_turn>
<start_of_turn>model
"""


def _format_naira(amount: int) -> str:
    if amount >= 1e12:
        return f"₦{amount / 1e12:.2f} Trillion"
    if amount >= 1e9:
        return f"₦{amount / 1e9:.2f} Billion"
    if amount >= 1e6:
        return f"₦{amount / 1e6:.2f} Million"
    return f"₦{amount:,}"


def build_classify_prompt(record: dict) -> str:
    """
    Job 1 — Classify the record into a primary category and subcategory.
    Max tokens: 120
    """
    title = record.get("projectName", "")
    agency = record.get("agency", "")
    amount = _format_naira(record.get("amount", 0))
    year = record.get("financialYear", "")

    return f"""<start_of_turn>user
You are a senior Nigerian government budget analyst. Classify the following budget line item.
Respond ONLY with valid JSON. No explanation. No prose.

Budget record:
Title: {title}
Agency: {agency}
Amount: {amount}
Year: {year}

Respond with this exact JSON structure:
{{
  "primaryCategory": "<one of: Vehicles & Transport | ICT & Equipment | Construction & Infrastructure | Personnel & Welfare | Consultancy & Services | Agricultural & Food | Health & Medical | Education & Training | Security & Defence | Unclassified>",
  "subCategory": "<specific sub-type, e.g. Operational Pickup Trucks>",
  "confidence": <0.0 to 1.0>
}}
<end_of_turn>
<start_of_turn>model
"""


def build_normalize_prompt(record: dict) -> str:
    """
    Job 2 — Normalize dirty/truncated/abbreviated title and agency name.
    Max tokens: 200
    """
    title = record.get("projectName", "")
    agency = record.get("agency", "")

    return f"""<start_of_turn>user
You are a senior Nigerian government budget analyst. Normalize the following budget record fields.
Expand acronyms. Fix truncation. Standardize agency names.
Respond ONLY with valid JSON. No explanation.

Original title: {title}
Original agency: {agency}

Respond with this exact JSON structure:
{{
  "normalizedTitle": "<clean, complete project title>",
  "cleanedAgencyName": "<full expanded agency name>",
  "wasNormalized": <true | false>,
  "normalizationNotes": "<brief note on what was changed, or empty string>"
}}
<end_of_turn>
<start_of_turn>model
"""


def build_tag_prompt(record: dict, category: str) -> str:
    """
    Job 3 — Suggest forensic tags and risk labels.
    Max tokens: 200
    """
    title = record.get("projectName", "")
    agency = record.get("agency", "")
    amount = _format_naira(record.get("amount", 0))

    return f"""<start_of_turn>user
You are a senior Nigerian government budget analyst specializing in forensic budget review.
Suggest relevant tags for this budget allocation.
Respond ONLY with valid JSON.

Title: {title}
Agency: {agency}
Amount: {amount}
Category: {category}

Choose tags ONLY from this list:
HIGH_COST_VEHICLE, REPEAT_PROCUREMENT, MEGA_OUTLIER, VAGUE_DELIVERABLE,
HIGH_RENOVATION_COST, POSSIBLE_DUPLICATE, NEEDS_TENDER_VERIFICATION,
PERSONNEL_WELFARE, AUDIT_REQUIRED, CONSTRUCTION_CONTRACT, FOREIGN_LOAN,
SOCIAL_INVESTMENT, NORMAL_ALLOCATION

Respond with:
{{
  "suggestedTags": ["TAG1", "TAG2"],
  "tagRationale": "<one sentence explaining tag choices>"
}}
<end_of_turn>
<start_of_turn>model
"""


def build_ambiguity_prompt(record: dict, tags: list) -> str:
    """
    Job 4 — Detect vague, ambiguous, or red-flag allocations.
    Max tokens: 200
    """
    title = record.get("projectName", "")
    amount = _format_naira(record.get("amount", 0))

    return f"""<start_of_turn>user
You are a senior Nigerian government budget analyst. Assess whether this allocation is ambiguous or suspicious.
Respond ONLY with valid JSON.

Title: {title}
Amount: {amount}
Tags already identified: {tags}

Respond with:
{{
  "isAmbiguous": <true | false>,
  "ambiguityType": "<one of: VAGUE_DELIVERABLE | INFLATED_COST | NON_SPECIFIC_TITLE | CLEAR | SUSPICIOUS_NAMING>",
  "riskLevel": "<LOW | MEDIUM | HIGH | CRITICAL>",
  "ambiguityDetail": "<one sentence description, or empty string if not ambiguous>"
}}
<end_of_turn>
<start_of_turn>model
"""


def build_rules_prompt(record: dict, tags: list, risk_level: str) -> str:
    """
    Job 5 — Suggest which forensic rules should be applied.
    Max tokens: 200
    """
    title = record.get("projectName", "")
    amount = _format_naira(record.get("amount", 0))

    return f"""<start_of_turn>user
You are a senior Nigerian government budget analyst. Recommend which forensic rules to apply.
Respond ONLY with valid JSON.

Title: {title}
Amount: {amount}
Tags: {tags}
Risk Level: {risk_level}

Available rules:
RULE-VAGUE-001: Vague Empowerment & High-Cost Allocation
RULE-OUTLIER-002: Mega Capital Outlier Project (>₦5B)
RULE-REPEAT-003: Repeat Procurement Within Asset Lifespan
RULE-RENOVATION-004: Excessive Renovation Expenditure
RULE-VEHICLE-005: High Vehicle Procurement (non-transport agency)
RULE-CONSULT-006: Excessive Consultancy Spend

Respond with:
{{
  "applicableRules": [
    {{"ruleId": "RULE-VAGUE-001", "applicabilityScore": 0.95}},
    {{"ruleId": "RULE-OUTLIER-002", "applicabilityScore": 0.71}}
  ]
}}
Return only rules with applicabilityScore >= 0.60. Return empty array if none apply.
<end_of_turn>
<start_of_turn>model
"""


def build_rationale_prompt(record: dict, category: str, tags: list,
                           risk_level: str, is_ambiguous: bool) -> str:
    """
    Job 6 — Generate a concise analytical rationale synthesizing all findings.
    Max tokens: 250
    """
    title = record.get("projectName", "")
    agency = record.get("agency", "")
    amount = _format_naira(record.get("amount", 0))
    year = record.get("financialYear", "")

    return f"""<start_of_turn>user
You are a senior Nigerian government budget analyst writing an evidence summary.
Write ONE concise analytical sentence (max 60 words) about this budget allocation.
Be specific. Mention agency, amount, and the key concern. Do not use generic phrases.
Respond ONLY with a JSON object.

Title: {title}
Agency: {agency}
Amount: {amount}
Year: {year}
Category: {category}
Risk Level: {risk_level}
Ambiguous: {is_ambiguous}
Tags: {tags}

Respond with:
{{
  "rationale": "<your analytical sentence here>"
}}
<end_of_turn>
<start_of_turn>model
"""


def build_geographic_prompt(record: dict) -> str:
    """
    Job 7 — Extract hyper-local Nigerian location metadata.
    Max tokens: 180
    """
    title = record.get("projectName", "")
    agency = record.get("agency", "")

    return f"""<start_of_turn>user
You are a senior Nigerian government geography analyst. Extract location details from this budget record.
Respond ONLY with valid JSON.

Title: {title}
Agency: {agency}

Respond with:
{{
  "state": "<State name e.g. Borno, Lagos, Kaduna, FCT, or Nationwide>",
  "lga": "<Local Government Area name, or Nationwide>",
  "townOrCity": "<Town name or empty string>",
  "geopoliticalZone": "<North-West | North-East | North-Central | South-West | South-South | South-East | FCT | Nationwide>",
  "senatorialDistrict": "<Senatorial District if mentioned, or empty string>",
  "isZonalIntervention": <true | false>
}}
<end_of_turn>
<start_of_turn>model
"""


def build_citizen_impact_prompt(record: dict, category: str, location: dict) -> str:
    """
    Job 8 — Generate citizen impact, audit questions, opportunity costs, and FOI templates.
    Max tokens: 280
    """
    title = record.get("projectName", "")
    agency = record.get("agency", "")
    amount = _format_naira(record.get("amount", 0))
    year = record.get("financialYear", "")

    return f"""<start_of_turn>user
You are a forensic public auditor empowering citizens. Analyze this budget line item for real-world citizen monitoring.
Respond ONLY with valid JSON.

Title: {title}
Agency: {agency}
Amount: {amount}
Year: {year}
Category: {category}
Location: {location.get('state', '')}, {location.get('lga', '')}

Respond with:
{{
  "sdgGoal": "<e.g. SDG 3: Good Health & Well-being | SDG 4: Quality Education | SDG 6: Clean Water | SDG 7: Affordable & Clean Energy | SDG 9: Industry & Infrastructure | SDG 16: Peace & Justice | SDG 17: Partnerships>",
  "assetType": "<Vehicles | Machinery | Computers & IT | Office Buildings | Feeder Roads | Water Boreholes | Empowerment Kits | None>",
  "expectedLifespanYears": <number or null>,
  "anomalyScore": <0 to 100 integer rating>,
  "bppThresholdNearMiss": <true | false>,
  "auditQuestion": "<One specific physical question a local citizen should ask when visiting the site>",
  "opportunityCostText": "<Relatable equivalent e.g. Equivalent to equipping 12 primary health centers>",
  "foiSubjectLine": "<Pre-formatted FOI request subject line under FOI Act 2011>",
  "fieldChecklist": [
    "<Physical verification item 1>",
    "<Physical verification item 2>",
    "<Physical verification item 3>"
  ]
}}
<end_of_turn>
<start_of_turn>model
"""

