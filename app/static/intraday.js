"use strict";
// Intraday Explorer — per-night HR/HRV detail, hypnogram, and motion strips.
// Reuses globals from app.js: api, toast, css, dayToTs.

const STAGE_COLORS = { 1: "#5b6cff", 2: "#7aa2ff", 3: "#5cd6c0", 4: "#ffb86b" };
const STAGE_LABELS = { 1: "Deep", 2: "Light", 3: "REM", 4: "Awake" };
const MOVE_COLORS = { 1: "#1b2230", 2: "#3a4a66", 3: "#7aa2ff", 4: "#ff7ab6" };

const iv = {
  range: "14",
  nights: [],
  selected: null,
  chart: null,
  loaded: false,
  backfillTried: false,
};

// Parse granular series out of already-synced documents (background job).
function ensureBackfill() {
  iv.backfillTried = true;
  document.getElementById("night-list").innerHTML =
    `<div class="muted small" style="padding:8px">Parsing your sleep history…</div>`;
  runBackfill();
}

async function runBackfill() {
  const list = document.getElementById("night-list");
  const btn = document.getElementById("backfill-btn");
  btn.disabled = true;
  try {
    await api("/api/backfill", { method: "POST" });
  } catch (e) { toast("Backfill failed: " + e.message, 4000); btn.disabled = false; return; }
  const tick = async () => {
    let s;
    try { s = await api("/api/backfill/status"); } catch { setTimeout(tick, 1500); return; }
    if (s.running) {
      list.innerHTML = `<div class="muted small" style="padding:8px">Parsing your sleep ` +
        `history into high-resolution series… runs once (~15s per 90 days).</div>`;
      setTimeout(tick, 1500);
    } else {
      btn.disabled = false;
      if (s.error) { toast("Backfill error: " + s.error, 5000); return; }
      const np = (s.result && s.result.sleep && s.result.sleep.periods) || 0;
      toast(`Granular data ready: ${np} nights parsed.`);
      loadNights();
    }
  };
  tick();
}

function tsToUnix(ts) { return Date.parse(ts) / 1000; }

// --- view switching ---------------------------------------------------------
function switchView(view) {
  document.querySelectorAll("#nav .nav-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.view === view));
  document.getElementById("view-daily").classList.toggle("hidden", view !== "daily");
  document.getElementById("view-intraday").classList.toggle("hidden", view !== "intraday");
  if (view === "intraday" && !iv.loaded) { iv.loaded = true; loadNights(); }
  else if (view === "intraday" && iv.chart) { iv.chart.setSize(chartSizeIv()); redrawStrips(); }
}

// --- nights list ------------------------------------------------------------
function ivRange() {
  const end = new Date().toISOString().slice(0, 10);
  const start = new Date(Date.now() - parseInt(iv.range, 10) * 86400000)
    .toISOString().slice(0, 10);
  return { start, end };
}

async function loadNights() {
  const { start, end } = ivRange();
  try {
    const data = await api(`/api/sleep-periods?start=${start}&end=${end}`);
    iv.nights = (data.periods || []).slice().reverse();  // most recent first
  } catch (e) { toast("Could not load nights: " + e.message); return; }
  const list = document.getElementById("night-list");
  list.innerHTML = "";
  if (!iv.nights.length) {
    // First visit: parse granular series out of already-synced data, once.
    if (!iv.backfillTried) { ensureBackfill(); return; }
    list.innerHTML = `<div class="muted small" style="padding:8px">No sleep periods ` +
      `found. Run <b>Sync</b> first, then <b>Backfill granular</b>.</div>`;
    return;
  }
  for (const p of iv.nights) {
    const row = document.createElement("div");
    row.className = "night-item";
    const label = (p.type || "sleep").replace(/_/g, " ");
    row.innerHTML = `<span class="nday">${p.day}</span><span class="ntype">${label}</span>`;
    row.onclick = () => selectNight(p);
    list.appendChild(row);
  }
}

// --- night detail -----------------------------------------------------------
function chartSizeIv() {
  const panel = document.querySelector("#view-intraday .chart-panel");
  return { width: Math.max(panel.clientWidth - 24, 300),
           height: Math.max(panel.clientHeight - 24, 240) };
}

async function selectNight(p) {
  iv.selected = p;
  document.querySelectorAll("#night-list .night-item").forEach((el, i) =>
    el.classList.toggle("active", iv.nights[i] === p));
  document.getElementById("intraday-empty").style.display = "none";
  document.getElementById("night-title").textContent =
    `${p.day} · ${(p.type || "sleep").replace(/_/g, " ")} · ` +
    `${fmtClock(p.bedtime_start)} → ${fmtClock(p.bedtime_end)}`;

  const data = await api(
    `/api/intraday/samples?series=sleep_hr,sleep_hrv` +
    `&start=${encodeURIComponent(p.bedtime_start)}&end=${encodeURIComponent(p.bedtime_end)}`);
  drawNightChart(data.samples);
  renderStrips(p);
  renderNightStats(p, data.samples);
}

function fmtClock(ts) {
  if (!ts) return "?";
  return new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
}

function buildSamples(samples) {
  const tset = new Set();
  for (const k of ["sleep_hr", "sleep_hrv"]) for (const s of samples[k] || []) tset.add(s.ts);
  const tss = [...tset].sort();
  const xs = tss.map(tsToUnix);
  const cols = [xs];
  for (const k of ["sleep_hr", "sleep_hrv"]) {
    const m = {}; for (const s of samples[k] || []) m[s.ts] = s.value;
    cols.push(tss.map((t) => (t in m ? m[t] : null)));
  }
  return cols;
}

function drawNightChart(samples) {
  const data = buildSamples(samples);
  const { width, height } = chartSizeIv();
  const opts = {
    width, height,
    cursor: { drag: { x: true, y: false } },
    legend: { live: true },
    scales: { x: { time: true }, hr: {}, hrv: {} },
    axes: [
      { stroke: css("--muted"), grid: { stroke: css("--border"), width: 1 } },
      { scale: "hr", side: 3, stroke: STAGE_COLORS[1], label: "HR (bpm)",
        grid: { stroke: css("--border"), width: 1 } },
      { scale: "hrv", side: 1, stroke: STAGE_COLORS[3], label: "HRV (ms)",
        grid: { show: false } },
    ],
    series: [
      { label: "Time" },
      { label: "HR", scale: "hr", stroke: STAGE_COLORS[1], width: 1.5,
        points: { show: false }, value: (u, v) => v == null ? "—" : v.toFixed(0) + " bpm" },
      { label: "HRV", scale: "hrv", stroke: STAGE_COLORS[3], width: 1.5,
        points: { show: false }, value: (u, v) => v == null ? "—" : v.toFixed(0) + " ms" },
    ],
  };
  if (iv.chart) { iv.chart.destroy(); iv.chart = null; }
  iv.chart = new uPlot(opts, data, document.getElementById("intraday-chart"));
}

// hypnogram + movement strips, aligned under the chart's plot area
function stripSVG(seq, colors, plotLeft, plotW, height) {
  const n = seq.length;
  if (!n) return "";
  const w = plotW / n;
  let rects = "";
  for (let i = 0; i < n; i++) {
    const v = parseInt(seq[i], 10);
    const c = colors[v] || "var(--border)";
    rects += `<rect x="${(i * w).toFixed(2)}" y="0" width="${(w + 0.5).toFixed(2)}" height="${height}" fill="${c}"/>`;
  }
  return `<svg width="${plotW}" height="${height}" style="margin-left:${plotLeft}px;display:block">${rects}</svg>`;
}

function plotGeom() {
  // uPlot bbox is in canvas (device) px; convert to CSS px.
  const u = iv.chart;
  if (!u || !u.bbox) return { left: 40, width: 600 };
  const dpr = window.devicePixelRatio || 1;
  return { left: u.bbox.left / dpr, width: u.bbox.width / dpr };
}

function renderStrips(p) {
  const g = plotGeom();
  document.getElementById("hypnogram").innerHTML =
    stripSVG(p.hypnogram || "", STAGE_COLORS, g.left, g.width, 46);
  document.getElementById("movement").innerHTML =
    stripSVG(p.movement || "", MOVE_COLORS, g.left, g.width, 28);
  // legend
  document.getElementById("hypnogram-legend").innerHTML = Object.entries(STAGE_LABELS)
    .map(([v, lbl]) => `<span class="lg"><span class="sw" style="background:${STAGE_COLORS[v]}"></span>${lbl}</span>`)
    .join("");
}
function redrawStrips() { if (iv.selected) renderStrips(iv.selected); }

function renderNightStats(p, samples) {
  const wrap = document.getElementById("night-stats");
  const hr = (samples.sleep_hr || []).map((s) => s.value);
  const hrv = (samples.sleep_hrv || []).map((s) => s.value);
  // stage minutes from hypnogram, honouring its resolution (30-sec or 5-min)
  const minPerChar = (p.hypnogram_interval || 300) / 60;
  const stageMin = { 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const ch of (p.hypnogram || "")) { const v = parseInt(ch, 10); if (v in stageMin) stageMin[v] += minPerChar; }
  for (const k in stageMin) stageMin[k] = Math.round(stageMin[k]);
  const card = (label, val, dot) =>
    `<div class="stat"><div class="label">${dot ? `<span class="dot" style="background:${dot}"></span>` : ""}${label}</div>` +
    `<div class="big">${val}</div></div>`;
  const avg = (a) => a.length ? (a.reduce((x, y) => x + y, 0) / a.length) : null;
  const f = (v, u) => v == null ? "—" : v.toFixed(0) + (u ? ` <span class="sub" style="font-size:12px">${u}</span>` : "");
  wrap.innerHTML =
    card("Avg HR", f(avg(hr), "bpm")) +
    card("Min HR", f(hr.length ? Math.min(...hr) : null, "bpm")) +
    card("Avg HRV", f(avg(hrv), "ms")) +
    card("Deep", f(stageMin[1], "min"), STAGE_COLORS[1]) +
    card("Light", f(stageMin[2], "min"), STAGE_COLORS[2]) +
    card("REM", f(stageMin[3], "min"), STAGE_COLORS[3]) +
    card("Awake", f(stageMin[4], "min"), STAGE_COLORS[4]);
}

// --- wiring -----------------------------------------------------------------
(function wireIntraday() {
  document.querySelectorAll("#nav .nav-btn").forEach((b) =>
    b.addEventListener("click", () => switchView(b.dataset.view)));
  document.querySelectorAll("#intraday-ranges .chip").forEach((c) =>
    c.addEventListener("click", () => {
      document.querySelectorAll("#intraday-ranges .chip").forEach((x) => x.classList.remove("active"));
      c.classList.add("active"); iv.range = c.dataset.range; loadNights();
    }));
  document.getElementById("backfill-btn").addEventListener("click", () => {
    iv.backfillTried = true; runBackfill();
  });
  let rt;
  window.addEventListener("resize", () => {
    clearTimeout(rt);
    rt = setTimeout(() => {
      if (iv.chart && !document.getElementById("view-intraday").classList.contains("hidden")) {
        iv.chart.setSize(chartSizeIv()); redrawStrips();
      }
    }, 150);
  });
})();
