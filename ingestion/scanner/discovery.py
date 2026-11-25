import os
import re
from dataclasses import dataclass
from typing import List, Tuple

# Document types
DOC_TYPE_LINE_ITEMS = "LINE_ITEMS"
DOC_TYPE_NARRATIVE = "NARRATIVE"

# Document legislative roles
ROLE_PRIMARY_ENACTED = "PRIMARY_ENACTED"
ROLE_SUPPLEMENTARY = "SUPPLEMENTARY_OR_AMENDMENT"
ROLE_PROPOSAL_BILL = "PROPOSAL_BILL"
ROLE_REPEAL_BILL = "REPEAL_BILL"
ROLE_DUPLICATE_SKIP = "DUPLICATE_SKIP"
ROLE_NARRATIVE = "NARRATIVE"


@dataclass
class DiscoveredFile:
    """Represents a single PDF file discovered in the source_pdfs directory."""
    path: str               # Absolute path to the PDF
    year: int               # Financial year (from parent folder name)
    filename: str           # Base filename
    size_bytes: int         # File size
    doc_type: str = DOC_TYPE_LINE_ITEMS  # LINE_ITEMS or NARRATIVE
    doc_role: str = ROLE_PRIMARY_ENACTED


@dataclass
class YearGroup:
    """All PDF files belonging to a single financial year."""
    year: int
    files: List[DiscoveredFile]


class DiscoveryEngine:
    """
    Walks the source_pdfs/ directory, finds all 4-digit year folders,
    collects all .pdf files within each, and classifies them into LINE_ITEMS or NARRATIVE.
    """

    YEAR_PATTERN = re.compile(r'^\d{4}$')

    NARRATIVE_KEYWORDS = [
        "speech", "mtef", "mteffsp", "fsp", "citizen", "guide", "framework",
        "implementation", "finance act", "presentation", "overview", "circular",
        "highlights", "proposal"
    ]

    def __init__(self, source_root: str = "source_pdfs"):
        self.source_root = os.path.abspath(source_root)

    def classify_document(self, filename: str) -> str:
        """Classifies document based on filename patterns."""
        fn_lower = filename.lower()
        if any(kw in fn_lower for kw in self.NARRATIVE_KEYWORDS):
            return DOC_TYPE_NARRATIVE
        return DOC_TYPE_LINE_ITEMS

    def classify_role(self, filename: str, doc_type: str) -> str:
        """Classifies the legislative/budget role of a PDF to avoid summing competing drafts."""
        if doc_type == DOC_TYPE_NARRATIVE:
            return ROLE_NARRATIVE
        fn_lower = filename.lower()
        if (
            "duplicate listing" in fn_lower
            or "removed from" in fn_lower
            or fn_lower.startswith("page ")
            or "table of content" in fn_lower
        ):
            return ROLE_DUPLICATE_SKIP
        if "repeal" in fn_lower:
            return ROLE_REPEAL_BILL
        if "supplementary" in fn_lower or "amendment" in fn_lower or "goes" in fn_lower or "nddc" in fn_lower:
            return ROLE_SUPPLEMENTARY
        if (
            "proposal" in fn_lower
            or "proposed" in fn_lower
            or ("bill" in fn_lower and "act" not in fn_lower and "as passed" not in fn_lower)
        ):
            return ROLE_PROPOSAL_BILL
        return ROLE_PRIMARY_ENACTED

    def scan(self) -> List[YearGroup]:
        """
        Performs a full scan of source_root and returns a list of YearGroups.
        Returns groups sorted by year ascending.
        """
        if not os.path.exists(self.source_root):
            raise FileNotFoundError(
                f"Source PDF directory not found: {self.source_root}\n"
                f"Create the folder and place your PDF year folders inside it."
            )

        year_groups: List[YearGroup] = []

        for entry in sorted(os.scandir(self.source_root), key=lambda e: e.name):
            if not entry.is_dir():
                continue
            if not self.YEAR_PATTERN.match(entry.name):
                continue

            year = int(entry.name)
            pdf_files: List[DiscoveredFile] = []

            for file_entry in sorted(os.scandir(entry.path), key=lambda e: e.name):
                if not file_entry.is_file():
                    continue
                if not file_entry.name.lower().endswith('.pdf'):
                    continue

                doc_type = self.classify_document(file_entry.name)
                doc_role = self.classify_role(file_entry.name, doc_type)
                pdf_files.append(DiscoveredFile(
                    path=file_entry.path,
                    year=year,
                    filename=file_entry.name,
                    size_bytes=file_entry.stat().st_size,
                    doc_type=doc_type,
                    doc_role=doc_role
                ))

            if pdf_files:
                year_groups.append(YearGroup(year=year, files=pdf_files))
            else:
                print(f"  [WARN] Year folder '{entry.name}' contains no PDF files -- skipping.")

        return sorted(year_groups, key=lambda g: g.year)

    def print_scan_summary(self, year_groups: List[YearGroup]) -> None:
        """Prints a human-readable scan summary to the terminal."""
        total_files = sum(len(g.files) for g in year_groups)
        total_size_mb = sum(f.size_bytes for g in year_groups for f in g.files) / (1024 * 1024)
        total_narratives = sum(1 for g in year_groups for f in g.files if f.doc_type == DOC_TYPE_NARRATIVE)
        total_tables = total_files - total_narratives

        print(f"\n  Source Directory: {self.source_root}")
        print(f"  Found: {len(year_groups)} year folder(s), {total_files} PDF file(s) "
              f"({total_size_mb:.1f} MB total)")
        print(f"  Types: {total_tables} Line-Item Table PDFs, {total_narratives} Policy Narrative PDFs")

        for group in year_groups:
            print(f"\n  YEAR {group.year}")
            for f in group.files:
                size_mb = f.size_bytes / (1024 * 1024)
                type_tag = "[NARRATIVE]" if f.doc_type == DOC_TYPE_NARRATIVE else "[TABLE]"
                print(f"  |-- {f.filename:<50}  {type_tag:<11} ({size_mb:.1f} MB)")
