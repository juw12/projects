# Beacon — zero-dependency push server. Build from apps/pushlab/beacon:
#   docker build -t beacon .
#   docker run -d -p 8780:8780 -v beacon-data:/data -e BEACON_PUBLIC_URL=https://push.example.com beacon
FROM python:3.12-slim
WORKDIR /app
COPY server ./server
COPY web ./web
ENV BEACON_HOST=0.0.0.0 \
    BEACON_PORT=8780 \
    BEACON_DB=/data/beacon.db \
    PYTHONUNBUFFERED=1
VOLUME ["/data"]
EXPOSE 8780
USER 65534:65534
CMD ["python", "server/server.py", "--trust-proxy"]
