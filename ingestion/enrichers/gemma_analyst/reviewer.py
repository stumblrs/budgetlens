import json
from typing import List


def run_review_checkpoint(flagged_records: List[dict], output_path: str) -> List[dict]:
    """
    Interactive CLI review checkpoint for high-risk Gemma-flagged records.

    After Gemma processes all records for a year, this surfaces the records
    where riskLevel = HIGH or CRITICAL for human review before evidence objects
    are finalised.

    Actions per record:
      [A] Accept — Use Gemma's tags and rationale as-is
      [E] Edit   — Manually override rationale or tags
      [S] Skip   — Dismiss this flag, don't apply Gemma's review
      [Q] Quit   — Save progress and exit (can resume later)

    Returns the reviewed list of records with developerDecision populated.
    """

    reviewed = []
    total = len(flagged_records)

    if total == 0:
        print("\n  ✓ No high-risk records require human review.")
        return []

    print(f"\n{'=' * 66}")
    print(f"  Budget Lens — Gemma Review Checkpoint")
    print(f"  High-risk records requiring your attention: {total}")
    print(f"  [A]ccept  [E]dit  [S]kip  [Q]uit & save progress")
    print(f"{'=' * 66}\n")

    for i, record in enumerate(flagged_records, 1):
        ri = record.get("recordIdentity", {})
        gemma = record.get("gemmaReview", {})
        ambiguity = gemma.get("ambiguityDetection", {})

        print(f"  Record {i} of {total}")
        print(f"  {'─' * 60}")
        print(f"  Title  : {ri.get('verbatimProjectName', 'N/A')[:80]}")
        print(f"  Agency : {ri.get('mdaName', 'N/A') if 'mdaName' in ri else record.get('agency','N/A')}")
        print(f"  Amount : {ri.get('amountFormatted', 'N/A')}")
        print(f"  Year   : {ri.get('financialYear', 'N/A')}")
        print(f"\n  Gemma Says:")
        print(f"    Category  : {gemma.get('category', {}).get('primaryCategory', 'N/A')}")
        print(f"    Risk      : {ambiguity.get('riskLevel', 'N/A')}")
        print(f"    Tags      : {gemma.get('forensicTags', [])}")
        print(f"    Rationale : {gemma.get('rationale', 'N/A')[:120]}")
        print()

        while True:
            choice = input("  Your Decision [A/E/S/Q]: ").strip().upper()

            if choice == "A":
                record["gemmaReview"]["developerDecision"] = "ACCEPTED"
                record["gemmaReview"]["developerNote"] = ""
                reviewed.append(record)
                break

            elif choice == "E":
                note = input("  Override note (press Enter to skip): ").strip()
                record["gemmaReview"]["developerDecision"] = "EDITED"
                record["gemmaReview"]["developerNote"] = note
                reviewed.append(record)
                break

            elif choice == "S":
                record["gemmaReview"]["developerDecision"] = "SKIPPED"
                record["gemmaReview"]["developerNote"] = ""
                # Don't add to reviewed — dismissed
                break

            elif choice == "Q":
                print(f"\n  Progress saved. {i - 1} of {total} reviewed.")
                print(f"  Resume with: python -m ingestion.cli --review\n")
                _save_progress(reviewed + [record], output_path)
                return reviewed

            else:
                print("  Invalid input. Enter A, E, S, or Q.")

        print()

    print(f"\n{'=' * 66}")
    print(f"  Review complete. {len(reviewed)} records accepted/edited.")
    print(f"  {total - len(reviewed)} records skipped.")
    print(f"{'=' * 66}\n")

    _save_progress(reviewed, output_path)
    return reviewed


def _save_progress(reviewed: List[dict], output_path: str) -> None:
    """Saves reviewed records to a JSON file for the rule engine."""
    with open(output_path, "w", encoding="utf-8") as f:
        json.dump(reviewed, f, indent=2)
