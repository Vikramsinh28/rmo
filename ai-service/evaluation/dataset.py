from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional

from PIL import Image, ImageDraw


EVAL_ROOT = Path(__file__).resolve().parent
SAMPLES_DIR = EVAL_ROOT / 'samples'
METADATA_DIR = EVAL_ROOT / 'metadata'
RESULTS_DIR = EVAL_ROOT / 'results'


@dataclass(frozen=True)
class SampleRecord:
    sample_id: str
    path: Path
    source: str
    scenario: str
    image_quality: str
    lighting: str
    camera_angle: str
    number_of_people: int
    glasses: bool
    notes: str
    # Optional technical expected status for pipeline tests — NOT alcohol ground truth.
    expected_status: Optional[str] = None


def ensure_dirs() -> None:
    SAMPLES_DIR.mkdir(parents=True, exist_ok=True)
    METADATA_DIR.mkdir(parents=True, exist_ok=True)
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)


def generate_synthetic_fixtures(force: bool = False) -> List[Path]:
    """
    Create developer synthetic images (no real faces, no intoxication labels).

    These support technical pipeline tests: decode, quality gates, latency.
    They must not be treated as clinical impairment ground truth.
    """
    ensure_dirs()
    specs = [
        ('synth_clear_signal.jpg', (96, 96), 'gradient', 'ok'),
        ('synth_low_light.jpg', (96, 96), 'dark', 'low'),
        ('synth_overexposed.jpg', (96, 96), 'bright', 'low'),
        ('synth_flat_no_person.jpg', (96, 96), 'flat', 'flat'),
        ('synth_high_contrast.jpg', (128, 128), 'checker', 'ok'),
    ]
    created: List[Path] = []
    for name, size, kind, _quality in specs:
        path = SAMPLES_DIR / name
        if path.exists() and not force:
            created.append(path)
            continue
        image = Image.new('RGB', size, color=(0, 0, 0))
        draw = ImageDraw.Draw(image)
        w, h = size
        if kind == 'gradient':
            for x in range(w):
                shade = int(40 + (180 * x / max(w - 1, 1)))
                draw.line([(x, 0), (x, h)], fill=(shade, shade // 2, 120))
            # Simple oval "presence" blob — geometric, not a real face.
            draw.ellipse((w // 4, h // 4, 3 * w // 4, 3 * h // 4), fill=(180, 140, 120))
        elif kind == 'dark':
            draw.rectangle((0, 0, w, h), fill=(8, 8, 10))
        elif kind == 'bright':
            draw.rectangle((0, 0, w, h), fill=(250, 250, 252))
        elif kind == 'flat':
            draw.rectangle((0, 0, w, h), fill=(120, 120, 120))
        elif kind == 'checker':
            for y in range(0, h, 8):
                for x in range(0, w, 8):
                    fill = (30, 30, 30) if ((x // 8) + (y // 8)) % 2 == 0 else (220, 220, 220)
                    draw.rectangle((x, y, x + 7, y + 7), fill=fill)
        image.save(path, format='JPEG', quality=85)
        created.append(path)

    meta_path = METADATA_DIR / 'samples.json'
    if force or not meta_path.exists():
        meta_path.write_text(
            json.dumps(_default_metadata(), indent=2) + '\n',
            encoding='utf-8',
        )
    return created


def _default_metadata() -> Dict[str, Any]:
    return {
        'datasetVersion': '9b-synthetic-v1',
        'license': 'Generated in-repo for technical benchmarking only. Not a clinical dataset.',
        'containsRealFaces': False,
        'containsImpairmentGroundTruth': False,
        'disclaimer': (
            'Samples are synthetic geometric images. They are not labeled intoxicated/sober. '
            'expectedStatus values are technical pipeline expectations only.'
        ),
        'samples': [
            {
                'sampleId': 'synth_clear_signal',
                'file': 'synth_clear_signal.jpg',
                'source': 'synthetic-generator',
                'scenario': 'technical_signal_present',
                'imageQuality': 'good',
                'lighting': 'mixed',
                'cameraAngle': 'frontal_synthetic',
                'numberOfPeople': 0,
                'glasses': False,
                'notes': 'Gradient + oval blob for presence signal; not a face.',
                'expectedStatus': 'ANALYSIS_UNAVAILABLE',
            },
            {
                'sampleId': 'synth_low_light',
                'file': 'synth_low_light.jpg',
                'source': 'synthetic-generator',
                'scenario': 'low_light',
                'imageQuality': 'poor',
                'lighting': 'dark',
                'cameraAngle': 'n/a',
                'numberOfPeople': 0,
                'glasses': False,
                'notes': 'Near-black frame for insufficient-quality gate.',
                'expectedStatus': 'INSUFFICIENT_QUALITY',
            },
            {
                'sampleId': 'synth_overexposed',
                'file': 'synth_overexposed.jpg',
                'source': 'synthetic-generator',
                'scenario': 'overexposed',
                'imageQuality': 'poor',
                'lighting': 'bright',
                'cameraAngle': 'n/a',
                'numberOfPeople': 0,
                'glasses': False,
                'notes': 'Near-white frame for insufficient-quality gate.',
                'expectedStatus': 'INSUFFICIENT_QUALITY',
            },
            {
                'sampleId': 'synth_flat_no_person',
                'file': 'synth_flat_no_person.jpg',
                'source': 'synthetic-generator',
                'scenario': 'uniform_empty',
                'imageQuality': 'medium',
                'lighting': 'flat',
                'cameraAngle': 'n/a',
                'numberOfPeople': 0,
                'glasses': False,
                'notes': 'Uniform mid-gray; treated as no-person technical case.',
                'expectedStatus': 'NO_PERSON_DETECTED',
            },
            {
                'sampleId': 'synth_high_contrast',
                'file': 'synth_high_contrast.jpg',
                'source': 'synthetic-generator',
                'scenario': 'high_contrast_pattern',
                'imageQuality': 'good',
                'lighting': 'high_contrast',
                'cameraAngle': 'n/a',
                'numberOfPeople': 0,
                'glasses': False,
                'notes': 'Checkerboard; technical readiness without impairment claim.',
                'expectedStatus': 'ANALYSIS_UNAVAILABLE',
            },
        ],
    }


def load_samples() -> List[SampleRecord]:
    ensure_dirs()
    generate_synthetic_fixtures(force=False)
    meta_path = METADATA_DIR / 'samples.json'
    payload = json.loads(meta_path.read_text(encoding='utf-8'))
    records: List[SampleRecord] = []
    for item in payload.get('samples', []):
        path = SAMPLES_DIR / item['file']
        if not path.exists():
            continue
        records.append(
            SampleRecord(
                sample_id=item['sampleId'],
                path=path,
                source=item.get('source', 'unknown'),
                scenario=item.get('scenario', ''),
                image_quality=item.get('imageQuality', ''),
                lighting=item.get('lighting', ''),
                camera_angle=item.get('cameraAngle', ''),
                number_of_people=int(item.get('numberOfPeople', 0)),
                glasses=bool(item.get('glasses', False)),
                notes=item.get('notes', ''),
                expected_status=item.get('expectedStatus'),
            ),
        )
    return records


def dataset_disclaimer() -> dict:
    meta_path = METADATA_DIR / 'samples.json'
    if not meta_path.exists():
        return {'containsImpairmentGroundTruth': False}
    payload = json.loads(meta_path.read_text(encoding='utf-8'))
    return {
        'datasetVersion': payload.get('datasetVersion'),
        'license': payload.get('license'),
        'containsRealFaces': payload.get('containsRealFaces', False),
        'containsImpairmentGroundTruth': payload.get('containsImpairmentGroundTruth', False),
        'disclaimer': payload.get('disclaimer'),
    }
