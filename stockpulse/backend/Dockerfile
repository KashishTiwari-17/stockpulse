# ── Build stage ───────────────────────────────────────────────────────────────
FROM python:3.12-slim AS base

WORKDIR /app

# Install dependencies first (layer-cached until requirements change)
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy source
COPY . .

# ── Runtime ───────────────────────────────────────────────────────────────────
EXPOSE 8000

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
