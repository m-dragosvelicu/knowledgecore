# Minimal Trafilatura HTTP extractor for the L2 ingestion bench.
# Exposes POST /extract { url | html } -> clean text + provenance.
FROM python:3.12-slim

WORKDIR /app
RUN pip install --no-cache-dir \
    "trafilatura==1.12.2" \
    "fastapi==0.115.6" \
    "uvicorn==0.34.0" \
    "lxml==5.3.0"

COPY server.py /app/server.py

EXPOSE 8055
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8055"]
