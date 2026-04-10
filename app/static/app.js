/**
 * Aquaponics Tracker — Frontend Logic
 */

'use strict';

// ── Auth ───────────────────────────────────────────────────
const TOKEN_KEY = 'aqp_token';

function getToken() { return localStorage.getItem(TOKEN_KEY); }

function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  document.getElementById('app-shell').style.display = 'none';
  document.getElementById('login-screen').style.display = 'flex';
  document.getElementById('login-error').style.display = 'none';
  document.getElementById('login-email').value = '';
  document.getElementById('login-password').value = '';
}

async function submitLogin() {
  const email    = document.getElementById('login-email').value.trim();
  const password = document.getElementById('login-password').value;
  const errEl    = document.getElementById('login-error');
  const btn      = document.getElementById('login-btn');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Signing in…';

  try {
    const res = await fetch('/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.detail || 'Invalid email or password');
    }
    const { token } = await res.json();
    localStorage.setItem(TOKEN_KEY, token);
    showApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Sign in';
  }
}

function showApp() {
  document.getElementById('login-screen').style.display = 'none';
  document.getElementById('app-shell').style.display = 'block';
  init();
}

async function checkAuthAndLoad() {
  const token = getToken();
  if (!token) { clearAuth(); return; }
  try {
    const res = await fetch('/auth/check', {
      headers: { 'Authorization': `Bearer ${token}` },
    });
    if (res.ok) { showApp(); } else { clearAuth(); }
  } catch { clearAuth(); }
}

// Authenticated fetch wrapper — injects token and handles 401
async function apiFetch(url, options = {}) {
  const token = getToken();
  const headers = { ...(options.headers || {}), 'Authorization': `Bearer ${token}` };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401) { clearAuth(); return null; }
  return res;
}

// ── State ──────────────────────────────────────────────────
let currentTab = 'dashboard';
let trendChart = null;
let historyEntries = [];
let suppHistoryEntries = [];
let appSettings = { visible_params: null }; // null = all visible (default until loaded)

// Map from param key → supplement nutrient key (only for params that have supplements)
const PARAM_TO_NUTRIENT = {
  ph:        'ph_adjustment',
  potassium: 'potassium',
  calcium:   'calcium',
  magnesium: 'magnesium',
  iron:      'iron',
};

let quickLogParamKey = null;
let quickLogMode = 'reading'; // 'reading' | 'supplement'

const NUTRIENT_LABELS = {
  calcium:        'Calcium (Ca)',
  iron:           'Iron (Fe)',
  magnesium:      'Magnesium (Mg)',
  micronutrients: 'Micronutrients',
  ph_adjustment:  'pH Adjustment',
  potassium:      'Potassium (K)',
  water_change:   'Water Change',
};

// ── Parameter metadata ──────────────────────────────────────
const PARAMS = [
  {
    key: 'ph', label: 'pH', unit: '',
    good: [6.8, 7.4], warn: [6.5, 7.8],
    description: 'Optimal: 6.8 – 7.4'
  },
  {
    key: 'ammonia', label: 'Ammonia', unit: 'ppm',
    good: [0, 0.5], warn: [0, 1.0],
    description: 'Target: < 0.5 ppm'
  },
  {
    key: 'nitrite', label: 'Nitrite (NO₂)', unit: 'ppm',
    good: [0, 0.5], warn: [0, 1.0],
    description: 'Target: < 0.5 ppm'
  },
  {
    key: 'nitrate', label: 'Nitrate (NO₃)', unit: 'ppm',
    good: [20, 100], warn: [5, 150],
    description: 'Optimal: 20 – 100 ppm'
  },
  {
    key: 'dissolved_oxygen', label: 'Dissolved O₂', unit: 'ppm',
    good: [6, 12], warn: [4, 12],
    description: 'Target: > 6 ppm'
  },
  {
    key: 'temperature', label: 'Temperature', unit: '°C',
    good: [22, 28], warn: [18, 30],
    description: 'Optimal: 22 – 28°C'
  },
  {
    key: 'iron', label: 'Iron (Fe)', unit: 'ppm',
    good: [2, 4], warn: [1, 6],
    description: 'Target: 2 – 4 ppm'
  },
  {
    key: 'potassium', label: 'Potassium (K)', unit: 'ppm',
    good: [10, 40], warn: [5, 60],
    description: 'Target: 10 – 40 ppm'
  },
  {
    key: 'calcium', label: 'Calcium (Ca)', unit: 'ppm',
    good: [40, 80], warn: [20, 100],
    description: 'Target: 40 – 80 ppm'
  },
  {
    key: 'magnesium', label: 'Magnesium (Mg)', unit: 'ppm',
    good: [10, 30], warn: [5, 50],
    description: 'Target: 10 – 30 ppm'
  },
];

// ── Utility ────────────────────────────────────────────────
function fmt(v, decimals = 2) {
  if (v === null || v === undefined) return '—';
  return parseFloat(v).toFixed(decimals);
}

function getStatus(param, value) {
  if (value === null || value === undefined) return 'none';
  const v = parseFloat(value);
  if (isNaN(v)) return 'none';
  if (v >= param.good[0] && v <= param.good[1]) return 'good';
  if (v >= param.warn[0] && v <= param.warn[1]) return 'warn';
  return 'alert';
}

function getCellClass(param, value) {
  const s = getStatus(param, value);
  return s === 'good' ? 'cell-good' : s === 'warn' ? 'cell-warn' : s === 'alert' ? 'cell-alert' : '';
}

// ── Tab navigation ─────────────────────────────────────────
function switchTab(name) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));

  const tabBtn = document.querySelector(`[data-tab="${name}"]`);
  if (tabBtn) tabBtn.classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  currentTab = name;

  if (name === 'dashboard') {
    loadDashboard();
  } else if (name === 'track') {
    document.getElementById('entry-date').value = localDateString();
    document.getElementById('supp-date').value = localDateString();
  } else if (name === 'history') {
    loadHistory();
  } else if (name === 'learnings') {
    // learnings loaded on demand when saved sub-tab is clicked
  } else if (name === 'admin') {
    loadAdminPanel();
  }
}

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchSubTab(name) {
  // buttons
  document.querySelectorAll('.sub-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.subtab === name);
  });
  // panels — use inline style so there's no cascade conflict
  document.querySelectorAll('.sub-tab-panel').forEach(p => {
    p.style.display = p.id === `subtab-${name}` ? 'block' : 'none';
  });
  if (name === 'saved') loadLearnings();
}

document.querySelectorAll('.sub-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchSubTab(btn.dataset.subtab));
});

// initialise panels on load
document.querySelectorAll('.sub-tab-panel').forEach((p, i) => {
  p.style.display = i === 0 ? 'block' : 'none';
});

// ── Track sub-tabs (Readings / Supplements) ────────────────
function switchTrackSubTab(name) {
  document.querySelectorAll('.track-sub-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.tracktab === name);
  });
  document.querySelectorAll('.track-sub-tab-panel').forEach(p => {
    p.style.display = p.id === `tracktab-${name}` ? 'block' : 'none';
  });
  if (name === 'supplements') loadSupplementLog();
}

document.querySelectorAll('.track-sub-tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTrackSubTab(btn.dataset.tracktab));
});

// initialise track sub-tab panels on load
document.querySelectorAll('.track-sub-tab-panel').forEach((p, i) => {
  p.style.display = i === 0 ? 'block' : 'none';
});

// ── Dashboard ──────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [latestRes, histRes] = await Promise.all([
      apiFetch('/api/latest'),
      apiFetch('/api/history?days=30')
    ]);
    const { entry } = await latestRes.json();
    const { entries } = await histRes.json();
    historyEntries = entries;

    renderParamCards(entry);
    renderRatioCard(entry);
    renderNotesPreview(entry);
    renderTrendChart(entries, document.getElementById('chart-metric').value);
    loadCachedInsights();

    document.getElementById('last-updated-label').textContent =
      entry ? `Last entry: ${entry.date}` : 'No readings yet';
  } catch (e) {
    console.error('Dashboard load error:', e);
  }
}

// ── Mineral Balance Card ────────────────────────────────────
const MINERAL_PARAMS = [
  { key: 'potassium', label: 'K',  good: [10, 40],  warn: [5, 60]   },
  { key: 'calcium',   label: 'Ca', good: [40, 80],  warn: [20, 100] },
  { key: 'magnesium', label: 'Mg', good: [10, 30],  warn: [5, 50]   },
];

function mineralStatus(param, value) {
  if (value == null) return 'none';
  if (value >= param.good[0] && value <= param.good[1]) return 'good';
  if (value >= param.warn[0] && value <= param.warn[1]) return 'warn';
  return 'alert';
}

// Ideal K:Ca:Mg ratio = 4:4:1 → Ca/K ideal = 1, Ca/Mg ideal = 4, K/Mg ideal = 4
function ratioStatus(k, ca, mg) {
  if (k == null || ca == null || mg == null || k === 0 || mg === 0) return 'none';
  const caK  = ca / k;   // ideal: 1
  const caMg = ca / mg;  // ideal: 4
  const kMg  = k  / mg;  // ideal: 4
  // Check each ratio against good/warn thresholds
  const caKStatus  = caK  >= 0.7 && caK  <= 1.4 ? 'good' : caK  >= 0.5 && caK  <= 2.0 ? 'warn' : 'alert';
  const caMgStatus = caMg >= 2.5 && caMg <= 6.0 ? 'good' : caMg >= 1.5 && caMg <= 8.0 ? 'warn' : 'alert';
  const kMgStatus  = kMg  >= 2.5 && kMg  <= 6.0 ? 'good' : kMg  >= 1.5 && kMg  <= 8.0 ? 'warn' : 'alert';
  const all = [caKStatus, caMgStatus, kMgStatus];
  return all.includes('alert') ? 'alert' : all.includes('warn') ? 'warn' : 'good';
}

function renderRatioCard(entry) {
  const grid = document.getElementById('param-grid');
  let card = document.getElementById('ratio-grid-card');
  if (!card) {
    card = document.createElement('div');
    card.id = 'ratio-grid-card';
    grid.appendChild(card);
  }

  const [k, ca, mg] = MINERAL_PARAMS.map(p => entry?.[p.key]);
  const hasAll = [k, ca, mg].every(v => v != null && v > 0);

  const overall = hasAll ? ratioStatus(k, ca, mg) : 'none';
  card.className = `param-card ratio-grid-card status-${overall}`;

  let r = ['—', '—', '—'];
  if (hasAll) {
    const min = Math.min(k, ca, mg);
    r = [k, ca, mg].map(v => {
      const n = v / min;
      return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
    });
  }

  card.innerHTML = `
    <div class="param-label"><span class="status-dot"></span>Mineral Balance <span class="ratio-minerals">K · Ca · Mg</span></div>
    <div class="param-value ratio-row">
      <span>${r[0]}</span><span class="ratio-colon">:</span><span>${r[1]}</span><span class="ratio-colon">:</span><span>${r[2]}</span>
    </div>
    <div class="param-range">Ideal ratio ≈ 4 : 4 : 1</div>`;
}

// ── AI Insights ────────────────────────────────────────────
function showInsightsResult(data) {
  const body    = document.getElementById('insights-body');
  const updated = document.getElementById('insights-updated');
  const regen   = document.getElementById('insights-regen-btn');
  const askSection = document.getElementById('ask-question-section');

  body.innerHTML = `<div class="insights-body response-body">${marked.parse(data.insights)}</div>`;
  updated.textContent = data.updated_at
    ? `Updated ${new Date(data.updated_at).toLocaleDateString()}`
    : '';
  regen.style.display = '';
  if (askSection) askSection.style.display = '';
}

function showInsightsCTA() {
  document.getElementById('insights-body').innerHTML = `
    <div class="insights-cta" id="insights-cta">
      <p>Analyze your tracking history for correlations between past parameter changes and current symptoms.</p>
      <button class="btn btn-primary" onclick="generateInsights()">Generate Insights</button>
    </div>`;
  document.getElementById('insights-updated').textContent = '';
  document.getElementById('insights-regen-btn').style.display = 'none';
  const askSection = document.getElementById('ask-question-section');
  if (askSection) askSection.style.display = 'none';
}

async function loadCachedInsights() {
  try {
    const res  = await apiFetch('/api/insights?generate=false');
    const data = await res.json();
    if (data.insights) showInsightsResult(data);
    else showInsightsCTA();
  } catch (e) {
    showInsightsCTA();
  }
}

async function generateInsights() {
  const body  = document.getElementById('insights-body');
  const regen = document.getElementById('insights-regen-btn');
  body.innerHTML = '<span class="insights-loading">Consulting specialists and analyzing your data…</span>';
  regen.style.display = 'none';

  try {
    const res  = await apiFetch('/api/insights');
    const data = await res.json();
    if (data.insights) showInsightsResult(data);
    else {
      body.innerHTML = '<span class="insights-loading">Not enough data yet — log at least 3 entries first.</span>';
    }
  } catch (e) {
    body.innerHTML = '<span class="insights-loading">Error generating insights.</span>';
  }
}

function visibleParams() {
  const vp = appSettings.visible_params;
  if (!vp || !vp.length) return PARAMS;
  return PARAMS.filter(p => vp.includes(p.key));
}

function applyParamVisibility() {
  const vp = appSettings.visible_params;
  if (!vp) return;
  document.querySelectorAll('[data-param]').forEach(el => {
    el.style.display = vp.includes(el.dataset.param) ? '' : 'none';
  });
}

function renderParamCards(entry) {
  const grid = document.getElementById('param-grid');
  grid.innerHTML = '';

  visibleParams().forEach(p => {
    const value = entry ? entry[p.key] : null;
    const status = getStatus(p, value);
    const displayVal = value !== null && value !== undefined
      ? fmt(value, p.key === 'ph' ? 1 : 0)
      : '—';

    const card = document.createElement('div');
    card.className = `param-card status-${status}`;
    card.title = `Click to log ${p.label}`;
    card.innerHTML = `
      <div class="param-label">
        <span class="status-dot"></span>${p.label}
      </div>
      <div class="param-value">${displayVal}<span class="param-unit">${p.unit}</span></div>
      <div class="param-range">${p.description}</div>
    `;
    card.addEventListener('click', () => openQuickLog(p.key));
    grid.appendChild(card);
  });
}

function renderNotesPreview(entry) {
  const card = document.getElementById('notes-card');
  const preview = document.getElementById('notes-preview');
  if (entry && entry.plant_notes) {
    card.style.display = '';
    preview.textContent = entry.plant_notes;
  } else {
    card.style.display = 'none';
  }
}

function renderTrendChart(entries, metric) {
  const param = PARAMS.find(p => p.key === metric);
  if (!param) return;

  const labels = entries.map(e => e.date);
  const data = entries.map(e => e[metric]);

  const ctx = document.getElementById('trend-chart').getContext('2d');

  if (trendChart) {
    trendChart.destroy();
    trendChart = null;
  }

  // Build zone color
  const colorMap = {
    good: 'rgb(34,197,94)',
    warn: 'rgb(250,204,21)',
    alert: 'rgb(248,113,113)',
  };

  const pointColors = data.map(v => {
    const s = getStatus(param, v);
    return colorMap[s] || 'rgb(100,116,139)';
  });

  trendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: `${param.label}${param.unit ? ' (' + param.unit + ')' : ''}`,
        data,
        borderColor: 'rgb(34,197,94)',
        backgroundColor: 'rgba(34,197,94,0.1)',
        pointBackgroundColor: pointColors,
        pointRadius: 5,
        pointHoverRadius: 7,
        fill: true,
        tension: 0.3,
        spanGaps: true,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: ctx => `${fmt(ctx.raw)} ${param.unit}`.trim()
          }
        }
      },
      scales: {
        x: {
          ticks: { maxTicksLimit: 10, font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,.05)' }
        },
        y: {
          ticks: { font: { size: 11 } },
          grid: { color: 'rgba(0,0,0,.05)' }
        }
      }
    }
  });
}

// Chart metric selector
document.getElementById('chart-metric').addEventListener('change', e => {
  renderTrendChart(historyEntries, e.target.value);
});

// ── Track form ──────────────────────────────────────────────
// Set default date to today in local time (not UTC)
function localDateString() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
document.getElementById('entry-date').value = localDateString();

document.getElementById('track-form').addEventListener('submit', async e => {
  e.preventDefault();
  const btn = document.getElementById('save-btn');
  const status = document.getElementById('save-status');

  btn.disabled = true;
  btn.textContent = 'Saving…';
  status.textContent = '';

  const form = e.target;
  const n = v => v.trim() === '' ? null : parseFloat(v);
  const payload = {
    date: form.date.value,
    ph: n(form.ph.value),
    ammonia: n(form.ammonia.value),
    nitrite: n(form.nitrite.value),
    nitrate: n(form.nitrate.value),
    dissolved_oxygen: n(form.dissolved_oxygen.value),
    temperature: n(form.temperature.value),
    potassium: n(form.potassium.value),
    calcium: n(form.calcium.value),
    magnesium: n(form.magnesium.value),
    iron: n(form.iron.value),
    plant_notes: form.plant_notes.value.trim() || null,
  };

  // Remove null numerics (leave as null for optional fields)
  try {
    const res = await apiFetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await res.text());

    btn.textContent = '✓ Saved';
    await new Promise(r => setTimeout(r, 700));
    switchTab('dashboard');

  } catch (err) {
    status.textContent = '✗ Error: ' + err.message;
    status.style.color = 'var(--red-600)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Entry';
  }
});

// ── Inline range feedback on reading inputs ─────────────────
PARAMS.forEach(param => {
  const group = document.querySelector(`[data-param="${param.key}"]`);
  if (!group) return;
  const input = group.querySelector('input');
  if (!input) return;
  input.addEventListener('input', () => {
    group.classList.remove('field-good', 'field-warn', 'field-alert');
    const v = input.value === '' ? null : parseFloat(input.value);
    if (v !== null && !isNaN(v)) {
      const s = getStatus(param, v);
      if (s !== 'none') group.classList.add(`field-${s}`);
    }
  });
});

// ── AI Advisor ──────────────────────────────────────────────

async function submitAIQuery() {
  const query = document.getElementById('ai-query').value.trim();
  const submitBtn = document.getElementById('ai-submit-btn');
  const loading = document.getElementById('ai-loading');
  const responseCard = document.getElementById('ai-response-card');
  const responseBody = document.getElementById('ai-response-body');

  submitBtn.style.display = 'none';
  loading.style.display = 'flex';
  responseCard.style.display = 'none';

  try {
    const res = await apiFetch('/api/consult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, mode: 'ask' }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || 'Server error');
    }

    const data = await res.json();

    responseBody.innerHTML = marked.parse(data.response);
    responseCard.style.display = 'block';
    responseCard.scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (err) {
    responseBody.innerHTML = `<p style="color:var(--red-600)">Error: ${err.message}</p>`;
    responseCard.style.display = 'block';
  } finally {
    submitBtn.style.display = '';
    loading.style.display = 'none';
  }
}

// ── History ─────────────────────────────────────────────────
let historyEntriesMap = {};

async function loadHistory() {
  const days = parseInt(document.getElementById('history-days').value);
  try {
    const [readRes, suppRes] = await Promise.all([
      apiFetch(`/api/history?days=${days}`),
      apiFetch(`/api/supplements?days=${days}`),
    ]);
    const { entries } = await readRes.json();
    const { entries: suppEntries } = await suppRes.json();
    renderHistoryTable(entries.slice().reverse()); // newest first
    renderSuppHistoryTable(suppEntries);
  } catch (e) {
    console.error('History load error:', e);
  }
}

function renderHistoryTable(entries) {
  const tbody = document.getElementById('history-tbody');

  historyEntriesMap = {};
  entries.forEach(e => { historyEntriesMap[e.id] = e; });

  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="13" class="empty-state">No entries yet — start tracking!</td></tr>';
    return;
  }

  tbody.innerHTML = entries.map(e => {
    const cells = PARAMS.map(p => {
      const v = e[p.key];
      const cls = getCellClass(p, v);
      const display = v !== null && v !== undefined ? fmt(v, p.key === 'ph' ? 1 : 0) : '—';
      return `<td class="${cls}">${display}</td>`;
    });

    const notes = e.plant_notes
      ? `<td class="notes-cell" title="${e.plant_notes.replace(/"/g,'&quot;')}">${e.plant_notes}</td>`
      : '<td>—</td>';

    const actions = `<td class="actions-cell">
      <button class="btn-icon btn-edit" onclick="openEditModal(${e.id})" title="Edit">✏️</button>
      <button class="btn-icon btn-delete" onclick="deleteEntry(${e.id})" title="Delete">🗑️</button>
    </td>`;

    return `<tr><td>${e.date}</td>${cells.join('')}${notes}${actions}</tr>`;
  }).join('');
}

function renderSuppHistoryTable(entries) {
  suppHistoryEntries = entries;
  const tbody = document.getElementById('supp-history-tbody');
  if (!entries.length) {
    tbody.innerHTML = '<tr><td colspan="7" class="empty-state">No supplements recorded</td></tr>';
    return;
  }
  tbody.innerHTML = entries.map(e => {
    const nutrient = NUTRIENT_LABELS[e.nutrient_key] || (e.nutrient_key || '—').replace(/_/g,' ').replace(/\b\w/g, c => c.toUpperCase());
    const notes = e.notes
      ? `<td class="notes-cell" title="${e.notes.replace(/"/g,'&quot;')}">${e.notes}</td>`
      : '<td>—</td>';
    const actions = `<td class="actions-cell">
      <button class="btn-icon btn-edit" onclick="openEditSuppModal(${e.id})" title="Edit">✏️</button>
      <button class="btn-icon btn-delete" onclick="deleteSuppHistoryEntry(${e.id})" title="Delete">🗑️</button>
    </td>`;
    return `<tr>
      <td>${e.date}</td>
      <td>${nutrient}</td>
      <td>${e.type_name || '—'}</td>
      <td>${e.amount !== null && e.amount !== undefined ? e.amount : '—'}</td>
      <td>${e.unit || '—'}</td>
      ${notes}
      ${actions}
    </tr>`;
  }).join('');
}

async function deleteSuppHistoryEntry(id) {
  if (!confirm('Delete this supplement entry?')) return;
  try {
    await apiFetch(`/api/supplements/${id}`, { method: 'DELETE' });
    loadHistory();
  } catch (e) {
    console.error('Delete supplement error:', e);
  }
}

// ── Edit Supplement Modal ─────────────────────────────────────
let editSuppEntryCache = {}; // id → entry

function openEditSuppModal(id) {
  const e = suppHistoryEntries.find(x => x.id === id);
  if (!e) return;
  editSuppEntryCache[id] = e;

  document.getElementById('edit-supp-id').value = id;
  document.getElementById('edit-supp-date').value = e.date;
  document.getElementById('edit-supp-amount').value = e.amount ?? '';
  document.getElementById('edit-supp-unit').value = e.unit || 'ppm';
  document.getElementById('edit-supp-notes').value = e.notes || '';
  document.getElementById('edit-supp-status').textContent = '';

  // Set nutrient, then load types and pre-select the current type
  const nutrientSel = document.getElementById('edit-supp-nutrient');
  nutrientSel.value = e.nutrient_key || '';
  loadEditSuppTypes(e.nutrient_key, e.supplement_type_id);

  document.getElementById('edit-supp-modal').showModal();
}

function closeEditSuppModal() {
  document.getElementById('edit-supp-modal').close();
}

async function loadEditSuppTypes(nutrientKey, preselectTypeId = null) {
  const typeSelect = document.getElementById('edit-supp-type');
  typeSelect.disabled = true;
  typeSelect.innerHTML = '<option value="">Loading…</option>';
  if (!nutrientKey) {
    typeSelect.innerHTML = '<option value="">Select nutrient first…</option>';
    return;
  }
  try {
    const res = await apiFetch(`/api/supplement-types?nutrient_key=${nutrientKey}`);
    const { types } = await res.json();
    const plainName = nutrientKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const stripPrefix = name => {
      const prefix = plainName.toLowerCase() + ' ';
      return name.toLowerCase().startsWith(prefix) ? name.slice(plainName.length + 1) : name;
    };
    typeSelect.innerHTML = '<option value="">Select type…</option>' +
      types.map(t => `<option value="${t.id}">${stripPrefix(t.name)}</option>`).join('');
    typeSelect.disabled = false;
    if (preselectTypeId) typeSelect.value = String(preselectTypeId);
  } catch {
    typeSelect.innerHTML = '<option value="">Error loading types</option>';
  }
}

async function saveEditSupp() {
  const id     = document.getElementById('edit-supp-id').value;
  const btn    = document.getElementById('edit-supp-save-btn');
  const status = document.getElementById('edit-supp-status');

  const date   = document.getElementById('edit-supp-date').value;
  const typeId = parseInt(document.getElementById('edit-supp-type').value);
  const amount = parseFloat(document.getElementById('edit-supp-amount').value);
  const unit   = document.getElementById('edit-supp-unit').value;
  const notes  = document.getElementById('edit-supp-notes').value.trim() || null;

  status.style.color = 'var(--red-600)';
  if (!date)              { status.textContent = 'Date is required.'; return; }
  if (!typeId)            { status.textContent = 'Select a supplement type.'; return; }
  if (isNaN(amount) || amount <= 0) { status.textContent = 'Enter an amount greater than 0.'; return; }

  btn.disabled = true;
  btn.textContent = 'Saving…';
  status.textContent = '';

  try {
    const res = await apiFetch(`/api/supplements/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, supplement_type_id: typeId, amount, unit, notes }),
    });
    if (!res.ok) throw new Error(await res.text());
    closeEditSuppModal();
    loadHistory();
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    status.style.color = 'var(--red-600)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

// Collapsible history section toggles
document.querySelectorAll('.history-section-toggle').forEach(btn => {
  btn.addEventListener('click', () => {
    const targetId = btn.getAttribute('data-target');
    const body = document.getElementById(targetId);
    const isExpanded = btn.getAttribute('aria-expanded') === 'true';
    btn.setAttribute('aria-expanded', String(!isExpanded));
    body.classList.toggle('collapsed', isExpanded);
  });
});

document.getElementById('history-days').addEventListener('change', loadHistory);

// ── Quick Log Modal (dashboard card click) ───────────────────

function openQuickLog(paramKey) {
  quickLogParamKey = paramKey;
  quickLogMode = 'reading';

  const param = PARAMS.find(p => p.key === paramKey);
  if (!param) return;

  document.getElementById('ql-title').textContent = `Log ${param.label}`;
  document.getElementById('ql-date').value = localDateString();
  document.getElementById('ql-value').value = '';
  document.getElementById('ql-unit').textContent = param.unit || '—';
  document.getElementById('ql-param-label').textContent = param.label;
  document.getElementById('ql-supp-amount').value = '';
  document.getElementById('ql-supp-notes').value = '';
  document.getElementById('ql-status').textContent = '';

  const nutrientKey = PARAM_TO_NUTRIENT[paramKey];
  const tabs = document.getElementById('ql-tabs');
  if (nutrientKey) {
    tabs.style.display = '';
    document.querySelectorAll('.ql-tab-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.qltab === 'reading');
    });
    loadQuickLogSupplementTypes(nutrientKey);
  } else {
    tabs.style.display = 'none';
  }
  document.getElementById('ql-reading-panel').style.display = '';
  document.getElementById('ql-supp-panel').style.display = 'none';

  document.getElementById('quick-log-modal').showModal();
  setTimeout(() => document.getElementById('ql-value').focus(), 50);
}

function closeQuickLog() {
  document.getElementById('quick-log-modal').close();
  quickLogParamKey = null;
}

async function loadQuickLogSupplementTypes(nutrientKey) {
  const typeSelect = document.getElementById('ql-supp-type');
  typeSelect.innerHTML = '<option value="">Loading…</option>';
  try {
    const res = await apiFetch(`/api/supplement-types?nutrient_key=${nutrientKey}`);
    const { types } = await res.json();
    // Keep full names (user wants to see nutrient name in types)
    typeSelect.innerHTML = '<option value="">Select type…</option>' +
      types.map(t => `<option value="${t.id}">${t.name}</option>`).join('');
    document.getElementById('ql-supp-unit').value =
      nutrientKey === 'water_change' ? '%' : 'ppm';
  } catch (e) {
    typeSelect.innerHTML = '<option value="">Error loading types</option>';
  }
}

function switchQuickLogTab(tabName) {
  quickLogMode = tabName;
  document.querySelectorAll('.ql-tab-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.qltab === tabName);
  });
  document.getElementById('ql-reading-panel').style.display = tabName === 'reading' ? '' : 'none';
  document.getElementById('ql-supp-panel').style.display = tabName === 'supplement' ? '' : 'none';
  document.getElementById('ql-status').textContent = '';
  if (tabName === 'reading') {
    setTimeout(() => document.getElementById('ql-value').focus(), 50);
  } else {
    setTimeout(() => document.getElementById('ql-supp-type').focus(), 50);
  }
}

async function saveQuickLog() {
  const date = document.getElementById('ql-date').value;
  const status = document.getElementById('ql-status');

  if (!date) { status.textContent = 'Date is required.'; return; }

  const btn = document.getElementById('ql-save-btn');
  btn.disabled = true;
  btn.textContent = 'Saving…';
  status.textContent = '';

  try {
    if (quickLogMode === 'reading') {
      const value = document.getElementById('ql-value').value.trim();
      if (value === '') { status.textContent = 'Enter a value.'; return; }
      const numVal = parseFloat(value);
      if (isNaN(numVal)) { status.textContent = 'Enter a valid number.'; return; }

      const res = await apiFetch('/api/track', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, [quickLogParamKey]: numVal }),
      });
      if (!res.ok) throw new Error(await res.text());

    } else {
      const typeId = parseInt(document.getElementById('ql-supp-type').value);
      const amount = parseFloat(document.getElementById('ql-supp-amount').value);
      const unit = document.getElementById('ql-supp-unit').value;
      const notes = document.getElementById('ql-supp-notes').value.trim() || null;

      if (!typeId) { status.textContent = 'Select a supplement type.'; return; }
      if (isNaN(amount) || amount <= 0) { status.textContent = 'Enter an amount greater than 0.'; return; }

      const res = await apiFetch('/api/supplements', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ date, supplement_type_id: typeId, amount, unit, notes }),
      });
      if (!res.ok) throw new Error(await res.text());
    }

    closeQuickLog();
    loadDashboard();

  } catch (err) {
    status.textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save';
  }
}

// Close on backdrop click
document.getElementById('quick-log-modal').addEventListener('click', (e) => {
  if (e.target === e.currentTarget) closeQuickLog();
});

// ── Excel Export / Import ────────────────────────────────────

// Map human-readable nutrient label (or raw key) → nutrient_key for import
const NUTRIENT_IMPORT_MAP = (() => {
  const m = {};
  Object.entries(NUTRIENT_LABELS).forEach(([key, label]) => {
    m[label.toLowerCase()] = key;           // "potassium (k)" → "potassium"
    m[label.toLowerCase().replace(/\s*\(.*\)/, '').trim()] = key; // "potassium" → "potassium"
    m[key] = key;                           // raw key passthrough
    m[key.replace(/_/g, ' ')] = key;        // "ph adjustment" → "ph_adjustment"
  });
  return m;
})();

async function exportToExcel() {
  if (typeof XLSX === 'undefined') {
    alert('Excel library not loaded yet. Please wait a moment and try again.');
    return;
  }

  // Fetch all supplement types so we can build the reference sheet and validation
  let allTypes = [];
  try {
    const res = await apiFetch('/api/supplement-types?include_disabled=false');
    const data = await res.json();
    allTypes = data.types || [];
  } catch (e) { /* export continues without validation lists */ }

  const wb = XLSX.utils.book_new();

  // ── Readings sheet ──────────────────────────────────────────
  const readingsData = Object.values(historyEntriesMap)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(e => ({
      Date: e.date,
      pH: e.ph,
      Ammonia: e.ammonia,
      Nitrite: e.nitrite,
      Nitrate: e.nitrate,
      Dissolved_Oxygen: e.dissolved_oxygen,
      Temperature: e.temperature,
      Potassium: e.potassium,
      Calcium: e.calcium,
      Magnesium: e.magnesium,
      Iron: e.iron,
      Plant_Notes: e.plant_notes,
    }));

  const ws1 = XLSX.utils.json_to_sheet(readingsData.length ? readingsData : [
    { Date: '', pH: '', Ammonia: '', Nitrite: '', Nitrate: '', Dissolved_Oxygen: '',
      Temperature: '', Potassium: '', Calcium: '', Magnesium: '', Iron: '', Plant_Notes: '' }
  ]);
  ws1['!cols'] = [
    { wch: 12 }, { wch: 6 }, { wch: 10 }, { wch: 10 }, { wch: 10 },
    { wch: 17 }, { wch: 13 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 8 }, { wch: 35 },
  ];
  XLSX.utils.book_append_sheet(wb, ws1, 'Readings');

  // ── Supplements sheet ───────────────────────────────────────
  const nutrientLabelList = Object.values(NUTRIENT_LABELS).join(',');
  const suppData = suppHistoryEntries
    .slice()
    .reverse()
    .map(e => ({
      Date: e.date,
      Nutrient: NUTRIENT_LABELS[e.nutrient_key] || e.nutrient_key,
      Type: e.type_name,
      Amount: e.amount,
      Unit: e.unit || 'ppm',
      Notes: e.notes || '',
    }));

  const ws2 = XLSX.utils.json_to_sheet(suppData.length ? suppData : [
    { Date: '', Nutrient: '', Type: '', Amount: '', Unit: 'ppm', Notes: '' }
  ]);

  ws2['!cols'] = [
    { wch: 12 }, { wch: 20 }, { wch: 28 }, { wch: 10 }, { wch: 8 }, { wch: 35 },
  ];

  // Data validation: Nutrient dropdown (column B) and Unit dropdown (column E)
  ws2['!dataValidations'] = [
    {
      sqref: 'B2:B10000',
      type: 'list',
      formula1: `"${nutrientLabelList}"`,
      showDropDown: false,
      showErrorMessage: true,
      errorTitle: 'Invalid nutrient',
      error: `Must be one of: ${nutrientLabelList}`,
    },
    {
      sqref: 'E2:E10000',
      type: 'list',
      formula1: '"ppm,%"',
      showDropDown: false,
      showErrorMessage: true,
      errorTitle: 'Invalid unit',
      error: 'Must be ppm or %',
    },
  ];

  XLSX.utils.book_append_sheet(wb, ws2, 'Supplements');

  // ── Valid Types reference sheet ─────────────────────────────
  const refRows = [];
  Object.entries(NUTRIENT_LABELS).forEach(([key, label]) => {
    const types = allTypes.filter(t => t.nutrient_key === key);
    types.forEach((t, i) => {
      refRows.push({ Nutrient: i === 0 ? label : '', 'Valid Types for this Nutrient': t.name });
    });
    if (!types.length) {
      refRows.push({ Nutrient: label, 'Valid Types for this Nutrient': '(none configured)' });
    }
    refRows.push({ Nutrient: '', 'Valid Types for this Nutrient': '' }); // spacer row
  });

  const wsRef = XLSX.utils.json_to_sheet(refRows);
  wsRef['!cols'] = [{ wch: 20 }, { wch: 35 }];
  XLSX.utils.book_append_sheet(wb, wsRef, 'Valid Types');

  XLSX.writeFile(wb, 'aquaponics-data.xlsx');
}

async function importFromExcel(event) {
  const file = event.target.files[0];
  if (!file) return;

  if (typeof XLSX === 'undefined') {
    alert('Excel library not loaded yet. Please wait a moment and try again.');
    event.target.value = '';
    return;
  }

  const reader = new FileReader();
  reader.onload = async (e) => {
    try {
      const data = new Uint8Array(e.target.result);
      // cellDates: true converts Excel date serials → JS Date objects
      const wb = XLSX.read(data, { type: 'array', cellDates: true });

      const readings = [];
      const supplements = [];
      const n = v => (v === undefined || v === '' || v === null) ? null : parseFloat(v);

      // Convert whatever SheetJS gives us for a date cell → YYYY-MM-DD string
      const fmtDate = v => {
        if (!v) return null;
        if (v instanceof Date) {
          const y = v.getFullYear();
          const m = String(v.getMonth() + 1).padStart(2, '0');
          const d = String(v.getDate()).padStart(2, '0');
          return `${y}-${m}-${d}`;
        }
        return String(v).trim();
      };

      // Parse Readings sheet
      const ws1 = wb.Sheets['Readings'];
      if (ws1) {
        XLSX.utils.sheet_to_json(ws1).forEach(row => {
          const date = fmtDate(row.Date);
          if (!date) return;
          readings.push({
            date,
            ph: n(row.pH),
            ammonia: n(row.Ammonia),
            nitrite: n(row.Nitrite),
            nitrate: n(row.Nitrate),
            dissolved_oxygen: n(row.Dissolved_Oxygen),
            temperature: n(row.Temperature),
            potassium: n(row.Potassium),
            calcium: n(row.Calcium),
            magnesium: n(row.Magnesium),
            iron: n(row.Iron),
            plant_notes: row.Plant_Notes ? String(row.Plant_Notes).trim() || null : null,
          });
        });
      }

      // Parse Supplements sheet
      const ws2 = wb.Sheets['Supplements'];
      if (ws2) {
        XLSX.utils.sheet_to_json(ws2).forEach(row => {
          const date = fmtDate(row.Date);
          const type = row.Type ? String(row.Type).trim() : null;
          if (!date || !type) return;
          // Accept human-readable labels ("Potassium (K)") or raw keys ("potassium")
          const rawNutrient = row.Nutrient ? String(row.Nutrient).trim() : '';
          const nutrientKey = NUTRIENT_IMPORT_MAP[rawNutrient.toLowerCase()] || rawNutrient;
          supplements.push({
            date,
            nutrient: nutrientKey,
            type,
            amount: parseFloat(row.Amount) || 0,
            unit: row.Unit ? String(row.Unit).trim() : 'ppm',
            notes: row.Notes ? String(row.Notes).trim() || null : null,
          });
        });
      }

      if (!readings.length && !supplements.length) {
        alert('No valid data found in the file. Make sure the sheet names are "Readings" and "Supplements".');
        return;
      }

      const res = await apiFetch('/api/bulk-import', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ readings, supplements }),
      });
      if (!res || !res.ok) throw new Error('Import request failed');

      const result = await res.json();
      alert(
        `Import complete!\n\n` +
        `Readings: ${result.readings_added} added, ${result.readings_updated} updated\n` +
        `Supplements: ${result.supplements_added} added, ${result.supplements_skipped} skipped`
      );
      loadHistory();

    } catch (err) {
      alert('Import error: ' + err.message);
    } finally {
      event.target.value = '';
    }
  };
  reader.readAsArrayBuffer(file);
}

// ── Edit / Delete ────────────────────────────────────────────
function openEditModal(id) {
  const e = historyEntriesMap[id];
  if (!e) return;

  document.getElementById('edit-id').value = id;
  document.getElementById('edit-date').value = e.date;

  ['ph','ammonia','nitrite','nitrate','dissolved_oxygen','temperature',
   'potassium','calcium','magnesium','iron'].forEach(f => {
    const el = document.getElementById('edit-' + f.replace(/_/g, '-'));
    if (el) el.value = e[f] != null ? e[f] : '';
  });
  document.getElementById('edit-plant-notes').value = e.plant_notes || '';
  document.getElementById('edit-status').textContent = '';

  document.getElementById('edit-modal').showModal();
}

function closeEditModal() {
  document.getElementById('edit-modal').close();
}

async function saveEdit() {
  const id  = document.getElementById('edit-id').value;
  const btn = document.getElementById('edit-save-btn');
  const status = document.getElementById('edit-status');

  btn.disabled = true;
  btn.textContent = 'Saving…';

  const n = v => v.trim() === '' ? null : parseFloat(v);
  const payload = {
    date:             document.getElementById('edit-date').value,
    ph:               n(document.getElementById('edit-ph').value),
    ammonia:          n(document.getElementById('edit-ammonia').value),
    nitrite:          n(document.getElementById('edit-nitrite').value),
    nitrate:          n(document.getElementById('edit-nitrate').value),
    dissolved_oxygen: n(document.getElementById('edit-dissolved-oxygen').value),
    temperature:      n(document.getElementById('edit-temperature').value),
    potassium:        n(document.getElementById('edit-potassium').value),
    calcium:          n(document.getElementById('edit-calcium').value),
    magnesium:        n(document.getElementById('edit-magnesium').value),
    iron:             n(document.getElementById('edit-iron').value),
    plant_notes:      document.getElementById('edit-plant-notes').value.trim() || null,
  };

  try {
    const res = await apiFetch(`/api/entry/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(await res.text());
    closeEditModal();
    loadHistory();
  } catch (err) {
    status.textContent = 'Error: ' + err.message;
    status.style.color = 'var(--red-600)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Changes';
  }
}

function showConfirm(message, onConfirm) {
  const dialog = document.getElementById('confirm-dialog');
  document.getElementById('confirm-message').textContent = message;
  dialog.showModal();
  const ok = document.getElementById('confirm-ok');
  const cancel = document.getElementById('confirm-cancel');
  const cleanup = () => { ok.replaceWith(ok.cloneNode(true)); cancel.replaceWith(cancel.cloneNode(true)); };
  document.getElementById('confirm-ok').addEventListener('click', () => { dialog.close(); cleanup(); onConfirm(); }, { once: true });
  document.getElementById('confirm-cancel').addEventListener('click', () => { dialog.close(); cleanup(); }, { once: true });
}

async function deleteEntry(id) {
  showConfirm('Delete this entry? This cannot be undone.', async () => {
    try {
      const res = await apiFetch(`/api/entry/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      loadHistory();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

// ── Deep-link: navigate to #learning-N ──────────────────────
function handleHash() {
  const hash = window.location.hash;
  if (hash.startsWith('#learning-')) {
    switchTab('learnings');
    setTimeout(() => {
      const el = document.getElementById(hash.slice(1));
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        el.classList.add('learning-highlight');
        setTimeout(() => el.classList.remove('learning-highlight'), 2000);
      }
    }, 150);
  }
}
window.addEventListener('hashchange', handleHash);

// ── Learnings / Voice Recorder ──────────────────────────────
let recognition = null;
let isRecording  = false;
let finalTranscript = '';
let learningsMap = {};
let currentLearnings = [];

function initRecognition() {
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SR) return false;
  recognition = new SR();
  recognition.continuous     = true;
  recognition.interimResults = true;
  recognition.lang           = 'en-US';

  recognition.onresult = (event) => {
    let interim = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const t = event.results[i][0].transcript;
      if (event.results[i].isFinal) finalTranscript += t + ' ';
      else interim += t;
    }
    document.getElementById('learning-content').value = finalTranscript + interim;
  };

  recognition.onerror = (e) => {
    console.error('Speech error:', e.error);
    if (e.error !== 'no-speech') stopRecording();
  };

  recognition.onend = () => {
    if (isRecording) recognition.start(); // keep going until user stops
  };

  return true;
}

function toggleRecording() {
  isRecording ? stopRecording() : startRecording();
}

function startRecording() {
  if (!recognition && !initRecognition()) {
    document.getElementById('recorder-hint').textContent =
      'Speech recognition requires Chrome or Edge.';
    return;
  }
  finalTranscript = '';
  document.getElementById('learning-content').value = '';
  document.getElementById('recorder-hint').textContent = '';
  recognition.start();
  isRecording = true;

  const btn = document.getElementById('record-btn');
  btn.textContent = '⏹ Stop Recording';
  btn.style.background = 'var(--red-600)';
  document.getElementById('recording-indicator').style.display = 'flex';
}

function stopRecording() {
  if (recognition) recognition.stop();
  isRecording = false;

  const btn = document.getElementById('record-btn');
  btn.textContent = '🎙 Start Recording';
  btn.style.background = '';
  document.getElementById('recording-indicator').style.display = 'none';

  // Clean up trailing space in textarea
  const ta = document.getElementById('learning-content');
  ta.value = ta.value.trim();
}

function clearLearningForm() {
  if (isRecording) stopRecording();
  finalTranscript = '';
  document.getElementById('learning-title').value   = '';
  document.getElementById('learning-content').value = '';
  document.getElementById('recorder-hint').textContent = '';
}

async function saveLearning() {
  const title   = document.getElementById('learning-title').value.trim();
  const content = document.getElementById('learning-content').value.trim();
  if (!content) {
    document.getElementById('recorder-hint').textContent = 'Nothing to save — record or type first.';
    return;
  }

  const btn = document.getElementById('save-learning-btn');
  btn.disabled    = true;
  btn.textContent = 'Saving…';

  try {
    const res = await apiFetch('/api/learnings', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, content }),
    });
    if (!res.ok) throw new Error(await res.text());
    clearLearningForm();
    switchSubTab('saved');
  } catch (err) {
    document.getElementById('recorder-hint').textContent = 'Error: ' + err.message;
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Save Learning';
  }
}

async function loadLearnings() {
  try {
    const res = await apiFetch('/api/learnings');
    const { learnings } = await res.json();
    renderLearnings(learnings);
  } catch (e) {
    console.error('Learnings load error:', e);
  }
}

function renderLearnings(learnings) {
  currentLearnings = learnings;
  learningsMap = {};
  learnings.forEach(l => { learningsMap[l.id] = l; });

  const list = document.getElementById('learnings-list');
  if (!learnings.length) {
    list.innerHTML = '<p class="empty-state" style="padding:2rem;background:#fff;border-radius:var(--radius);box-shadow:var(--shadow)">No learnings saved yet.</p>';
    return;
  }
  list.innerHTML = learnings.map(l => {
    const date = new Date(l.created_at).toLocaleDateString('en-US',
      { year: 'numeric', month: 'short', day: 'numeric' });
    const title = l.title || 'Untitled';
    return `<div class="learning-card" id="learning-${l.id}">
      <div class="learning-header">
        <div>
          <h4 class="learning-title">${title}</h4>
          <span class="learning-date">${date}</span>
        </div>
        <div style="display:flex;gap:.4rem">
          <button class="btn-icon btn-edit" onclick="editLearning(${l.id})" title="Edit">✏️</button>
          <button class="btn-icon btn-delete" onclick="deleteLearning(${l.id})" title="Delete">🗑️</button>
        </div>
      </div>
      <p class="learning-content">${l.content}</p>
    </div>`;
  }).join('');
}

function editLearning(id) {
  const l = learningsMap[id];
  if (!l) return;
  const card = document.getElementById(`learning-${id}`);
  card.innerHTML = `
    <div class="learning-edit-form">
      <div class="form-group" style="margin-bottom:.75rem">
        <label>Title</label>
        <input type="text" id="edit-ltitle-${id}" value="${(l.title || '').replace(/"/g,'&quot;')}" placeholder="Title (optional)" />
      </div>
      <div class="form-group" style="margin-bottom:.75rem">
        <label>Content</label>
        <textarea id="edit-lcontent-${id}" rows="6">${l.content}</textarea>
      </div>
      <div class="form-actions">
        <button class="btn btn-primary" onclick="saveLearningEdit(${id})">Save</button>
        <button class="btn btn-secondary" onclick="renderLearnings(currentLearnings)">Cancel</button>
        <span class="save-status" id="ledit-status-${id}" style="color:var(--red-600)"></span>
      </div>
    </div>`;
}

async function saveLearningEdit(id) {
  const title   = document.getElementById(`edit-ltitle-${id}`).value.trim();
  const content = document.getElementById(`edit-lcontent-${id}`).value.trim();
  if (!content) return;

  try {
    const res = await apiFetch(`/api/learnings/${id}`, {
      method:  'PUT',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ title, content }),
    });
    if (!res.ok) throw new Error(await res.text());
    loadLearnings();
  } catch (err) {
    document.getElementById(`ledit-status-${id}`).textContent = 'Error: ' + err.message;
  }
}

async function deleteLearning(id) {
  showConfirm('Delete this learning? This cannot be undone.', async () => {
    try {
      const res = await apiFetch(`/api/learnings/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      loadLearnings();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

// ── Settings ────────────────────────────────────────────────
async function loadSettings() {
  try {
    const res = await apiFetch('/api/settings');
    const { settings } = await res.json();
    try {
      appSettings.visible_params = JSON.parse(settings.visible_params);
    } catch {
      appSettings.visible_params = null;
    }
    applyParamVisibility();
  } catch (e) {
    console.error('Settings load error:', e);
  }
}

async function saveParamSetting(key, enabled) {
  const vp = appSettings.visible_params || PARAMS.map(p => p.key);
  const updated = enabled ? [...new Set([...vp, key])] : vp.filter(k => k !== key);
  appSettings.visible_params = updated;
  applyParamVisibility();
  renderParamCards(null); // re-render cards (dashboard will reload if active)
  if (currentTab === 'dashboard') loadDashboard();
  await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { visible_params: JSON.stringify(updated) } }),
  });
}

// ── Supplements ─────────────────────────────────────────────

async function loadSupplementTypes(nutrientKey) {
  const typeSelect = document.getElementById('supp-type');
  typeSelect.innerHTML = '<option value="">Loading…</option>';
  typeSelect.disabled = true;
  if (!nutrientKey) {
    typeSelect.innerHTML = '<option value="">Select nutrient first…</option>';
    return;
  }
  try {
    const res = await apiFetch(`/api/supplement-types?nutrient_key=${nutrientKey}`);
    if (!res || !res.ok) {
      typeSelect.innerHTML = '<option value="">Error loading types</option>';
      return;
    }
    const { types } = await res.json();
    if (!types || !types.length) {
      typeSelect.innerHTML = '<option value="">No types available</option>';
      return;
    }
    const plainName = nutrientKey.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const stripPrefix = name => {
      const prefix = plainName.toLowerCase() + ' ';
      return name.toLowerCase().startsWith(prefix) ? name.slice(plainName.length + 1) : name;
    };
    typeSelect.innerHTML = '<option value="">Select type…</option>' +
      types.map(t => `<option value="${t.id}" data-nutrient="${nutrientKey}">${stripPrefix(t.name)}</option>`).join('');
    typeSelect.disabled = false;

    const unitSelect  = document.getElementById('supp-unit');
    const amountInput = document.getElementById('supp-amount');
    if (nutrientKey === 'water_change') {
      unitSelect.value = '%';
      amountInput.placeholder = '0 – 100';
      amountInput.max = '100';
    } else {
      unitSelect.value = 'ppm';
      amountInput.placeholder = '0.0';
      amountInput.removeAttribute('max');
    }
  } catch (e) {
    console.error('loadSupplementTypes error:', e);
    typeSelect.innerHTML = '<option value="">Error loading types</option>';
  }
}

async function submitSupplement() {
  const status = document.getElementById('supp-status');
  const date   = document.getElementById('supp-date').value;
  const typeId = parseInt(document.getElementById('supp-type').value);
  const amount = parseFloat(document.getElementById('supp-amount').value);

  status.style.color = 'var(--red-600)';
  if (!date) { status.textContent = 'Date is required.'; return; }
  if (!typeId) { status.textContent = 'Select a supplement type.'; document.getElementById('supp-type').focus(); return; }
  if (isNaN(amount) || amount <= 0) { status.textContent = 'Enter an amount greater than 0.'; document.getElementById('supp-amount').focus(); return; }

  status.textContent = 'Saving…';
  status.style.color = 'var(--slate-500)';

  try {
    const res = await apiFetch('/api/supplements', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        date,
        supplement_type_id: typeId,
        amount,
        unit: document.getElementById('supp-unit').value,
        notes: document.getElementById('supp-notes').value.trim() || null,
      }),
    });
    if (!res.ok) throw new Error(await res.text());

    status.textContent = '✓ Logged';
    status.style.color = 'var(--green-600)';
    document.getElementById('supp-nutrient').value = '';
    document.getElementById('supp-type').innerHTML = '<option value="">Select nutrient first…</option>';
    document.getElementById('supp-type').disabled = true;
    document.getElementById('supp-amount').value = '';
    document.getElementById('supp-notes').value = '';
    setTimeout(() => { status.textContent = ''; }, 2500);
    loadSupplementLog();
    document.getElementById('supp-nutrient').focus();
  } catch (err) {
    status.textContent = '✗ Error: ' + err.message;
    status.style.color = 'var(--red-600)';
  }
}

async function checkSupplementIssues() {
  const result  = document.getElementById('supp-check-result');
  const loading = document.getElementById('supp-check-loading');
  const body    = document.getElementById('supp-check-body');
  const btn     = document.getElementById('supp-check-btn');

  // Read current form state (all optional — AI works with whatever is filled)
  const nutrientSel = document.getElementById('supp-nutrient');
  const typeSel     = document.getElementById('supp-type');
  const nutrient    = nutrientSel.value;
  const typeId      = typeSel.value;
  const typeName    = typeId ? typeSel.options[typeSel.selectedIndex].text : '';
  const amount      = parseFloat(document.getElementById('supp-amount').value) || null;
  const unit        = document.getElementById('supp-unit').value;

  result.style.display = '';
  body.innerHTML = '';
  loading.style.display = 'flex';
  btn.disabled = true;
  result.scrollIntoView({ behavior: 'smooth', block: 'start' });

  try {
    const res = await apiFetch('/api/supplement-check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nutrient, type_name: typeName, amount, unit }),
    });

    if (!res || !res.ok) throw new Error('Server error');
    const data = await res.json();
    body.innerHTML = marked.parse(data.response);

  } catch (err) {
    body.innerHTML = `<p style="color:var(--red-600)">Error: ${err.message}</p>`;
  } finally {
    loading.style.display = 'none';
    btn.disabled = false;
  }
}

async function loadSupplementLog() {
  const container = document.getElementById('supplement-log-list');
  try {
    const res = await apiFetch('/api/supplements?days=30');
    const { entries } = await res.json();
    if (!entries.length) {
      container.innerHTML = '<p class="empty-hint">No supplements logged in the last 30 days.</p>';
      return;
    }
    container.innerHTML = `
      <h3 class="form-section-title">Recent Additions (last 30 days)</h3>
      <div class="supp-log-table">
        <div class="supp-log-header">
          <span>Date</span><span>Nutrient</span><span>Type</span><span>Amount</span><span></span>
        </div>
        ${entries.map(e => `
          <div class="supp-log-row">
            <span>${e.date}</span>
            <span>${NUTRIENT_LABELS[e.nutrient_key] || e.nutrient_key || '—'}</span>
            <span>${e.type_name || '—'}</span>
            <span>${e.amount} ${e.unit}</span>
            <span>
              <button class="btn-icon btn-delete" onclick="deleteSupplementEntry(${e.id})" title="Delete">🗑️</button>
            </span>
          </div>
          ${e.notes ? `<div class="supp-log-notes">${e.notes}</div>` : ''}
        `).join('')}
      </div>`;
  } catch (err) {
    container.innerHTML = '<p class="empty-hint">Error loading log.</p>';
  }
}

async function deleteSupplementEntry(id) {
  showConfirm('Delete this supplement entry?', async () => {
    try {
      const res = await apiFetch(`/api/supplements/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      loadSupplementLog();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

// ── Admin panel ─────────────────────────────────────────────
async function loadAdminPanel() {
  renderAdminParams();
  await loadAdminSupplementTypes();
}

function renderAdminParams() {
  const list = document.getElementById('admin-params-list');
  const vp = appSettings.visible_params || PARAMS.map(p => p.key);
  list.innerHTML = PARAMS.map(p => `
    <div class="admin-toggle-row">
      <span class="admin-toggle-label">${p.label}${p.unit ? ` <small class="admin-unit">${p.unit}</small>` : ''}</span>
      <label class="toggle-switch">
        <input type="checkbox" ${vp.includes(p.key) ? 'checked' : ''}
               onchange="saveParamSetting('${p.key}', this.checked)">
        <span class="toggle-slider"></span>
      </label>
    </div>
  `).join('') + `
    <div id="add-param-form" class="add-type-form" style="display:none">
      <input type="text" id="new-param-label" placeholder="Parameter name…" class="add-type-input" />
      <input type="text" id="new-param-unit" placeholder="Unit (e.g. ppm)" class="add-type-input" style="max-width:7rem" />
      <button class="btn btn-primary btn-sm" onclick="addCustomParam()">Save</button>
      <button class="btn btn-secondary btn-sm" onclick="hideAddParamForm()">Cancel</button>
    </div>
    <button class="admin-add-btn" id="add-param-btn" onclick="showAddParamForm()">+ Add</button>
  `;
}

function showAddParamForm() {
  document.getElementById('add-param-form').style.display = 'flex';
  document.getElementById('add-param-btn').style.display = 'none';
  document.getElementById('new-param-label').focus();
}

function hideAddParamForm() {
  document.getElementById('add-param-form').style.display = 'none';
  document.getElementById('add-param-btn').style.display = '';
  document.getElementById('new-param-label').value = '';
  document.getElementById('new-param-unit').value = '';
}

async function addCustomParam() {
  const label = document.getElementById('new-param-label').value.trim();
  const unit  = document.getElementById('new-param-unit').value.trim();
  if (!label) return;
  const key = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  if (PARAMS.find(p => p.key === key)) {
    alert('A parameter with that name already exists.');
    return;
  }
  PARAMS.push({ key, label, unit, good: null, warn: null, custom: true });
  const vp = appSettings.visible_params || PARAMS.map(p => p.key);
  if (!vp.includes(key)) vp.push(key);
  appSettings.visible_params = vp;
  await apiFetch('/api/settings', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ settings: { visible_params: JSON.stringify(vp) } }),
  });
  hideAddParamForm();
  renderAdminParams();
}

async function loadAdminSupplementTypes() {
  const container = document.getElementById('admin-supplement-types');
  try {
    const res = await apiFetch('/api/supplement-types?include_disabled=true');
    const { types } = await res.json();

    const groups = {};
    Object.keys(NUTRIENT_LABELS).forEach(k => { groups[k] = []; });
    types.forEach(t => { if (groups[t.nutrient_key]) groups[t.nutrient_key].push(t); });

    container.innerHTML = Object.entries(NUTRIENT_LABELS).map(([key, label]) => `
      <div class="admin-nutrient-group">
        <div class="admin-nutrient-header">
          <span class="admin-nutrient-label">${label}</span>
        </div>
        ${groups[key].length ? groups[key].map(t => `
          <div class="admin-type-row">
            <span class="admin-type-name ${t.enabled ? '' : 'admin-type-disabled'}">${t.name}</span>
            <div class="admin-type-actions">
              <label class="toggle-switch toggle-sm">
                <input type="checkbox" ${t.enabled ? 'checked' : ''}
                       onchange="toggleSupplementType(${t.id}, this.checked)">
                <span class="toggle-slider"></span>
              </label>
              <button class="btn-icon btn-delete" onclick="deleteAdminSupplementType(${t.id})">🗑️</button>
            </div>
          </div>
        `).join('') : '<p class="empty-hint" style="padding:.5rem 0 0">No types yet.</p>'}
        <div id="add-type-form-${key}" class="add-type-form" style="display:none">
          <input type="text" id="new-type-name-${key}" placeholder="Type name…" class="add-type-input" />
          <button class="btn btn-primary btn-sm" onclick="addSupplementType('${key}')">Save</button>
          <button class="btn btn-secondary btn-sm" onclick="hideAddTypeForm('${key}')">Cancel</button>
        </div>
        <button class="admin-add-btn" onclick="showAddTypeForm('${key}')">+ Add</button>
      </div>
    `).join('');
  } catch (err) {
    container.innerHTML = '<p class="empty-hint">Error loading supplement types.</p>';
  }
}

function showAddTypeForm(key) {
  const form = document.getElementById(`add-type-form-${key}`);
  form.style.display = 'flex';
  form.previousElementSibling.style.display = 'none'; // hide "+ Add" btn
  document.getElementById(`new-type-name-${key}`).focus();
}
function hideAddTypeForm(key) {
  const form = document.getElementById(`add-type-form-${key}`);
  form.style.display = 'none';
  form.previousElementSibling.style.display = ''; // restore "+ Add" btn
  document.getElementById(`new-type-name-${key}`).value = '';
}

async function addSupplementType(nutrientKey) {
  const input = document.getElementById(`new-type-name-${nutrientKey}`);
  const name = input.value.trim();
  if (!name) return;
  try {
    const res = await apiFetch('/api/supplement-types', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nutrient_key: nutrientKey, name }),
    });
    if (!res.ok) throw new Error(await res.text());
    await loadAdminSupplementTypes();
  } catch (err) {
    alert('Error: ' + err.message);
  }
}

async function toggleSupplementType(id, enabled) {
  await fetch(`/api/supplement-types/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
}

async function deleteAdminSupplementType(id) {
  showConfirm('Delete this supplement type? Existing log entries will keep the name.', async () => {
    try {
      const res = await apiFetch(`/api/supplement-types/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      loadAdminSupplementTypes();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

// ── Init ────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  loadDashboard();
}

// Entry point — check auth before showing app
checkAuthAndLoad();
