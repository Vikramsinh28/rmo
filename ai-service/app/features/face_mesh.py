from __future__ import annotations

import math
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

from app.tracking.models import BoundingBox, Keypoint

Point = Tuple[float, float]

# MediaPipe Face Mesh landmark indices.
# Eye contours ordered p1..p6 for the eye aspect ratio (EAR).
RIGHT_EYE = (33, 160, 158, 133, 153, 144)  # subject's right eye (image left)
LEFT_EYE = (362, 385, 387, 263, 373, 380)  # subject's left eye (image right)
MOUTH_INNER_TOP, MOUTH_INNER_BOTTOM = 13, 14
MOUTH_LEFT, MOUTH_RIGHT = 61, 291
NOSE_TIP, CHIN = 1, 152
RIGHT_EYE_OUTER, LEFT_EYE_OUTER = 33, 263

# Generic 3D face model (arbitrary units), camera convention: x right, y down,
# z away from the camera. A frontal face yields a near-identity rotation.
FACE_MODEL_3D = np.array(
    [
        (0.0, 0.0, 0.0),  # nose tip
        (0.0, 330.0, 65.0),  # chin
        (-225.0, -170.0, 135.0),  # image-left eye outer corner
        (225.0, -170.0, 135.0),  # image-right eye outer corner
        (-150.0, 150.0, 125.0),  # image-left mouth corner
        (150.0, 150.0, 125.0),  # image-right mouth corner
    ],
    dtype=np.float64,
)
POSE_LANDMARKS = (NOSE_TIP, CHIN, RIGHT_EYE_OUTER, LEFT_EYE_OUTER, MOUTH_LEFT, MOUTH_RIGHT)

EAR_CLOSED, EAR_OPEN = 0.12, 0.25
MAR_CLOSED, MAR_OPEN = 0.05, 0.35
FACE_KEYPOINT_MIN_CONFIDENCE = 0.5
# Nose-to-eye/ear spread below this means a face too small for reliable landmarks.
MIN_FACE_KEYPOINT_SPAN_PX = 10.0
LANDMARKER_MIN_SIDE = 192.0


def _dist(a: Point, b: Point) -> float:
    return math.hypot(a[0] - b[0], a[1] - b[1])


def eye_aspect_ratio(points: Sequence[Point]) -> float:
    p1, p2, p3, p4, p5, p6 = points
    horizontal = _dist(p1, p4)
    if horizontal <= 1e-6:
        return 0.0
    return (_dist(p2, p6) + _dist(p3, p5)) / (2.0 * horizontal)


def mouth_aspect_ratio(top: Point, bottom: Point, left: Point, right: Point) -> float:
    width = _dist(left, right)
    if width <= 1e-6:
        return 0.0
    return _dist(top, bottom) / width


def _ramp(value: float, low: float, high: float) -> float:
    return max(0.0, min(1.0, (value - low) / (high - low)))


def _wrap(angle: float) -> float:
    """Fold solvePnP/RQ ambiguities into [-90, 90] degrees."""
    while angle > 90.0:
        angle -= 180.0
    while angle < -90.0:
        angle += 180.0
    return angle


def estimate_head_pose(
    image_points: np.ndarray,
    image_width: int,
    image_height: int,
) -> Optional[Dict[str, float]]:
    """
    Pitch / yaw / roll in degrees from six 2D landmarks (pixel coords).

    Signs: pitch > 0 looking up, yaw > 0 face turned toward image left,
    roll > 0 top of head tilted toward image right.
    """
    import cv2

    focal = float(image_width)
    camera = np.array(
        [[focal, 0.0, image_width / 2.0], [0.0, focal, image_height / 2.0], [0.0, 0.0, 1.0]],
        dtype=np.float64,
    )
    ok, rvec, _ = cv2.solvePnP(
        FACE_MODEL_3D,
        image_points.astype(np.float64),
        camera,
        np.zeros((4, 1)),
        flags=cv2.SOLVEPNP_ITERATIVE,
    )
    if not ok:
        return None
    rotation, _ = cv2.Rodrigues(rvec)
    angles, *_ = cv2.RQDecomp3x3(rotation)
    pitch, yaw, roll = (_wrap(float(a)) for a in angles)
    return {'pitch': round(pitch, 2), 'yaw': round(yaw, 2), 'roll': round(roll, 2)}


class MeshFaceFeatureExtractor:
    """
    MediaPipe FaceLandmarker (478-point mesh) inside the person box:
    eyes, mouth, head pose, landmarks.

    One instance per session pipeline — MediaPipe graphs are not thread-safe.
    """

    provider_name = 'mediapipe'

    def __init__(
        self,
        model_path: Optional[str] = None,
        min_detection_confidence: float = 0.5,
    ) -> None:
        import cv2
        import mediapipe as mp
        from mediapipe.tasks.python import BaseOptions, vision

        from app.config import settings

        self._cv2 = cv2
        self._mp = mp
        options = vision.FaceLandmarkerOptions(
            base_options=BaseOptions(
                model_asset_path=model_path or settings.ai_face_landmarker_model,
                delegate=BaseOptions.Delegate.CPU,
            ),
            running_mode=vision.RunningMode.IMAGE,
            num_faces=1,
            min_face_detection_confidence=min_detection_confidence,
            min_face_presence_confidence=min_detection_confidence,
            output_face_blendshapes=True,
        )
        self._landmarker = vision.FaceLandmarker.create_from_options(options)

    def close(self) -> None:
        self._landmarker.close()

    def _landmarks(self, rgb: np.ndarray):
        """Landmarks and blendshape scores (name -> 0..1) for the first face, or None."""
        image = self._mp.Image(image_format=self._mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
        result = self._landmarker.detect(image)
        if not result.face_landmarks:
            return None
        blendshapes: Dict[str, float] = {}
        if result.face_blendshapes:
            blendshapes = {c.category_name: float(c.score) for c in result.face_blendshapes[0]}
        return result.face_landmarks[0], blendshapes

    @staticmethod
    def face_region(
        person_box: BoundingBox,
        width: int,
        height: int,
        keypoints: Optional[List[Keypoint]] = None,
    ) -> Optional[Tuple[int, int, int, int]]:
        """
        Pixel crop likely to contain the face, or None when the pose shows no usable face.

        Uses the pose model's nose/eye/ear keypoints when available, otherwise the
        upper part of the person box. The landmarker's face detector is short-range,
        so a tight face-centred crop matters more than the whole body.
        """
        if keypoints and len(keypoints) >= 5:
            visible = [kp.confidence >= FACE_KEYPOINT_MIN_CONFIDENCE for kp in keypoints[:5]]
            # Facing away or face occluded: the nose and at least one eye are required.
            if not visible[0] or not (visible[1] or visible[2]):
                return None
            face_points = [
                (kp.x * width, kp.y * height)
                for kp, ok in zip(keypoints[:5], visible)
                if ok
            ]
            xs = [p[0] for p in face_points]
            ys = [p[1] for p in face_points]
            span = max(max(xs) - min(xs), max(ys) - min(ys))
            if span < MIN_FACE_KEYPOINT_SPAN_PX:
                return None
            cx, cy = sum(xs) / len(xs), sum(ys) / len(ys)
            half = max(span * 2.6, 48.0) / 2.0
            return (
                max(0, int(cx - half)),
                max(0, int(cy - half)),
                min(width, int(cx + half)),
                min(height, int(cy + half)),
            )
        x1 = int(person_box.x * width)
        y1 = int(person_box.y * height)
        x2 = int((person_box.x + person_box.width) * width)
        y2 = int((person_box.y + person_box.height) * height)
        # Standing people: the face is in the upper part of a tall box.
        if (y2 - y1) > 1.5 * max(x2 - x1, 1):
            y2 = y1 + int((y2 - y1) * 0.35)
        return max(0, x1), max(0, y1), min(width, x2), min(height, y2)

    def extract(
        self,
        frame_bgr: np.ndarray,
        person_box: BoundingBox,
        keypoints: Optional[List[Keypoint]] = None,
    ) -> Dict[str, Any]:
        height, width = frame_bgr.shape[:2]
        region = self.face_region(person_box, width, height, keypoints)
        if region is None:
            return self._empty()
        x1, y1, x2, y2 = region
        if x2 - x1 < 24 or y2 - y1 < 24:
            return self._empty()

        roi = frame_bgr[y1:y2, x1:x2]
        roi_h, roi_w = roi.shape[:2]
        # Upscale small crops; landmark coordinates are normalized so no remap needed.
        scale = LANDMARKER_MIN_SIDE / min(roi_h, roi_w)
        work = roi
        if scale > 1.0:
            work = self._cv2.resize(roi, (int(roi_w * scale), int(roi_h * scale)))
        rgb = self._cv2.cvtColor(work, self._cv2.COLOR_BGR2RGB)
        detected = self._landmarks(rgb)
        if not detected:
            return self._empty()
        landmarks, blendshapes = detected

        pts: List[Point] = [(lm.x * roi_w, lm.y * roi_h) for lm in landmarks]

        xs = [p[0] for p in pts]
        ys = [p[1] for p in pts]
        fx1, fy1 = max(0.0, min(xs)), max(0.0, min(ys))
        fx2, fy2 = min(float(roi_w), max(xs)), min(float(roi_h), max(ys))
        if fx2 - fx1 < 8 or fy2 - fy1 < 8:
            return self._empty()
        face_box = BoundingBox(
            x=(x1 + fx1) / width,
            y=(y1 + fy1) / height,
            width=(fx2 - fx1) / width,
            height=(fy2 - fy1) / height,
        ).clamp()

        right_ear = eye_aspect_ratio([pts[i] for i in RIGHT_EYE])
        left_ear = eye_aspect_ratio([pts[i] for i in LEFT_EYE])
        ear = (right_ear + left_ear) / 2.0
        mar = mouth_aspect_ratio(
            pts[MOUTH_INNER_TOP], pts[MOUTH_INNER_BOTTOM], pts[MOUTH_LEFT], pts[MOUTH_RIGHT],
        )
        head_pose = estimate_head_pose(
            np.array([pts[i] for i in POSE_LANDMARKS]), roi_w, roi_h,
        )

        gray = self._cv2.cvtColor(roi, self._cv2.COLOR_BGR2GRAY)
        face_gray = gray[int(fy1):int(fy2), int(fx1):int(fx2)]
        lap = float(self._cv2.Laplacian(face_gray, self._cv2.CV_64F).var()) if face_gray.size else 0.0
        sharpness = max(0.0, min(1.0, lap / 200.0))
        size_score = max(0.0, min(1.0, (fx2 - fx1) / 96.0))  # ~96px face width is plenty
        frontal = 1.0
        if head_pose:
            frontal = max(0.0, 1.0 - (abs(head_pose['yaw']) + abs(head_pose['pitch'])) / 90.0)
        quality = round(0.45 * sharpness + 0.35 * size_score + 0.20 * frontal, 3)

        # Blendshapes are learned and hold up across faces and camera angles; fixed
        # EAR/MAR thresholds do not (a camera below the face reads open eyes as ~0.09).
        blink_left = blendshapes.get('eyeBlinkLeft')
        blink_right = blendshapes.get('eyeBlinkRight')
        if blink_left is not None and blink_right is not None:
            eyes_open = 1.0 - (blink_left + blink_right) / 2.0
        else:
            eyes_open = _ramp(ear, EAR_CLOSED, EAR_OPEN)
        jaw_open = blendshapes.get('jawOpen')
        mouth_open = jaw_open if jaw_open is not None else _ramp(mar, MAR_CLOSED, MAR_OPEN)

        return {
            'visible': True,
            'quality': quality,
            'boundingBox': face_box.to_dict(),
            'headPose': head_pose or {'pitch': None, 'yaw': None, 'roll': None},
            'eyes': {
                'available': True,
                'openProbability': round(eyes_open, 3),
                'blinkLeft': round(blink_left, 3) if blink_left is not None else None,
                'blinkRight': round(blink_right, 3) if blink_right is not None else None,
                'aspectRatio': round(ear, 4),
                'leftAspectRatio': round(left_ear, 4),
                'rightAspectRatio': round(right_ear, 4),
            },
            'mouth': {
                'available': True,
                'openProbability': round(mouth_open, 3),
                'aspectRatio': round(mar, 4),
            },
            'landmarkAvailability': True,
            'source': 'mediapipe',
            'signalsAvailable': [
                'faceVisible',
                'faceQuality',
                'faceBoundingBox',
                'headPose',
                'eyesOpen',
                'mouthOpen',
                'landmarks',
            ],
        }

    @staticmethod
    def _empty() -> Dict[str, Any]:
        return {
            'visible': False,
            'quality': None,
            'boundingBox': None,
            'headPose': {'pitch': None, 'yaw': None, 'roll': None},
            'eyes': {'available': False, 'openProbability': None},
            'mouth': {'available': False, 'openProbability': None},
            'landmarkAvailability': False,
            'source': 'mediapipe',
            'signalsAvailable': ['faceVisible'],
        }
