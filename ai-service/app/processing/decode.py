from __future__ import annotations

import numpy as np
from fastapi import HTTPException, status


def decode_image_bgr(image_bytes: bytes) -> np.ndarray:
    """Decode JPEG/PNG bytes to BGR ndarray. Does not persist bytes."""
    import cv2

    if not image_bytes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='EMPTY_IMAGE')
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if frame is None:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail='INVALID_IMAGE')
    return frame
