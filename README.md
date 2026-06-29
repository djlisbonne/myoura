# Oura Local

A fast, local-first web app for exploring your own Oura Ring health data — denser
and more open-ended than the stock Oura app. Overlay any metrics against each
other, keep a longitudinal local history, and ask an AI (Claude) questions
grounded in the data you're looking at.

Built as a small Python backend (FastAPI on uvicorn) serving a no-build vanilla
JS frontend, with SQLite for local storage. No Node, no npm.

## What it does

- **Connects to Oura** with a Personal Access Token — no OAuth, no callback URL.
- **Syncs** sleep, readiness, activity, stress/recovery, SpO₂, HRV, resting HR,
  temperature, cardiovascular age and more into a local SQLite store. Sync is
  incremental and tolerates partial data.
- **Charts** any combination of metrics on a shared timeline (fast uPlot charts),
  with a "normalize" mode to compare the *shapes* of metrics on different scales.
- **Saved views** — name and reload metric combinations you care about.
- **AI chat** (optional) — ask questions about the metrics currently in view;
  the server feeds Claude a factual summary of the real data so answers stay
  grounded.

## Setup

Requires Python 3.11+.

```bash
# 1. Create a virtualenv and install dependencies
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt

# 2. Configure
cp .env.example .env
#   edit .env and add your Oura Personal Access Token (and optionally an
#   Anthropic API key for the AI chat). You can also paste the Oura token
#   later in the app's Settings dialog.

# 3. Run
./run.sh
#   or: uvicorn app.main:app --host 127.0.0.1 --port 8000
```

Then open <http://127.0.0.1:8000>. On first launch the Settings dialog opens so
you can paste your token; hit **Sync** to pull your history.

### Get an Oura Personal Access Token

Create one at <https://cloud.ouraring.com/personal-access-tokens>. This is the
right credential for a single-user local app — it needs no redirect URL, which is
what made the old OAuth flow painful on localhost.

### Enable AI chat (optional)

Set `ANTHROPIC_API_KEY` in `.env` (key from
<https://console.anthropic.com/settings/keys>). The default model is
`claude-opus-4-8`; override with `ANTHROPIC_MODEL`. If unset, the app works fully
minus the chat panel.

## Architecture

```
app/
  main.py      FastAPI app: REST API + serves the static frontend
  config.py    env-driven settings
  db.py        SQLite store (daily metrics, heart-rate series, views, sync log)
  oura.py      async Oura Cloud API v2 client (PAT auth, pagination)
  metrics.py   the metric catalog — drives sync, the API, and the UI
  sync.py      incremental pull + extract into the local store
  chat.py      Claude streaming chat, grounded in the data in view
  static/      no-build vanilla JS frontend (uPlot vendored, no npm)
data/oura.db   local SQLite database (gitignored, created on first run)
oura-openapi.json   Oura's OpenAPI spec, kept as a reference
```

The local SQLite store is the source of truth for rendering — sync just keeps it
up to date, so exploration is instant and works offline.

## On real-time / accelerometer streaming

The public Oura Cloud API does **not** expose raw accelerometer streaming — that
lives behind the ring's local Bluetooth/SDK path, which is a separate future
effort. "Real-time" here means heart-rate time series plus auto-refreshing
incremental sync. The code is structured so a live-sensor (BLE) module can slot
in later alongside the cloud sync.

## Notes

- Data and secrets stay on your machine: the SQLite DB and `.env` are gitignored.
- Heart-rate sync defaults to the last 7 days (it's high-volume); daily metrics
  default to a 90-day backfill on first sync, then incremental.
