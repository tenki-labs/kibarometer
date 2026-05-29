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

# scrapegraphai 1.76.0 declares langchain-community>=0.4.0 but still imports
# `ChatOllama` from langchain_community.chat_models in 9 of its node modules —
# a path langchain-community 0.4.0 removed (moved to the langchain-ollama
# package). The package is therefore broken as shipped: it builds, then
# crash-loops at import (`ImportError: cannot import name 'ChatOllama'`),
# which silently takes the whole media pillar offline. We can't pin
# langchain-community<0.4 (scrapegraphai requires >=0.4.0 → unresolvable).
# ChatOllama is only imported, never instantiated — we drive MLX over the
# OpenAI-compatible path — so redirect the stale imports to langchain_ollama
# (already a transitive dep that still exports ChatOllama). Drop this when
# scrapegraphai migrates the import upstream.
RUN find /usr/local/lib/python3.13/site-packages/scrapegraphai -name '*.py' -exec sed -i 's/from langchain_community\.chat_models import ChatOllama/from langchain_ollama import ChatOllama/g' {} +

COPY server.py schemas.py ./

EXPOSE 8000

# Single uvicorn worker — scrapegraphai's LangChain stack is not thread-
# safe and the heavy work is the LLM call, which MLX serialises anyway.
# FastAPI's async dispatch handles concurrent requests via I/O multiplex
# on the LLM call. If we measure saturation later, add workers + a
# Redis-backed semaphore on MLX. Don't over-engineer day 1.
CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
