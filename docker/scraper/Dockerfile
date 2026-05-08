# kiba-scraper sidecar image.
#
# scrapegraphai's fetch path is hardcoded to Playwright/Chromium (verified
# on Day 0), so the container needs Chromium pre-installed. We install
# system deps via Playwright's first-party installer to avoid a bespoke
# apt list — that script tracks Chromium's runtime requirements as
# Chromium itself moves.
#
# Final image is ~1.1 GB: Python deps ~500 MB + Chromium-headless-shell
# ~250 MB + base + system deps. Acceptable for a sidecar that's only
# pulled to the VPS on deploy.

FROM python:3.13-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PLAYWRIGHT_BROWSERS_PATH=/opt/ms-playwright

WORKDIR /app

# Layer order matters for cache hits on rebuild:
#  1. Install Playwright runtime + apt deps via a tiny pip install.
#     This layer only invalidates if the playwright pin moves.
#  2. Install the rest of the Python deps.
#  3. Copy server source.
RUN pip install --no-cache-dir 'playwright==1.59.0' && \
    playwright install --with-deps chromium

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py schemas.py ./

EXPOSE 8000

# Single uvicorn worker — scrapegraphai's LangChain stack is not thread-
# safe and the heavy work is the LLM call, which MLX serialises anyway.
# FastAPI's async dispatch handles concurrent requests via I/O multiplex
# on the LLM call. If we measure saturation later, add workers + a
# Redis-backed semaphore on MLX. Don't over-engineer day 1.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
