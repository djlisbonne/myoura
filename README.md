# Oura Local

Local-first web app for viewing, comparing, and querying Oura health data outside the stock Oura experience.

## What This Repo Is

This project is built to run locally on your machine with a React frontend and a small Node/Express API. The app is meant to:

- present Oura data in a denser, more interpretable layout
- let you compose custom views across multiple metrics
- keep a local cache of synced health data for fast exploration
- let you chat with ChatGPT about the data currently in view

## Local Setup

Prerequisites:

- Node.js 20 or newer
- npm
- an Oura personal access token if you want live sync
- an OpenAI API key if you want AI chat enabled

Install and run:

```bash
npm install
npm run dev
```

The Vite app runs in the browser and proxies `/api` requests to the local server on port `8787`.

## Environment Variables

Create a local `.env` file from `.env.example` and fill in:

- `OPENAI_API_KEY` for AI chat
- `OPENAI_MODEL` for the model name to use, defaulting to `gpt-5`
- `OURA_PERSONAL_ACCESS_TOKEN` for Oura API access and sync
- `PORT` for the local API server, defaulting to `8787`

If `OPENAI_API_KEY` is missing, AI chat should be treated as unavailable.
If `OURA_PERSONAL_ACCESS_TOKEN` is missing, the app should fall back to demo or locally cached data instead of live sync.

## Demo Mode

Demo mode is the safe path for first launch and offline development. In demo mode:

- the UI should load from local sample or cached data
- no Oura sync should be attempted
- AI chat can still work if `OPENAI_API_KEY` is present, but it should only see demo data

Use demo mode to verify layout, chart composition, and prompt behavior before connecting your real Oura account.

## Oura Sync Expectations

The intended sync model is local-first:

- sync pulls Oura data into a local cache
- the cache is the primary source for rendering charts and insights
- the app should tolerate partial syncs and missing metrics
- sync should be incremental when possible rather than re-downloading everything

The goal is to let you keep a longitudinal history locally so you can compare metrics across time without being constrained to a single Oura screen.

## OpenAI Chat Behavior

Chat is designed to be context-aware, not generic.

- the current screen state should be injected into the prompt context automatically
- selected metrics, visible date range, and any active overlays should be included
- chat should explain trends, relationships, and anomalies in plain language
- responses should stay grounded in the data in view rather than hallucinating unseen metrics

For privacy and clarity, the app should only send the minimum data needed for the current question and screen state.

## Architecture

High level:

- `src/` contains the React UI
- `server/` contains the local API that handles sync and AI requests
- Vite serves the frontend and proxies `/api` traffic to the local server
- local cached data is treated as a working store for exploration and chat context

The design goal is a clean, composable dashboard where any supported Oura metric can be overlaid against another so you can inspect relationships directly.
