"""Citizen Field Verification & Photo Evidence Router (/api/tips)."""

from __future__ import annotations

import hashlib
import hmac
import io
import os
import re
import uuid
from pathlib import Path
from typing import Annotated, Any

from fastapi import APIRouter, File, Form, Header, HTTPException, Query, Request, UploadFile
from fastapi.responses import FileResponse
from PIL import Image, ImageOps, UnidentifiedImageError
from pydantic import BaseModel, Field

from backend.db import (
    check_and_record_rate_limit,
    increment_corroboration,
    insert_tip,
    list_tips,
    update_moderation,
)

router = APIRouter(prefix="/api/tips", tags=["citizen-tips"])

LEGAL_DISCLAIMER = (
    "Citizen Field Observation (Unverified Independent Report — Subject to Corroboration "
    "& Official BPP/Contractor Right-of-Reply)"
)

ALLOWED_STATUSES = {
    "VERIFIED_ON_GROUND",
    "NOT_ON_GROUND",
    "ABANDONED_SITE",
    "STALLED_PARTIAL",
    "SUBSTANTIAL_COMPLETION",
    "OTHER_OBSERVATION",
}

ALLOWED_MODERATION = {"UNVERIFIED", "CORROBORATED", "OFFICIAL_REPLY", "REJECTED"}
MAX_PHOTOS = 3
MAX_PHOTO_BYTES = 5 * 1024 * 1024
SAFE_FILENAME_RE = re.compile(r"^[a-f0-9\-]{8,64}\.(jpg|jpeg|png|webp)$")
DEFAULT_PHOTOS_DIR = Path(__file__).resolve().parent.parent / "data" / "tip_photos"


class ModerationPatchRequest(BaseModel):
    moderation_status: str = Field(..., min_length=3, max_length=32)
    moderation_note: str = Field(default="", max_length=500)


def get_photos_dir() -> Path:
    override = os.environ.get("BUDGETLENS_TIPS_PHOTOS_DIR")
    path = Path(override) if override else DEFAULT_PHOTOS_DIR
    path.mkdir(parents=True, exist_ok=True)
    return path


def hash_client_ip(request: Request) -> str:
    forwarded = request.headers.get("x-forwarded-for", "").split(",")[0].strip()
    raw_ip = forwarded or (request.client.host if request.client else "unknown")
    salt = os.environ.get("BUDGETLENS_IP_SALT", "budgetlens-ng-field-tips-salt")
    return hashlib.sha256(f"{salt}:{raw_ip}".encode("utf-8")).hexdigest()


def detect_magic_image_format(raw: bytes) -> str | None:
    """Validate real image magic bytes (JPEG, PNG, WEBP) before touching Pillow."""
    if raw.startswith(b"\xff\xd8\xff"):
        return "JPEG"
    if raw.startswith(b"\x89PNG\r\n\x1a\n"):
        return "PNG"
    if len(raw) >= 12 and raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "WEBP"
    return None


def scrub_exif_and_save_photo(raw: bytes, dest_dir: Path) -> str:
    """Validate magic bytes, decode image, strip all EXIF/GPS metadata, and re-encode cleanly."""
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(
            status_code=413,
            detail="Uploaded photo exceeds maximum allowed size of 5 MB.",
        )
    fmt = detect_magic_image_format(raw)
    if fmt is None:
        raise HTTPException(
            status_code=400,
            detail="Unsupported or invalid image file. Only JPEG, PNG, and WEBP magic bytes are accepted.",
        )

    try:
        with Image.open(io.BytesIO(raw)) as src:
            src.verify()
        with Image.open(io.BytesIO(raw)) as img:
            oriented = ImageOps.exif_transpose(img)
            ext = "jpg" if fmt == "JPEG" else fmt.lower()
            if fmt in {"JPEG", "WEBP"}:
                converted = oriented.convert("RGB")
            else:
                converted = oriented.convert("RGBA" if oriented.mode in {"RGBA", "LA", "P"} else "RGB")

            # Rebuild clean pixel buffer with zero EXIF, ICC, GPS, or camera tags
            clean = Image.new(converted.mode, converted.size)
            clean.putdata(list(converted.getdata()))
            filename = f"{uuid.uuid4().hex}.{ext}"
            dest_path = dest_dir / filename
            save_kwargs: dict[str, Any] = {"quality": 85} if fmt in {"JPEG", "WEBP"} else {"optimize": True}
            clean.save(dest_path, format=fmt, **save_kwargs)
            return filename
    except HTTPException:
        raise
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(status_code=400, detail=f"Corrupt or unreadable image payload: {exc}") from exc


@router.post("", status_code=201)
async def submit_citizen_tip(
    request: Request,
    project_id: Annotated[str, Form(...)],
    financial_year: Annotated[int, Form(...)],
    status: Annotated[str, Form(...)],
    observation: Annotated[str, Form(...)],
    project_code: Annotated[str, Form()] = "",
    state: Annotated[str, Form()] = "",
    lga: Annotated[str, Form()] = "",
    reporter_alias: Annotated[str, Form()] = "Anonymous Citizen",
    photos: Annotated[list[UploadFile] | None, File()] = None,
) -> dict[str, Any]:
    clean_status = status.strip().upper()
    if clean_status not in ALLOWED_STATUSES:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid field observation status. Must be one of: {', '.join(sorted(ALLOWED_STATUSES))}",
        )

    clean_obs = observation.strip()
    if len(clean_obs) < 10 or len(clean_obs) > 2000:
        raise HTTPException(
            status_code=400,
            detail="Observation text must be between 10 and 2000 characters.",
        )

    if financial_year < 1999 or financial_year > 2030:
        raise HTTPException(status_code=400, detail="financial_year must be between 1999 and 2030.")

    upload_list = [p for p in (photos or []) if p.filename]
    if len(upload_list) > MAX_PHOTOS:
        raise HTTPException(
            status_code=400,
            detail=f"Maximum {MAX_PHOTOS} photo attachments allowed per tip.",
        )

    ip_hash = hash_client_ip(request)
    rate_limit_max = int(os.environ.get("BUDGETLENS_RATE_LIMIT_MAX", "12"))
    if not check_and_record_rate_limit(ip_hash, window_seconds=3600, max_requests=rate_limit_max):
        raise HTTPException(
            status_code=429,
            detail="Rate limit exceeded for citizen field submissions. Please retry later.",
        )

    photos_dir = get_photos_dir()
    saved_filenames: list[str] = []
    for upload in upload_list:
        raw_bytes = await upload.read()
        if len(raw_bytes) == 0:
            continue
        saved_filenames.append(scrub_exif_and_save_photo(raw_bytes, photos_dir))

    tip = insert_tip(
        tip_id=f"tip-{uuid.uuid4().hex[:12]}",
        project_id=project_id.strip()[:120],
        financial_year=financial_year,
        project_code=project_code.strip()[:80],
        state=state.strip()[:60],
        lga=lga.strip()[:80],
        status=clean_status,
        observation=clean_obs,
        reporter_alias=(reporter_alias.strip() or "Anonymous Citizen")[:80],
        photo_filenames=saved_filenames,
        ip_hash=ip_hash,
    )
    return {"tip": tip, "legal_disclaimer": LEGAL_DISCLAIMER}


@router.get("")
def get_citizen_tips(
    project_id: str | None = Query(default=None),
    year: int | None = Query(default=None),
    state: str | None = Query(default=None),
    status: str | None = Query(default=None),
    include_rejected: bool = Query(default=False),
    limit: int = Query(default=25, ge=1, le=100),
) -> dict[str, Any]:
    tips = list_tips(
        project_id=project_id,
        financial_year=year,
        state=state,
        status=status,
        include_rejected=include_rejected,
        limit=limit,
    )
    return {
        "total": len(tips),
        "tips": tips,
        "legal_disclaimer": LEGAL_DISCLAIMER,
    }


@router.get("/photos/{filename}")
def get_tip_photo(filename: str) -> FileResponse:
    if not SAFE_FILENAME_RE.match(filename):
        raise HTTPException(status_code=400, detail="Invalid photo filename.")
    photo_path = (get_photos_dir() / filename).resolve()
    photos_root = get_photos_dir().resolve()
    if not str(photo_path).startswith(str(photos_root)) or not photo_path.is_file():
        raise HTTPException(status_code=404, detail="Tip photo not found.")
    return FileResponse(path=str(photo_path))


@router.post("/{tip_id}/corroborate")
def corroborate_tip(tip_id: str) -> dict[str, Any]:
    updated = increment_corroboration(tip_id.strip())
    if updated is None:
        raise HTTPException(status_code=404, detail="Citizen tip not found.")
    return {"tip": updated, "legal_disclaimer": LEGAL_DISCLAIMER}


@router.patch("/{tip_id}/moderation")
def moderate_tip(
    tip_id: str,
    payload: ModerationPatchRequest,
    x_admin_key: str | None = Header(default=None, alias="X-Admin-Key"),
) -> dict[str, Any]:
    expected_key = os.environ.get("BUDGETLENS_ADMIN_KEY", "dev-admin-key-change-me")
    if not x_admin_key or not hmac.compare_digest(x_admin_key, expected_key):
        raise HTTPException(status_code=403, detail="Invalid or missing X-Admin-Key.")

    clean_mod = payload.moderation_status.strip().upper()
    if clean_mod not in ALLOWED_MODERATION:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid moderation_status. Must be one of: {', '.join(sorted(ALLOWED_MODERATION))}",
        )

    updated = update_moderation(tip_id.strip(), clean_mod, payload.moderation_note)
    if updated is None:
        raise HTTPException(status_code=404, detail="Citizen tip not found.")
    return {"tip": updated, "legal_disclaimer": LEGAL_DISCLAIMER}
