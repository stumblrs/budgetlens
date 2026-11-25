# Pending External Data Ingestion Reminder

> **Goal:** All four external datasets (`bir_pdfs`, `policy_pdfs`, `NocopoJson`, and `govspend_data`) are now downloaded on disk and ready for parsing and ingestion.
> **Sequenced Plan:** See [EXTERNAL_DATA_INGESTION_PLAN.md](file:///c:/Users/lol/Downloads/Projetcs/buget_lens/EXTERNAL_DATA_INGESTION_PLAN.md) for the full 5-stage pre-ingestion fixes, schema alignment, and verification gates (`Stage 0` -> `Stage 4`).

## Datasets Already Downloaded & Ready on Disk
1. **Budget Implementation Reports (BIR PDFs):** `bir_pdfs/<year>/` (`59` valid PDFs across `2009–2026`, `63` listed in `bir_pdfs/manifest.json`; `4` server-side 404/non-PDFs skipped)
2. **Budget Office Policy Documents:** `policy_pdfs/` (`36` valid PDFs out of `37` listed in `policy_pdfs/manifest.json`)
3. **NOCOPO (BPP OCDS 1.1):** `NocopoJson/Nocopo_Json_all27951.json` (`219,973,019` bytes)
4. **GovSpend.ng Expenditures:** `govspend_data/govspend_all.csv` & `govspend_data/govspend_all.jsonl` (`467,780` unique rows)

## Next Steps When Ready
1. Parse the downloaded BIR PDFs in `bir_pdfs/<year>/`:
   ```powershell
   .venv\Scripts\python.exe -m ingestion.parsers.bir_parser
   ```
2. Run the NOCOPO / procurement connector against `NocopoJson/` to populate `public/datasets/procurement_links.json`:
   ```powershell
   .venv\Scripts\python.exe -m ingestion.parsers.nocopo_connector
   ```
3. *(Optional)* Map/ingest `govspend_data/govspend_all.jsonl` into the Execution & Contracts explorer (`?tab=execution`) and wire `policy_pdfs/` if needed.
