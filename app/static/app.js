/**
 * Aquaponics Tracker — Frontend Logic
 */

'use strict';

// ── State ──────────────────────────────────────────────────
let currentTab = 'dashboard';
let currentMode = 'diagnose'; // 'diagnose' | 'recommend'
let trendChart = null;
let historyEntries = [];

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

  document.querySelector(`[data-tab="${name}"]`).classList.add('active');
  document.getElementById(`tab-${name}`).classList.add('active');
  currentTab = name;

  if (name === 'dashboard') {
    loadDashboard();
  } else if (name === 'track') {
    document.getElementById('entry-date').value = localDateString();
  } else if (name === 'history') {
    loadHistory();
  } else if (name === 'learnings') {
    // learnings loaded on demand when saved sub-tab is clicked
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

// ── Dashboard ──────────────────────────────────────────────
async function loadDashboard() {
  try {
    const [latestRes, histRes] = await Promise.all([
      fetch('/api/latest'),
      fetch('/api/history?days=30')
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

// Ideal K:Ca:Mg ratio = 1:2:1 → Ca/K ideal = 2, Ca/Mg ideal = 2, K/Mg ideal = 1
function ratioStatus(k, ca, mg) {
  if (k == null || ca == null || mg == null || k === 0 || mg === 0) return 'none';
  const caK  = ca / k;   // ideal: 2
  const caMg = ca / mg;  // ideal: 2
  const kMg  = k  / mg;  // ideal: 1
  // Check each ratio against good/warn thresholds
  const caKStatus  = caK  >= 1.5 && caK  <= 3.0 ? 'good' : caK  >= 1.0 && caK  <= 4.0 ? 'warn' : 'alert';
  const caMgStatus = caMg >= 1.5 && caMg <= 3.0 ? 'good' : caMg >= 1.0 && caMg <= 4.0 ? 'warn' : 'alert';
  const kMgStatus  = kMg  >= 0.6 && kMg  <= 1.6 ? 'good' : kMg  >= 0.4 && kMg  <= 2.5 ? 'warn' : 'alert';
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
    <div class="param-range">Ideal ratio ≈ 1 : 2 : 1</div>`;
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
    const res  = await fetch('/api/insights?generate=false');
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
  body.innerHTML = '<span class="insights-loading">Analyzing your data…</span>';
  regen.style.display = 'none';

  try {
    const res  = await fetch('/api/insights');
    const data = await res.json();
    if (data.insights) showInsightsResult(data);
    else {
      body.innerHTML = '<span class="insights-loading">Not enough data yet — log at least 3 entries first.</span>';
    }
  } catch (e) {
    body.innerHTML = '<span class="insights-loading">Error generating insights.</span>';
  }
}

function renderParamCards(entry) {
  const grid = document.getElementById('param-grid');
  grid.innerHTML = '';

  PARAMS.forEach(p => {
    const value = entry ? entry[p.key] : null;
    const status = getStatus(p, value);
    const displayVal = value !== null && value !== undefined
      ? fmt(value, p.key === 'ph' ? 2 : p.key === 'temperature' ? 1 : 2)
      : '—';

    const card = document.createElement('div');
    card.className = `param-card status-${status}`;
    card.innerHTML = `
      <div class="param-label">
        <span class="status-dot"></span>${p.label}
      </div>
      <div class="param-value">${displayVal}<span class="param-unit">${p.unit}</span></div>
      <div class="param-range">${p.description}</div>
    `;
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
  const payload = {
    date: form.date.value,
    ph: parseFloat(form.ph.value) || null,
    ammonia: parseFloat(form.ammonia.value) || null,
    nitrite: parseFloat(form.nitrite.value) || null,
    nitrate: parseFloat(form.nitrate.value) || null,
    dissolved_oxygen: parseFloat(form.dissolved_oxygen.value) || null,
    temperature: parseFloat(form.temperature.value) || null,
    potassium: parseFloat(form.potassium.value) || null,
    calcium: parseFloat(form.calcium.value) || null,
    magnesium: parseFloat(form.magnesium.value) || null,
    iron: parseFloat(form.iron.value) || null,
    plant_notes: form.plant_notes.value.trim() || null,
  };

  // Remove null numerics (leave as null for optional fields)
  try {
    const res = await fetch('/api/track', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) throw new Error(await res.text());

    switchTab('dashboard');

  } catch (err) {
    status.textContent = '✗ Error: ' + err.message;
    status.style.color = 'var(--red-600)';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Save Entry';
  }
});

// ── AI Advisor ──────────────────────────────────────────────

// Mode toggle
document.querySelectorAll('.mode-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    currentMode = btn.dataset.mode;
    document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    const textarea = document.getElementById('ai-query');
    if (textarea) {
      textarea.placeholder = currentMode === 'diagnose'
        ? 'Describe the symptoms you\'re observing...'
        : 'Ask a question or leave blank for a general system review...';
    }
  });
});

async function submitAIQuery() {
  const query = document.getElementById('ai-query').value.trim();
  const submitBtn = document.getElementById('ai-submit-btn');
  const loading = document.getElementById('ai-loading');
  const responseCard = document.getElementById('ai-response-card');
  const responseBody = document.getElementById('ai-response-body');

  if (currentMode === 'diagnose' && !query) {
    document.getElementById('ai-query').focus();
    return;
  }

  submitBtn.style.display = 'none';
  loading.style.display = 'flex';
  responseCard.style.display = 'none';

  try {
    const res = await fetch('/api/consult', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, mode: currentMode }),
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
    const res = await fetch(`/api/history?days=${days}`);
    const { entries } = await res.json();
    renderHistoryTable(entries.slice().reverse()); // newest first for display
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
      const display = v !== null && v !== undefined ? fmt(v, p.key === 'temperature' ? 1 : 2) : '—';
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

document.getElementById('history-days').addEventListener('change', loadHistory);

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

  const payload = {
    date:             document.getElementById('edit-date').value,
    ph:               parseFloat(document.getElementById('edit-ph').value) || null,
    ammonia:          parseFloat(document.getElementById('edit-ammonia').value) || null,
    nitrite:          parseFloat(document.getElementById('edit-nitrite').value) || null,
    nitrate:          parseFloat(document.getElementById('edit-nitrate').value) || null,
    dissolved_oxygen: parseFloat(document.getElementById('edit-dissolved-oxygen').value) || null,
    temperature:      parseFloat(document.getElementById('edit-temperature').value) || null,
    potassium:        parseFloat(document.getElementById('edit-potassium').value) || null,
    calcium:          parseFloat(document.getElementById('edit-calcium').value) || null,
    magnesium:        parseFloat(document.getElementById('edit-magnesium').value) || null,
    iron:             parseFloat(document.getElementById('edit-iron').value) || null,
    plant_notes:      document.getElementById('edit-plant-notes').value.trim() || null,
  };

  try {
    const res = await fetch(`/api/entry/${id}`, {
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
      const res = await fetch(`/api/entry/${id}`, { method: 'DELETE' });
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
    const res = await fetch('/api/learnings', {
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
    const res = await fetch('/api/learnings');
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
    const res = await fetch(`/api/learnings/${id}`, {
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
      const res = await fetch(`/api/learnings/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(await res.text());
      loadLearnings();
    } catch (err) {
      alert('Error: ' + err.message);
    }
  });
}

// ── Init ────────────────────────────────────────────────────
function init() {
  loadDashboard();
}

init();
