FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PORT=8000 \
    RESPARK_DB_PATH=/app/data/data.db

WORKDIR /app

COPY server/ ./server/
COPY web/ ./web/
COPY tests/ ./tests/

RUN mkdir -p /app/logs /app/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen('http://localhost:%s/' % os.environ.get('PORT', '8000'), timeout=3)"

CMD ["python", "server/server.py"]
