'use strict';

const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(express.json());

const SYMPHONY = 'http://localhost:4000';
const { AIRTABLE_API_KEY, AIRTABLE_BASE_ID } = process.env;
const LOGS_PATH = path.join(
  process.env.HOME,
  'Library/Application Support/JustJackSymphony/log/log/symphony.log.1'
);

// ── API routes ────────────────────────────────────────────────────────────────

app.get('/api/state', async (_req, res) => {
  try {
    const r = await fetch(`${SYMPHONY}/api/v1/state`);
    res.json(await r.json());
  } catch (e) {
    res.status(503).json({ error: `Symphony unreachable: ${e.message}` });
  }
});

app.post('/api/refresh', async (_req, res) => {
  try {
    const r = await fetch(`${SYMPHONY}/api/v1/refresh`, { method: 'POST' });
    res.status(r.status).json(await r.json());
  } catch (e) {
    res.status(503).json({ error: e.message });
  }
});

// Move an Airtable record to "Todo" and trigger a Symphony refresh
app.post('/api/deploy', async (req, res) => {
  const { recordId, tableId } = req.body;
  if (!recordId || !tableId) {
    return res.status(400).json({ error: 'recordId and tableId required' });
  }
  if (!AIRTABLE_API_KEY || !AIRTABLE_BASE_ID) {
    return res.status(503).json({
      error: 'AIRTABLE_API_KEY and AIRTABLE_BASE_ID env vars are not set on this server',
    });
  }
  try {
    const r = await fetch(
      `https://api.airtable.com/v0/${AIRTABLE_BASE_ID}/${tableId}/${recordId}`,
      {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${AIRTABLE_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ fields: { Status: 'Todo' } }),
      }
    );
    const data = await r.json();
    if (!r.ok) return res.status(r.status).json(data);
    await fetch(`${SYMPHONY}/api/v1/refresh`, { method: 'POST' }).catch(() => {});
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/logs', (_req, res) => {
  try {
    if (!fs.existsSync(LOGS_PATH)) return res.json({ lines: [], path: LOGS_PATH });
    const raw = fs.readFileSync(LOGS_PATH, 'utf8');
    const lines = raw.split('\n').filter(Boolean).slice(-400);
    res.json({ lines, path: LOGS_PATH });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Frontend ──────────────────────────────────────────────────────────────────

// Serve frontend with SSR initial state so the page loads with data immediately
app.get('/', async (_req, res) => {
  let initialState = null;
  try {
    const r = await fetch(`${SYMPHONY}/api/v1/state`);
    initialState = await r.json();
  } catch (_) {}
  const hasAirtable = !!(AIRTABLE_API_KEY && AIRTABLE_BASE_ID);
  const hydrated = HTML
    .replace('"__INITIAL_STATE__"', JSON.stringify(initialState))
    .replace('"__HAS_AIRTABLE__"', JSON.stringify(hasAirtable));
  res.send(hydrated);
});

// ── Start ─────────────────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3333;
app.listen(PORT, () => {
  const airtable = AIRTABLE_API_KEY && AIRTABLE_BASE_ID ? 'ready' : 'missing (deploy disabled)';
  console.log(`Hermes dashboard  →  http://localhost:${PORT}`);
  console.log(`Symphony          →  ${SYMPHONY}`);
  console.log(`Airtable creds    →  ${airtable}`);
});

// ── Inline HTML ───────────────────────────────────────────────────────────────

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Hermes</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

:root {
  --bg: #0d0f11;
  --surface: #141618;
  --border: #242628;
  --text: #e2e4e8;
  --muted: #6b7280;
  --accent: #7c6af7;
  --green: #34d399;
  --yellow: #fbbf24;
  --red: #f87171;
  --blue: #60a5fa;
  --card-bg: #181a1c;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
}

body { background: var(--bg); color: var(--text); min-height: 100vh; }

/* Layout */
.shell { max-width: 1400px; margin: 0 auto; padding: 24px 20px; }

/* Header */
.header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 28px; padding-bottom: 20px; border-bottom: 1px solid var(--border);
}
.header-left h1 { font-size: 20px; font-weight: 700; letter-spacing: -0.3px; }
.header-left h1 span { color: var(--accent); }
.metrics { display: flex; gap: 20px; align-items: center; margin-top: 6px; flex-wrap: wrap; }
.metric { font-size: 13px; color: var(--muted); }
.metric strong { color: var(--text); }
.header-right { display: flex; gap: 10px; align-items: center; }
.pulse { width: 8px; height: 8px; border-radius: 50%; background: var(--green); box-shadow: 0 0 0 0 var(--green); animation: pulse 2s infinite; }
.pulse.dead { background: var(--red); animation: none; }
@keyframes pulse { 0% { box-shadow: 0 0 0 0 rgba(52,211,153,.6); } 70% { box-shadow: 0 0 0 6px transparent; } 100% { box-shadow: 0 0 0 0 transparent; } }

/* Buttons */
button {
  cursor: pointer; border: none; border-radius: 6px; font-size: 12px;
  font-weight: 500; padding: 5px 11px; transition: opacity .15s;
}
button:disabled { opacity: .4; cursor: not-allowed; }
button:not(:disabled):hover { opacity: .8; }
.btn-ghost { background: var(--border); color: var(--text); }
.btn-accent { background: var(--accent); color: #fff; }
.btn-green { background: #065f46; color: var(--green); }
.btn-sm { font-size: 11px; padding: 3px 8px; }

/* Section headings */
.section-label {
  font-size: 11px; font-weight: 600; letter-spacing: .08em; text-transform: uppercase;
  color: var(--muted); margin-bottom: 14px;
}

/* Kanban */
.kanban-wrap { overflow-x: auto; padding-bottom: 8px; }
.kanban { display: flex; gap: 14px; min-width: max-content; }
.kanban-col { width: 260px; flex-shrink: 0; }
.kanban-col-header {
  display: flex; justify-content: space-between; align-items: center;
  margin-bottom: 10px;
}
.kanban-col-title { font-size: 13px; font-weight: 600; }
.kanban-col-count {
  font-size: 11px; background: var(--border); color: var(--muted);
  border-radius: 10px; padding: 1px 7px;
}
.kanban-cards { display: flex; flex-direction: column; gap: 8px; }
.kanban-card {
  background: var(--card-bg); border: 1px solid var(--border); border-radius: 8px;
  padding: 12px; transition: border-color .15s;
}
.kanban-card:hover { border-color: #3a3c40; }
.kanban-card.is-running { border-color: rgba(124,106,247,.5); }
.kanban-card.is-retrying { border-color: rgba(251,191,36,.4); }
.card-title { font-size: 13px; font-weight: 500; line-height: 1.35; margin-bottom: 6px; }
.card-desc {
  font-size: 12px; color: var(--muted); line-height: 1.45; margin-bottom: 8px;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden;
}
.card-actions { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.pill {
  font-size: 10px; font-weight: 600; padding: 2px 7px; border-radius: 10px;
  text-transform: uppercase; letter-spacing: .04em;
}
.pill-live { background: rgba(52,211,153,.15); color: var(--green); }
.pill-retry { background: rgba(251,191,36,.15); color: var(--yellow); }
.empty-col { font-size: 12px; color: var(--muted); padding: 10px 0; }

/* Running table */
.table-wrap { overflow-x: auto; }
table { width: 100%; border-collapse: collapse; font-size: 13px; }
th {
  text-align: left; font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: .06em; color: var(--muted); padding: 0 12px 10px 0; white-space: nowrap;
}
td { padding: 10px 12px 10px 0; border-top: 1px solid var(--border); vertical-align: top; }
tr:last-child td { border-bottom: 1px solid var(--border); }
.issue-id { font-family: monospace; font-size: 12px; color: var(--accent); }
.update-text { max-width: 340px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--muted); }
.mono { font-family: monospace; font-size: 12px; }
.badge {
  display: inline-block; font-size: 10px; font-weight: 600; padding: 2px 7px;
  border-radius: 4px; text-transform: uppercase; letter-spacing: .04em;
}
.badge-active { background: rgba(124,106,247,.2); color: var(--accent); }
.badge-warn { background: rgba(251,191,36,.15); color: var(--yellow); }
.badge-danger { background: rgba(248,113,113,.15); color: var(--red); }
.badge-default { background: var(--border); color: var(--muted); }

/* Logs */
.log-toolbar {
  display: flex; gap: 10px; align-items: center; margin-bottom: 10px; flex-wrap: wrap;
}
.log-filter {
  flex: 1; min-width: 180px; background: var(--surface); border: 1px solid var(--border);
  color: var(--text); border-radius: 6px; padding: 5px 10px; font-size: 12px;
}
.log-filter::placeholder { color: var(--muted); }
.log-filter:focus { outline: none; border-color: var(--accent); }
.log-box {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  height: 320px; overflow-y: auto; padding: 12px; font-family: 'SF Mono', 'Fira Code', monospace;
  font-size: 11.5px; line-height: 1.6;
}
.log-line { white-space: pre-wrap; word-break: break-all; }
.log-line.hl-error { color: var(--red); }
.log-line.hl-warn { color: var(--yellow); }
.log-line.hl-info { color: var(--blue); }
.log-line.hl-debug { color: var(--muted); }

/* Sections */
.section { margin-bottom: 32px; }

/* Toast */
#toasts {
  position: fixed; top: 20px; right: 20px; display: flex;
  flex-direction: column; gap: 8px; z-index: 999;
}
.toast {
  background: var(--surface); border: 1px solid var(--border); border-radius: 8px;
  padding: 10px 14px; font-size: 13px; min-width: 220px; max-width: 340px;
  animation: slide-in .2s ease; box-shadow: 0 4px 16px rgba(0,0,0,.4);
}
.toast.ok { border-color: rgba(52,211,153,.4); color: var(--green); }
.toast.err { border-color: rgba(248,113,113,.4); color: var(--red); }
@keyframes slide-in { from { opacity:0; transform: translateX(20px); } to { opacity:1; transform: none; } }

/* Misc */
a { color: var(--accent); text-decoration: none; }
a:hover { text-decoration: underline; }
.link-muted { color: var(--muted); font-size: 11px; }
.link-muted:hover { color: var(--text); }
</style>
</head>
<body>
<div class="shell">

  <header class="header">
    <div class="header-left">
      <h1>Hermes <span>/ Symphony</span></h1>
      <div class="metrics" id="metrics">
        <span class="metric">Loading…</span>
      </div>
    </div>
    <div class="header-right">
      <div class="pulse" id="pulse"></div>
      <button class="btn-ghost" id="btn-refresh" onclick="triggerRefresh()">↻ Force poll</button>
      <button class="btn-ghost" id="btn-logs-toggle" onclick="toggleLogs()">Logs</button>
    </div>
  </header>

  <div class="section" id="section-kanban">
    <div class="section-label">Kanban</div>
    <div class="kanban-wrap">
      <div class="kanban" id="kanban"><span style="color:var(--muted);font-size:13px">Loading…</span></div>
    </div>
  </div>

  <div class="section" id="section-running" style="display:none">
    <div class="section-label">Running agents</div>
    <div class="table-wrap">
      <table id="running-table">
        <thead>
          <tr>
            <th>Issue</th><th>State</th><th>Runtime / turns</th>
            <th>Last update</th><th>Tokens</th><th></th>
          </tr>
        </thead>
        <tbody id="running-body"></tbody>
      </table>
    </div>
  </div>

  <div class="section" id="section-logs" style="display:none">
    <div class="section-label">Symphony logs</div>
    <div class="log-toolbar">
      <input class="log-filter" id="log-filter" type="text" placeholder="Filter lines…" oninput="renderLogs()">
      <button class="btn-ghost btn-sm" onclick="loadLogs()">↻ Reload</button>
      <label style="font-size:12px;color:var(--muted);display:flex;gap:6px;align-items:center;cursor:pointer">
        <input type="checkbox" id="autoscroll" checked> Auto-scroll
      </label>
    </div>
    <div class="log-box" id="log-box"></div>
  </div>

</div>

<div id="toasts"></div>

<script>
let state = "__INITIAL_STATE__";
let logLines = [];
let logsVisible = false;
let deployDisabled = !"__HAS_AIRTABLE__";

function fmt(n) {
  if (n == null) return 'n/a';
  return n.toLocaleString();
}
function fmtSecs(s) {
  if (!s) return '0m 0s';
  return Math.floor(s / 60) + 'm ' + (s % 60) + 's';
}
function fmtRuntime(startedAt) {
  if (!startedAt) return '—';
  const diff = Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000);
  return fmtSecs(diff);
}
function badgeClass(st) {
  if (!st) return 'badge-default';
  const s = st.toLowerCase();
  if (s.includes('progress') || s.includes('running') || s.includes('active')) return 'badge-active';
  if (s.includes('retry') || s.includes('todo') || s.includes('pending')) return 'badge-warn';
  if (s.includes('error') || s.includes('failed') || s.includes('blocked')) return 'badge-danger';
  return 'badge-default';
}

function tableIdFromUrl(url) {
  if (!url) return null;
  const m = url.match(new RegExp('/(tbl[A-Za-z0-9]+)/'));
  return m ? m[1] : null;
}

function toast(msg, type = 'ok') {
  const el = document.createElement('div');
  el.className = 'toast ' + type;
  el.textContent = msg;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

async function triggerRefresh() {
  const btn = document.getElementById('btn-refresh');
  btn.disabled = true;
  try {
    const r = await fetch('/api/refresh', { method: 'POST' });
    if (r.ok) { toast('Poll triggered'); loadState(); }
    else { toast('Refresh failed', 'err'); }
  } catch { toast('Symphony unreachable', 'err'); }
  finally { btn.disabled = false; }
}

async function deploy(recordId, tableId, title) {
  if (!recordId || !tableId) { toast('Missing record/table ID', 'err'); return; }
  const btn = document.getElementById('deploy-' + recordId);
  if (btn) { btn.disabled = true; btn.textContent = 'Deploying…'; }
  try {
    const r = await fetch('/api/deploy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordId, tableId }),
    });
    const data = await r.json();
    if (r.ok) {
      toast('Deployed: ' + (title || recordId));
      setTimeout(loadState, 1200);
    } else {
      toast(data.error || 'Deploy failed', 'err');
      if (btn) { btn.disabled = false; btn.textContent = 'Deploy'; }
    }
  } catch (e) {
    toast('Error: ' + e.message, 'err');
    if (btn) { btn.disabled = false; btn.textContent = 'Deploy'; }
  }
}

function renderMetrics(s) {
  if (!s || s.error) {
    document.getElementById('metrics').innerHTML =
      '<span class="metric" style="color:var(--red)">' + (s?.error || 'Unreachable') + '</span>';
    document.getElementById('pulse').className = 'pulse dead';
    return;
  }
  document.getElementById('pulse').className = 'pulse';
  const c = s.counts || {};
  const t = s.codex_totals || {};
  document.getElementById('metrics').innerHTML =
    '<span class="metric">Running: <strong>' + (c.running || 0) + '</strong></span>' +
    '<span class="metric">Retrying: <strong>' + (c.retrying || 0) + '</strong></span>' +
    '<span class="metric">Tokens: <strong>' + fmt(t.total_tokens) + '</strong></span>' +
    '<span class="metric">Runtime: <strong>' + fmtSecs(t.seconds_running) + '</strong></span>' +
    '<span class="metric" style="color:var(--muted);font-size:11px">updated ' + new Date().toLocaleTimeString() + '</span>';
}

function renderKanban(s) {
  if (!s?.kanban?.columns) {
    document.getElementById('kanban').innerHTML = '<span style="color:var(--muted);font-size:13px">No kanban data</span>';
    return;
  }
  const runningIds = new Set((s.running || []).map(r => r.issue_identifier));
  const html = s.kanban.columns.map(col => {
    const cards = (col.cards || []).map(card => {
      const isRunning = card.running || runningIds.has(card.identifier);
      const tableId = tableIdFromUrl(card.tracker_url || card.url);
      const canDeploy = !deployDisabled && card.id && tableId;
      const isTerminal = ['completed','done','canceled','cancelled','duplicate','featured'].includes(col.state.toLowerCase());
      const deployBtn = (isRunning || col.state === 'Todo')
        ? ''
        : canDeploy
          ? \`<button class="btn-green btn-sm" id="deploy-\${card.id}" onclick="deploy('\${card.id}','\${tableId}',\${JSON.stringify(card.title)})">Deploy</button>\`
          : !deployDisabled
            ? '<span class="link-muted" title="Record ID or table ID unavailable">Deploy</span>'
            : '<span class="link-muted" title="Airtable creds not set on server">Deploy disabled</span>';
      return \`<article class="kanban-card\${isRunning ? ' is-running' : ''}\${card.retrying ? ' is-retrying' : ''}">
        <div class="card-title">\${esc(card.title || '(untitled)')}</div>
        \${card.description ? '<div class="card-desc">' + esc(card.description) + '</div>' : ''}
        <div class="card-actions">
          \${card.tracker_url ? '<a href="' + card.tracker_url + '" target="_blank" class="btn-ghost btn-sm">Tracker ↗</a>' : ''}
          \${deployBtn}
          \${isRunning ? '<span class="pill pill-live">Running</span>' : ''}
          \${card.retrying ? '<span class="pill pill-retry">Retrying</span>' : ''}
        </div>
      </article>\`;
    }).join('');
    return \`<div class="kanban-col">
      <div class="kanban-col-header">
        <span class="kanban-col-title">\${esc(col.state)}</span>
        <span class="kanban-col-count">\${col.cards?.length || 0}</span>
      </div>
      <div class="kanban-cards">
        \${cards || '<div class="empty-col">Empty</div>'}
      </div>
    </div>\`;
  }).join('');
  document.getElementById('kanban').innerHTML = html;
}

function renderRunning(s) {
  const running = s?.running || [];
  const section = document.getElementById('section-running');
  if (!running.length) { section.style.display = 'none'; return; }
  section.style.display = '';
  const rows = running.map(e => \`<tr>
    <td>
      <div class="issue-id">\${esc(e.issue_identifier || '—')}</div>
      \${e.issue_url ? '<a href="' + e.issue_url + '" target="_blank" class="link-muted">Tracker ↗</a>' : ''}
    </td>
    <td><span class="badge \${badgeClass(e.state)}">\${esc(e.state || '—')}</span></td>
    <td class="mono">\${fmtRuntime(e.started_at)}\${e.turn_count ? ' / ' + e.turn_count + 't' : ''}</td>
    <td><div class="update-text" title="\${esc(e.last_message || '')}">\${esc(e.last_message || e.last_event || '—')}</div></td>
    <td class="mono">\${fmt((e.tokens || {}).total_tokens)}</td>
    <td><button class="btn-ghost btn-sm" onclick="toggleLogs(true)">Logs</button></td>
  </tr>\`).join('');
  document.getElementById('running-body').innerHTML = rows;
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadState() {
  try {
    const r = await fetch('/api/state');
    state = await r.json();
  } catch { state = { error: 'Fetch failed' }; }
  renderMetrics(state);
  renderKanban(state);
  renderRunning(state);
}

async function loadLogs() {
  try {
    const r = await fetch('/api/logs');
    const data = await r.json();
    logLines = data.lines || [];
    renderLogs();
  } catch { logLines = ['[error reading logs]']; renderLogs(); }
}

function renderLogs() {
  const filter = document.getElementById('log-filter').value.toLowerCase();
  const box = document.getElementById('log-box');
  const visible = filter ? logLines.filter(l => l.toLowerCase().includes(filter)) : logLines;
  box.innerHTML = visible.map(line => {
    const lo = line.toLowerCase();
    let cls = '';
    if (lo.includes('[error]') || lo.includes(' error ') || lo.includes('exception')) cls = 'hl-error';
    else if (lo.includes('[warn]') || lo.includes('warning')) cls = 'hl-warn';
    else if (lo.includes('[info]') || lo.includes(' info ')) cls = 'hl-info';
    else if (lo.includes('[debug]') || lo.includes(' debug ')) cls = 'hl-debug';
    return '<div class="log-line ' + cls + '">' + esc(line) + '</div>';
  }).join('');
  if (document.getElementById('autoscroll').checked) {
    box.scrollTop = box.scrollHeight;
  }
}

function toggleLogs(forceOpen) {
  logsVisible = forceOpen === true ? true : !logsVisible;
  document.getElementById('section-logs').style.display = logsVisible ? '' : 'none';
  document.getElementById('btn-logs-toggle').textContent = logsVisible ? 'Hide logs' : 'Logs';
  if (logsVisible) loadLogs();
}

// Check if deploy is disabled (server will tell us via error on first deploy,
// but we probe state to set a flag for smarter UI)
async function checkDeployCapability() {
  // We infer from env: if state loaded ok, try a quick test; simpler to just
  // show deploy buttons and let the error toast explain if creds are missing.
}

// Boot — render SSR state immediately, then start polling for live updates
if (state) { renderMetrics(state); renderKanban(state); renderRunning(state); }
else loadState();
setInterval(loadState, 5000);
</script>
</body>
</html>`;
