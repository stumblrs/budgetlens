class ForensicRules:
    """Stage 5: Rule-based risk flagging for non-specific, vague, or outlier allocations."""

    @staticmethod
    def evaluate(title: str, amount: int) -> list[dict]:
        flags = []
        text_lower = title.lower()

        # Rule 1: Vague empowerment / non-specific title
        vague_keywords = ['empowerment', 'sensitization', 'provision of items', 'miscellaneous', 'logistics', 'welfare']
        if any(kw in text_lower for kw in vague_keywords) and amount > 50000000:
            flags.append({
                "ruleId": "RULE-VAGUE-001",
                "ruleName": "Vague Empowerment & High-Cost Allocation",
                "severity": "high" if amount > 200000000 else "medium",
                "confidence": 0.88,
                "reason": f"Allocation of ₦{amount:,} contains non-specific terms ('empowerment/logistics') without clear asset deliverables."
            })

        # Rule 2: Outlier single project cost (> ₦5 Billion)
        if amount >= 5000000000:
            flags.append({
                "ruleId": "RULE-OUTLIER-002",
                "ruleName": "Mega Capital Outlier Project",
                "severity": "high",
                "confidence": 0.95,
                "reason": f"Single project allocation of ₦{amount/1e9:.2f} Billion is significantly above typical agency project baseline."
            })

        return flags
