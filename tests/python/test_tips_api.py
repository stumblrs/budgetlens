"""Backend tests for Citizen Field Verification & Photo Evidence Router (/api/tips)."""

from __future__ import annotations

import io
import os
from pathlib import Path

from fastapi.testclient import TestClient
from PIL import Image

from backend.main import app


def _make_jpeg_with_gps_exif() -> bytes:
    """Create a synthetic JPEG carrying GPS EXIF tags to verify server-side scrubbing."""
    img = Image.new("RGB", (64, 64), color=(12, 118, 90))
    exif = Image.Exif()
    # Standard EXIF tags: Make (0x010F), Model (0x0110), GPSInfo (0x8825)
    exif[0x010F] = "SecretPhoneCorp"
    exif[0x0110] = "Tracker-9000"
    exif[0x8825] = {1: "N", 2: (9.0, 4.0, 36.0)}
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif.tobytes())
    return buf.getvalue()


def test_tips_lifecycle_exif_scrub_and_security(tmp_path: Path, monkeypatch) -> None:
    db_path = tmp_path / "tips_test.sqlite"
    photos_dir = tmp_path / "tip_photos"
    monkeypatch.setenv("BUDGETLENS_TIPS_DB", str(db_path))
    monkeypatch.setenv("BUDGETLENS_TIPS_PHOTOS_DIR", str(photos_dir))
    monkeypatch.setenv("BUDGETLENS_ADMIN_KEY", "test-secret-admin-key")
    monkeypatch.setenv("BUDGETLENS_RATE_LIMIT_MAX", "50")

    client = TestClient(app)

    # 1. Reject fake disguised payload (.exe/text disguised as .jpg)
    bad_resp = client.post(
        "/api/tips",
        data={
            "project_id": "proj-1",
            "financial_year": "2024",
            "status": "NOT_ON_GROUND",
            "observation": "Visited the primary health center coordinate; only bushland found.",
        },
        files=[("photos", ("disguised.jpg", b"MZ\x90\x00not-a-real-jpeg", "image/jpeg"))],
    )
    assert bad_resp.status_code == 400
    assert "magic bytes" in bad_resp.json()["detail"].lower()

    # 2. Reject invalid status & >3 photos
    jpeg_bytes = _make_jpeg_with_gps_exif()
    too_many_resp = client.post(
        "/api/tips",
        data={
            "project_id": "proj-1",
            "financial_year": "2024",
            "status": "NOT_ON_GROUND",
            "observation": "Four photos test — should fail cap cleanly.",
        },
        files=[("photos", (f"p{i}.jpg", jpeg_bytes, "image/jpeg")) for i in range(4)],
    )
    assert too_many_resp.status_code == 400
    assert "maximum 3" in too_many_resp.json()["detail"].lower()

    # 3. Valid tip with EXIF GPS JPEG
    ok_resp = client.post(
        "/api/tips",
        data={
            "project_id": "proj-2024-99",
            "financial_year": "2024",
            "project_code": "ERGP2024001",
            "state": "Kaduna",
            "lga": "Chikun",
            "status": "ABANDONED_SITE",
            "observation": "Excavation trench left open since Q1 without contractor signboard.",
            "reporter_alias": "Civic Monitor KD",
        },
        files=[("photos", ("site.jpg", jpeg_bytes, "image/jpeg"))],
    )
    assert ok_resp.status_code == 201
    payload = ok_resp.json()
    tip = payload["tip"]
    assert "legal_disclaimer" in payload
    assert "unverified independent report" in payload["legal_disclaimer"].lower()
    assert "ip_hash" not in tip
    assert len(tip["photos"]) == 1

    # Verify saved photo has ZERO EXIF/GPS metadata
    photo_url = tip["photos"][0]
    photo_filename = photo_url.split("/")[-1]
    saved_photo_path = photos_dir / photo_filename
    assert saved_photo_path.exists()
    with Image.open(saved_photo_path) as scrubbed_img:
        assert len(scrubbed_img.getexif()) == 0
        assert "exif" not in scrubbed_img.info

    # Verify photo GET endpoint works & path traversal is rejected
    assert client.get(photo_url).status_code == 200
    assert client.get("/api/tips/photos/..secret.jpg").status_code == 400

    # 4. GET filter & Corroborate
    list_resp = client.get("/api/tips", params={"project_id": "proj-2024-99", "year": 2024})
    assert list_resp.status_code == 200
    assert list_resp.json()["total"] == 1

    tip_id = tip["tip_id"]
    for idx in range(3):
        corr = client.post(f"/api/tips/{tip_id}/corroborate")
        assert corr.status_code == 200
        assert corr.json()["tip"]["corroborations"] == idx + 1
    assert corr.json()["tip"]["moderation_status"] == "CORROBORATED"

    # 5. Moderation endpoint requires valid X-Admin-Key
    unauth = client.patch(
        f"/api/tips/{tip_id}/moderation",
        json={"moderation_status": "REJECTED", "moderation_note": "Spam"},
    )
    assert unauth.status_code == 403

    auth_ok = client.patch(
        f"/api/tips/{tip_id}/moderation",
        headers={"X-Admin-Key": "test-secret-admin-key"},
        json={"moderation_status": "OFFICIAL_REPLY", "moderation_note": "Contractor mobilized Nov 2026"},
    )
    assert auth_ok.status_code == 200
    assert auth_ok.json()["tip"]["moderation_status"] == "OFFICIAL_REPLY"
