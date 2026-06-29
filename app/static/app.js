"use strict";

const PALETTE = ["--c0", "--c1", "--c2", "--c3", "--c4", "--c5", "--c6", "--c7"];
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

const state = {
  catalog: [],
  byKey: {},
  selected: [],        // ordered list of metric keys
  range: "30",
  axisMode: "shared",  // "shared" | "separate" | "normalized"
  status: null,
  chart: null,
  chatHistory: [],
  seriesCache: {},
};

// --- API helpers ------------------------------------------------------------
async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...opts,
  });
  if (!res.ok) {
    let detail = res.statusText;
    try { detail = (await res.json()).detail || detail; } catch (_) {}
    throw new Error(detail);
  }
  return res.json();
}

function toast(msg, ms = 2600) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.classList.remove("hidden");
  clearTimeout(el._t);
  el._t = setTimeout(() => el.classList.add("hidden"), ms);
}

function colorFor(idx) { return css(PALETTE[idx % PALETTE.length]); }
function dayToTs(day) { return Date.parse(day + "T00:00:00Z") / 1000; }

// --- Status -----------------------------------------------------------------
async function loadStatus() {
  state.status = await api("/api/status");
  renderStatus();
  renderChatAvailability();
}

function renderStatus() {
  const s = state.status;
  const el = document.getElementById("status");
  if (!s.oura_connected) {
    el.innerHTML = `<b>Not connected.</b> Open Settings to connect your Oura account.`;
    return;
  }
  if (s.oura_error) {
    el.innerHTML = `<b style="color:var(--danger)">Oura error:</b> ${s.oura_error}`;
    return;
  }
  const info = s.oura_personal_info || {};
  const cov = s.coverage || {};
  const who = info.email ? info.email : "connected";
  let span = "no data yet — hit Sync";
  if (cov.first_day) span = `${cov.first_day} → ${cov.last_day} (${cov.days} days)`;
  const last = s.last_sync ? ` · last sync ${s.last_sync.status}` : "";
  el.innerHTML = `<b>${who}</b> · ${span}${last}`;
}

// --- Metric catalog / sidebar ----------------------------------------------
async function loadCatalog() {
  const data = await api("/api/catalog");
  state.catalog = data.metrics;
  state.byKey = {};
  for (const m of data.metrics) state.byKey[m.key] = m;
  renderMetricList("");
}

function renderMetricList(filter) {
  const list = document.getElementById("metric-list");
  list.innerHTML = "";
  const q = filter.toLowerCase();
  let lastGroup = null;
  for (const m of state.catalog) {
    if (q && !(`${m.label} ${m.group}`.toLowerCase().includes(q))) continue;
    if (m.group !== lastGroup) {
      const g = document.createElement("div");
      g.className = "metric-group";
      g.textContent = m.group;
      list.appendChild(g);
      lastGroup = m.group;
    }
    const idx = state.selected.indexOf(m.key);
    const active = idx >= 0;
    const row = document.createElement("div");
    row.className = "metric-item" + (active ? " active" : "");
    if (active) row.style.setProperty("--swatch", colorFor(idx));
    row.innerHTML =
      `<span class="dot"></span>` +
      `<span class="name">${m.label}</span>` +
      `<span class="unit">${m.unit || ""}</span>`;
    row.onclick = () => toggleMetric(m.key);
    list.appendChild(row);
  }
}

function setAxisMode(mode) {
  state.axisMode = mode;
  document.querySelectorAll("#axis-mode .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === mode));
  refresh();
}

function toggleMetric(key) {
  const i = state.selected.indexOf(key);
  if (i >= 0) state.selected.splice(i, 1);
  else state.selected.push(key);
  renderMetricList(document.getElementById("metric-filter").value);
  refresh();
}

// --- Date range -------------------------------------------------------------
function computeRange() {
  const cov = state.status?.coverage || {};
  const end = cov.last_day || new Date().toISOString().slice(0, 10);
  if (state.range === "all") return { start: cov.first_day || null, end };
  const days = parseInt(state.range, 10);
  const endD = new Date(end + "T00:00:00Z");
  const startD = new Date(endD.getTime() - days * 86400000);
  return { start: startD.toISOString().slice(0, 10), end };
}

// --- Refresh: fetch + draw --------------------------------------------------
async function refresh() {
  const empty = document.getElementById("chart-empty");
  const summary = document.getElementById("selection-summary");
  if (state.selected.length === 0) {
    empty.style.display = "flex";
    summary.textContent = "";
    destroyChart();
    document.getElementById("stats").innerHTML = "";
    return;
  }
  empty.style.display = "none";
  const { start, end } = computeRange();
  const data = await api(
    `/api/series?metrics=${state.selected.join(",")}` +
    (start ? `&start=${start}` : "") + (end ? `&end=${end}` : "")
  );
  state.seriesCache = data.series;
  summary.textContent =
    `${state.selected.length} metric${state.selected.length > 1 ? "s" : ""}` +
    (start ? ` · ${start} → ${end}` : "");
  drawChart(data.series);
  renderStats(data.series);
}

function normalizeValues(vals) {
  const nums = vals.filter((v) => v != null);
  if (!nums.length) return vals;
  const min = Math.min(...nums), max = Math.max(...nums);
  const span = max - min || 1;
  return vals.map((v) => (v == null ? null : (v - min) / span));
}

function buildAligned(series) {
  // union of all days across selected metrics
  const daySet = new Set();
  for (const key of state.selected) {
    for (const p of series[key] || []) daySet.add(p.day);
  }
  const days = [...daySet].sort();
  const xs = days.map(dayToTs);
  const cols = [xs];
  for (const key of state.selected) {
    const map = {};
    for (const p of series[key] || []) map[p.day] = p.value;
    let col = days.map((d) => (d in map ? map[d] : null));
    if (state.axisMode === "normalized") col = normalizeValues(col);
    cols.push(col);
  }
  return cols;
}

function destroyChart() {
  if (state.chart) { state.chart.destroy(); state.chart = null; }
}

function chartSize() {
  const panel = document.querySelector(".chart-panel");
  return { width: Math.max(panel.clientWidth - 24, 300),
           height: Math.max(panel.clientHeight - 24, 280) };
}

function drawChart(series) {
  const mode = state.axisMode;
  const data = buildAligned(series);
  const sel = state.selected;

  const seriesOpts = [{ label: "Day" }];
  const scales = { x: { time: true } };
  // x-axis is always first
  const axes = [{ stroke: css("--muted"), grid: { stroke: css("--border"), width: 1 },
                  ticks: { stroke: css("--border") } }];

  sel.forEach((key, idx) => {
    const m = state.byKey[key];
    const scaleKey = mode === "separate" ? `y_${key}` : "y";
    if (mode === "separate") scales[scaleKey] = {};
    seriesOpts.push({
      label: mode === "normalized" ? m.label : `${m.label}${m.unit ? " (" + m.unit + ")" : ""}`,
      stroke: colorFor(idx),
      width: 2,
      scale: scaleKey,
      points: { show: false },
      spanGaps: false,
      value: (u, v) => (v == null ? "—"
        : mode === "normalized" ? v.toFixed(2)
        : v.toFixed(m.decimals) + (m.unit ? " " + m.unit : "")),
    });
  });

  if (mode === "separate") {
    // first metric gets the left axis, second gets the right; the rest keep
    // their own independent scale but no labelled axis (read them off the
    // legend / stat cards). Axis colour matches the series.
    sel.forEach((key, idx) => {
      if (idx === 0) {
        axes.push({ scale: `y_${key}`, side: 3, stroke: colorFor(0),
          grid: { stroke: css("--border"), width: 1 }, ticks: { stroke: css("--border") } });
      } else if (idx === 1) {
        axes.push({ scale: `y_${key}`, side: 1, stroke: colorFor(1),
          grid: { show: false }, ticks: { stroke: css("--border") } });
      }
    });
  } else {
    axes.push({ stroke: css("--muted"), grid: { stroke: css("--border"), width: 1 },
                ticks: { stroke: css("--border") } });
  }

  const { width, height } = chartSize();
  const opts = {
    width,
    height: Math.max(height - 40, 200),  // reserve initial room; fitLegend refines
    cursor: { drag: { x: true, y: false } },
    legend: { live: true },
    scales,
    axes,
    series: seriesOpts,
  };
  destroyChart();
  state.chart = new uPlot(opts, data, document.getElementById("chart"));
  fitLegend();
}

// Resize the plot so the canvas + legend exactly fit the panel — keeps the
// legend from spilling over the stat cards below.
function fitLegend() {
  if (!state.chart) return;
  const panel = document.querySelector(".chart-panel");
  const avail = Math.max(panel.clientHeight - 24, 220);
  const legend = state.chart.root.querySelector(".u-legend");
  const legendH = legend ? legend.offsetHeight : 0;
  const target = Math.max(avail - legendH - 8, 180);
  if (Math.abs(state.chart.height - target) > 3) {
    state.chart.setSize({ width: chartSize().width, height: target });
  }
}

// --- Stats cards ------------------------------------------------------------
function renderStats(series) {
  const wrap = document.getElementById("stats");
  wrap.innerHTML = "";
  state.selected.forEach((key, idx) => {
    const m = state.byKey[key];
    const pts = series[key] || [];
    const vals = pts.map((p) => p.value);
    const card = document.createElement("div");
    card.className = "stat";
    if (!vals.length) {
      card.innerHTML =
        `<div class="label"><span class="dot" style="background:${colorFor(idx)}"></span>${m.label}</div>` +
        `<div class="big">—</div><div class="sub">no data in range</div>`;
      wrap.appendChild(card);
      return;
    }
    const latest = vals[vals.length - 1];
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    const min = Math.min(...vals), max = Math.max(...vals);
    // trend: last value vs mean of all but last
    let trend = "";
    if (vals.length > 3) {
      const prior = vals.slice(0, -1);
      const pmean = prior.reduce((a, b) => a + b, 0) / prior.length;
      const up = latest >= pmean;
      const pct = pmean ? Math.abs((latest - pmean) / pmean * 100) : 0;
      trend = `<span class="trend ${up ? "up" : "down"}">${up ? "▲" : "▼"} ${pct.toFixed(0)}% vs avg</span>`;
    }
    const fmt = (v) => v.toFixed(m.decimals);
    card.innerHTML =
      `<div class="label"><span class="dot" style="background:${colorFor(idx)}"></span>${m.label}</div>` +
      `<div class="big">${fmt(latest)}<span class="sub" style="font-size:12px"> ${m.unit}</span></div>` +
      `<div class="sub">avg ${fmt(mean)} · ${fmt(min)}–${fmt(max)} ${trend}</div>`;
    wrap.appendChild(card);
  });
}

// --- Saved views ------------------------------------------------------------
async function loadViews() {
  const data = await api("/api/views");
  const wrap = document.getElementById("views-list");
  wrap.innerHTML = "";
  if (!data.views.length) {
    wrap.innerHTML = `<div class="muted small">No saved views yet.</div>`;
    return;
  }
  for (const v of data.views) {
    const row = document.createElement("div");
    row.className = "view-row";
    row.innerHTML =
      `<span class="vname">${v.name}</span>` +
      `<button class="vdel" title="delete">✕</button>`;
    row.querySelector(".vname").onclick = () => applyView(v);
    row.querySelector(".vdel").onclick = async (e) => {
      e.stopPropagation();
      await api(`/api/views/${v.id}`, { method: "DELETE" });
      loadViews();
    };
    wrap.appendChild(row);
  }
}

function applyView(v) {
  const cfg = v.config || {};
  state.selected = (cfg.metrics || []).filter((k) => k in state.byKey);
  if (cfg.range) state.range = cfg.range;
  // accept the new axisMode, or fall back to the old normalize boolean
  state.axisMode = cfg.axisMode || (cfg.normalize ? "normalized" : "shared");
  document.querySelectorAll("#axis-mode .seg-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.mode === state.axisMode));
  document.querySelectorAll("#ranges .chip").forEach((c) =>
    c.classList.toggle("active", c.dataset.range === state.range));
  renderMetricList(document.getElementById("metric-filter").value);
  refresh();
}

async function saveView() {
  const name = document.getElementById("view-name").value.trim();
  if (!name) { toast("Name the view first."); return; }
  if (!state.selected.length) { toast("Select metrics to save."); return; }
  await api("/api/views", {
    method: "POST",
    body: JSON.stringify({
      name,
      config: { metrics: state.selected, range: state.range, axisMode: state.axisMode },
    }),
  });
  document.getElementById("view-name").value = "";
  loadViews();
  toast("View saved.");
}

// --- Sync -------------------------------------------------------------------
async function doSync() {
  const btn = document.getElementById("sync-btn");
  btn.disabled = true; btn.textContent = "Syncing…";
  try {
    const res = await api("/api/sync", { method: "POST", body: JSON.stringify({}) });
    const errs = Object.keys(res.errors || {}).length;
    toast(`Synced ${res.metrics_written} values${errs ? `, ${errs} collection error(s)` : ""}.`);
    await loadStatus();
    refresh();
  } catch (e) {
    toast("Sync failed: " + e.message, 4000);
  } finally {
    btn.disabled = false; btn.textContent = "Sync";
  }
}

// --- Settings / Oura connection ---------------------------------------------
function openModal() {
  document.getElementById("modal").classList.remove("hidden");
  renderConnect();
  const info = document.getElementById("settings-info");
  const s = state.status;
  info.innerHTML = s?.chat_enabled
    ? `AI chat: <b style="color:var(--accent-2)">enabled</b> (${s.model})`
    : `AI chat: disabled — set ANTHROPIC_API_KEY in your .env to enable.`;
}
function closeModal() { document.getElementById("modal").classList.add("hidden"); }

function renderConnect() {
  const s = state.status || {};
  const box = document.getElementById("oura-connect");
  if (s.oura_connected) {
    const who = s.oura_personal_info?.email || "your Oura account";
    const mode = s.oura_auth?.mode === "pat" ? "Personal Access Token" : "OAuth2";
    box.innerHTML =
      `<p class="muted">Connected to <b>${who}</b> via ${mode}.</p>` +
      `<div class="modal-actions">` +
      `<button id="disconnect-btn" class="btn ghost">Disconnect</button></div>`;
    document.getElementById("disconnect-btn").onclick = disconnectOura;
    return;
  }
  if (!s.oauth_configured) {
    box.innerHTML =
      `<p class="muted">Oura now uses <b>OAuth2</b> (Personal Access Tokens were ` +
      `retired in 2025). To connect:</p>` +
      `<ol class="muted small" style="line-height:1.7;padding-left:18px">` +
      `<li>Create an app at <a href="https://cloud.ouraring.com/oauth/applications" ` +
      `target="_blank" rel="noreferrer">cloud.ouraring.com/oauth/applications</a></li>` +
      `<li>Add this Redirect URI to it:<br><code>${s.redirect_uri || ""}</code></li>` +
      `<li>Put the client id/secret in your <code>.env</code> and restart.</li></ol>`;
    return;
  }
  box.innerHTML =
    `<p class="muted">Connect your Oura account. You'll be sent to Oura to ` +
    `authorize, then returned here.</p>` +
    `<p class="muted small">This exact Redirect URI must be registered on your ` +
    `Oura app at <a href="https://cloud.ouraring.com/oauth/applications" ` +
    `target="_blank" rel="noreferrer">cloud.ouraring.com/oauth/applications</a>:` +
    `<br><code>${s.redirect_uri || ""}</code></p>` +
    `<p class="muted small">A <b>400 invalid_request</b> from Oura means this ` +
    `URI isn't on the app's Redirect URIs list yet — add it there and retry.</p>` +
    `<div class="modal-actions">` +
    `<a class="btn" href="/api/auth/login">Connect Oura</a></div>`;
}

async function disconnectOura() {
  await api("/api/auth/disconnect", { method: "POST" });
  await loadStatus();
  renderConnect();
  toast("Disconnected from Oura.");
}

// --- Chat -------------------------------------------------------------------
function renderChatAvailability() {
  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  const send = document.getElementById("chat-send");
  const enabled = state.status?.chat_enabled;
  input.disabled = !enabled; send.disabled = !enabled;
  if (!enabled) {
    input.placeholder = "Set ANTHROPIC_API_KEY to enable chat.";
  }
}

function addMsg(role, text) {
  const log = document.getElementById("chat-log");
  const hint = document.getElementById("chat-hint");
  if (hint) hint.remove();
  const el = document.createElement("div");
  el.className = `msg ${role}`;
  el.textContent = text;
  log.appendChild(el);
  log.scrollTop = log.scrollHeight;
  return el;
}

async function sendChat(e) {
  e.preventDefault();
  const input = document.getElementById("chat-input");
  const question = input.value.trim();
  if (!question) return;
  input.value = "";
  addMsg("user", question);
  state.chatHistory.push({ role: "user", content: question });
  const { start, end } = computeRange();
  const bubble = addMsg("assistant", "");
  bubble.textContent = "…";

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        question, metrics: state.selected, start, end,
        history: state.chatHistory.slice(0, -1),
      }),
    });
    if (!res.ok) throw new Error((await res.json()).detail || res.statusText);

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "", answer = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parts = buffer.split("\n\n");
      buffer = parts.pop();
      for (const part of parts) {
        const line = part.trim();
        if (!line.startsWith("data:")) continue;
        const payload = JSON.parse(line.slice(5).trim());
        if (payload.text) {
          answer += payload.text;
          bubble.textContent = answer;
          document.getElementById("chat-log").scrollTop = 1e9;
        } else if (payload.error) {
          bubble.className = "msg error";
          bubble.textContent = "Error: " + payload.error;
        }
      }
    }
    if (answer) state.chatHistory.push({ role: "assistant", content: answer });
    if (!answer && bubble.textContent === "…") bubble.textContent = "(no response)";
  } catch (err) {
    bubble.className = "msg error";
    bubble.textContent = "Error: " + err.message;
  }
}

// --- Wire up ----------------------------------------------------------------
function wire() {
  document.getElementById("sync-btn").onclick = doSync;
  document.getElementById("settings-btn").onclick = openModal;
  document.getElementById("modal-close").onclick = closeModal;
  document.getElementById("metric-filter").oninput = (e) => renderMetricList(e.target.value);
  document.getElementById("clear-metrics").onclick = () => {
    state.selected = [];
    renderMetricList(document.getElementById("metric-filter").value);
    refresh();
  };
  document.getElementById("save-view").onclick = saveView;
  document.getElementById("chat-form").onsubmit = sendChat;
  document.getElementById("chat-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(e); }
  });
  document.querySelectorAll("#axis-mode .seg-btn").forEach((btn) => {
    btn.onclick = () => setAxisMode(btn.dataset.mode);
  });
  document.querySelectorAll("#ranges .chip").forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll("#ranges .chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.range = chip.dataset.range;
      refresh();
    };
  });
  let resizeT;
  window.addEventListener("resize", () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => { if (state.chart) drawChart(state.seriesCache); }, 150);
  });
}

function handleOAuthReturn() {
  const params = new URLSearchParams(location.search);
  const result = params.get("oura");
  if (!result) return null;
  history.replaceState({}, "", location.pathname);
  return result === "connected"
    ? { ok: true }
    : { ok: false, reason: params.get("reason") || "unknown" };
}

async function init() {
  wire();
  const ret = handleOAuthReturn();
  try {
    await loadStatus();
    await loadCatalog();
    await loadViews();
    if (ret && ret.ok) {
      toast("Connected to Oura — hit Sync to pull your data.", 3500);
    } else if (ret && !ret.ok) {
      toast("Oura connection failed: " + ret.reason, 5000);
      openModal();
    } else if (!state.status.oura_connected) {
      openModal();
    }
  } catch (e) {
    toast("Startup error: " + e.message, 5000);
  }
}

init();
