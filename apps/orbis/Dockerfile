# Orbis server (workspace API + Orbis Chat) — standard library only.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    HOST=0.0.0.0 \
    PORT=8080 \
    ORBIS_DB=/data/orbis.db \
    ORBIS_TRUST_PROXY=1

WORKDIR /app
COPY server ./server
COPY web ./web

# /data holds the SQLite database, uploads and the dev email outbox.
# Mount a persistent volume here in production.
RUN mkdir -p /data
VOLUME ["/data"]
EXPOSE 8080

CMD ["python", "server/server.py", "--no-browser"]
