# photo2cad — PRD + 6 reference photos -> STEP CAD model
FROM python:3.12-slim

# OCCT wheels are self-contained; libgl1/libglib keep optional OCC paths happy.
RUN apt-get update && apt-get install -y --no-install-recommends \
        libgl1 libglib2.0-0 \
    && rm -rf /var/lib/apt/lists/*

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PHOTO2CAD_ARTIFACTS=/data/artifacts

WORKDIR /app

COPY requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt

COPY server ./server
COPY web ./web

# Optional persistent artifact root (deploy skill mounts /data when a PVC is requested).
RUN mkdir -p /data/artifacts

EXPOSE 8000
CMD ["python", "server/server.py", "--lan", "--port", "8000"]
