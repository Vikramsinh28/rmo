from __future__ import annotations

from dataclasses import dataclass
from io import BytesIO

from fastapi import HTTPException, status
from PIL import Image, UnidentifiedImageError

from app.config import settings

JPEG_SOI = b'\xff\xd8'
PNG_SIG = b'\x89PNG\r\n\x1a\n'
MIN_DIMENSION = 32
MAX_DIMENSION = 4096


@dataclass(frozen=True)
class PreprocessedFrame:
    image_bytes: bytes
    width: int
    height: int
    format: str
    byte_length: int


def validate_and_decode(image_bytes: bytes) -> PreprocessedFrame:
    """Validate and decode a single frame. Caller must discard bytes after analysis."""
    if not image_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='EMPTY_IMAGE')
    if len(image_bytes) > settings.impairment_max_frame_bytes:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail='IMAGE_TOO_LARGE')

    if image_bytes.startswith(JPEG_SOI):
        declared = 'JPEG'
    elif image_bytes.startswith(PNG_SIG):
        declared = 'PNG'
    else:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='INVALID_IMAGE')

    try:
        with Image.open(BytesIO(image_bytes)) as image:
            image.load()
            width, height = image.size
            detected = (image.format or declared).upper()
    except UnidentifiedImageError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='INVALID_IMAGE') from exc
    except OSError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='INVALID_IMAGE') from exc

    if detected not in {'JPEG', 'JPG', 'PNG'}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='INVALID_IMAGE')
    if width < MIN_DIMENSION or height < MIN_DIMENSION:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='IMAGE_TOO_SMALL')
    if width > MAX_DIMENSION or height > MAX_DIMENSION:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='IMAGE_DIMENSIONS_TOO_LARGE')

    return PreprocessedFrame(
        image_bytes=image_bytes,
        width=width,
        height=height,
        format='JPEG' if detected in {'JPEG', 'JPG'} else 'PNG',
        byte_length=len(image_bytes),
    )
