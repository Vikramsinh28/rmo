FROM python:3.12-slim

WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    AI_SERVICE_PORT=8090 \
    YOLO_CONFIG_DIR=/tmp \
    MPLCONFIGDIR=/tmp/matplotlib \
    GLOG_minloglevel=2

# MediaPipe links against GLES/EGL even when running on the CPU delegate.
RUN apt-get update \
    && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 libegl1 libgles2 \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements-ml.txt ./
# CPU-only torch first so ultralytics does not pull the multi-GB CUDA build.
RUN pip install --no-cache-dir --index-url https://download.pytorch.org/whl/cpu torch torchvision \
    && pip install --no-cache-dir -r requirements.txt -r requirements-ml.txt \
    && pip uninstall -y opencv-python opencv-contrib-python \
    && pip install --no-cache-dir --force-reinstall --no-deps \
        "$(grep -E '^opencv-python-headless==' requirements.txt)"

ARG YOLO_POSE_URL=https://github.com/ultralytics/assets/releases/download/v8.3.0/yolo11n-pose.pt
ARG FACE_LANDMARKER_URL=https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task
RUN mkdir -p models \
    && python -c "import sys, urllib.request as u; u.urlretrieve(sys.argv[1], 'models/yolo11n-pose.pt'); u.urlretrieve(sys.argv[2], 'models/face_landmarker.task')" \
        "$YOLO_POSE_URL" "$FACE_LANDMARKER_URL"

COPY app ./app
COPY evaluation ./evaluation

EXPOSE 8090

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090"]
