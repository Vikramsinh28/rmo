from __future__ import annotations

import io

from PIL import Image, ImageDraw

from app.tracking.detector import MockPersonDetector
from app.tracking.models import BoundingBox


def _bgr_with_hint(marker: str, size=(160, 160)):
    import numpy as np

    image = Image.new('RGB', size, (40, 40, 40))
    draw = ImageDraw.Draw(image)
    draw.rectangle((40, 20, 120, 140), fill=(180, 140, 120))
    arr = np.array(image)[:, :, ::-1].copy()
    detector = MockPersonDetector()
    detector.set_raw_hint(f'{marker}'.encode('latin1'))
    return detector, arr


def test_mock_no_person():
    detector, frame = _bgr_with_hint('POC_PERSON:none|')
    assert detector.detect(frame) == []


def test_mock_one_person():
    detector, frame = _bgr_with_hint('POC_PERSON:one|')
    dets = detector.detect(frame)
    assert len(dets) == 1
    assert dets[0].class_name == 'person'
    assert 0 < dets[0].bounding_box.width < 1


def test_mock_multiple_people():
    detector, frame = _bgr_with_hint('POC_PERSON:two|')
    dets = detector.detect(frame)
    assert len(dets) == 2


def test_bbox_iou():
    a = BoundingBox(0.1, 0.1, 0.4, 0.4)
    b = BoundingBox(0.2, 0.2, 0.4, 0.4)
    assert a.iou(b) > 0.2
    assert a.iou(BoundingBox(0.9, 0.9, 0.05, 0.05)) == 0.0
