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

# Persistent artifact root (the deploy skill mounts /data when a PVC is requested).
# Run as a non-root user (required by the CI security scan and the deploy security context).
RUN groupadd --gid 1000 app \
    && useradd --uid 1000 --gid 1000 --create-home --shell /usr/sbin/nologin app \
    && mkdir -p /data/artifacts \
    && chown -R app:app /app /data
USER app

EXPOSE 8000
CMD ["python", "server/server.py", "--lan", "--port", "8000"]
