// ---------- Inställningar ----------
const YEARS = [2026, 2027];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Maj', 'Jun', 'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dec'];
const ROW_LABELS = [
  'enkätutskick T',
  'webbkodsutskick T',
  'enkätutskick K',
  'webbkodsutskick K',
  'inkomna enkäter'
];
const STORAGE_KEY = 'gantt-schema-v1';
const REMOTE_ID = 'main';          // raden i databasen som delas av alla
const SAVE_DELAY = 700;            // ms väntan efter sista ändringen innan det sparas online
const NAME_MIN = 220;              // minsta bredd på namnkolumnen (px)
const NAME_MAX = 520;              // största bredd på namnkolumnen (px)

// ---------- Tillstånd ----------
const expanded = new Set(['2026']);   // utfällda kolumner (personlig vy, sparas bara lokalt)
const projects = [];                  // { name, open, values: [ {datum: tal}, ... ] } (delas)

let remoteReady = false;   // true först när vi har läst från databasen
let saveTimer = null;
let dirty = false;

const hasRemote = typeof SUPABASE_URL !== 'undefined' && !SUPABASE_URL.includes('DITT-PROJEKT');

const gantt = document.getElementById('gantt');

// ---------- Status ----------
function setStatus(text, isError = false) {
  const el = document.getElementById('status');
  el.textContent = text;
  el.className = isError ? 'error' : '';
}

// ---------- Lokal cache ----------
function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      expanded: [...expanded],
      projects
    }));
  } catch (err) {
    console.warn('Kunde inte spara lokalt:', err);
  }
}

function normalizeProjects(list) {
  return list.map((p, i) => ({
    name: typeof p.name === 'string' && p.name ? p.name : `Projekt ${i + 1}`,
    open: p.open !== false,
    values: ROW_LABELS.map((_, ri) => ({ ...(p.values?.[ri] ?? {}) }))
  }));
}

function setProjects(list) {
  projects.length = 0;
  projects.push(...normalizeProjects(list));
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const data = JSON.parse(raw);
    if (Array.isArray(data?.projects)) setProjects(data.projects);
    if (Array.isArray(data?.expanded)) {
      expanded.clear();
      data.expanded.forEach(k => expanded.add(String(k)));
    }
  } catch (err) {
    console.warn('Kunde inte läsa lokal data:', err);
  }
}

// ---------- Databas (Supabase via REST) ----------
const REST = hasRemote ? `${SUPABASE_URL}/rest/v1/gantt_state` : '';
const headers = () => ({ apikey: SUPABASE_KEY, 'Content-Type': 'application/json' });

async function fetchRemote() {
  const res = await fetch(`${REST}?id=eq.${REMOTE_ID}&select=data`, { headers: headers() });
  if (!res.ok) throw new Error(`Hämtning misslyckades (${res.status})`);
  const rows = await res.json();
  return rows.length ? rows[0].data : null;
}

async function pushRemote() {
  if (!hasRemote || !remoteReady || !dirty) return;
  dirty = false;
  setStatus('Sparar…');
  try {
    const res = await fetch(REST, {
      method: 'POST',
      keepalive: true,
      headers: { ...headers(), Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({
        id: REMOTE_ID,
        data: { version: 1, projects },
        updated_at: new Date().toISOString()
      })
    });
    if (!res.ok) throw new Error(`Sparning misslyckades (${res.status})`);
    setStatus('Sparat ✓');
  } catch (err) {
    dirty = true;
    console.warn(err);
    setStatus('Kunde inte spara online – försöker igen vid nästa ändring', true);
  }
}

// Spara delade ändringar: direkt lokalt, online efter en kort paus
function saveData() {
  saveLocal();
  if (!hasRemote) return;
  dirty = true;
  clearTimeout(saveTimer);
  saveTimer = setTimeout(pushRemote, SAVE_DELAY);
}

// Skicka väntande ändringar om fliken stängs eller döljs
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && dirty) {
    clearTimeout(saveTimer);
    pushRemote();
  }
});

// ---------- Hjälpfunktioner ----------
const pad = n => String(n).padStart(2, '0');

function h(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

// Anpassar namnkolumnens bredd efter det längsta projektnamnet
const measureCtx = document.createElement('canvas').getContext('2d');

function updateNameWidth(overrideIndex, typed) {
  const cs = getComputedStyle(document.body);
  measureCtx.font = `600 ${cs.fontSize} ${cs.fontFamily}`;   // projektnamn är fetstilta

  const names = projects.map((p, i) => (i === overrideIndex ? typed : p.name));
  const longest = Math.max(0, ...names.map(n => measureCtx.measureText(n).width));

  // + pil, luft och marginaler
  const width = Math.min(Math.max(Math.ceil(longest) + 80, NAME_MIN), NAME_MAX);
  gantt.style.setProperty('--name-w', `${width}px`);
}

// ---------- Bygg tidslinjens träd: år > kvartal > månad > datum ----------
function buildTimeline() {
  return YEARS.map(y => {
    const quarters = [0, 1, 2, 3].map(q => {
      const months = [0, 1, 2].map(i => {
        const m = q * 3 + i;
        const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
        const dates = Array.from({ length: days }, (_, d) => `${y}-${pad(m + 1)}-${pad(d + 1)}`);
        return {
          key: `${y}-${pad(m + 1)}`,
          label: MONTHS[m],
          dates,
          children: dates.map(d => ({ key: d, label: d, dates: [d], isDate: true }))
        };
      });
      return {
        key: `${y}-Q${q + 1}`,
        label: `Q${q + 1}`,
        dates: months.flatMap(m => m.dates),
        children: months
      };
    });
    return {
      key: String(y),
      label: String(y),
      dates: quarters.flatMap(q => q.dates),
      children: quarters
    };
  });
}

const TIMELINE = buildTimeline();

function visibleColumns(nodes, out = []) {
  for (const n of nodes) {
    if (n.isDate || !expanded.has(n.key)) out.push(n);
    else visibleColumns(n.children, out);
  }
  return out;
}

// ---------- Rendering ----------
function headNode(node) {
  if (node.isDate) return h('div', 'h d', node.label);

  const open = expanded.has(node.key);
  const btn = h('button', 'h', node.label);
  btn.type = 'button';
  btn.dataset.key = node.key;
  btn.setAttribute('aria-expanded', open);
  if (!open) return btn;

  const wrap = h('div', 'n');
  const kids = h('div', 'k');
  node.children.forEach(c => kids.append(headNode(c)));
  wrap.append(btn, kids);
  return wrap;
}

function projectRow(p, pi, cols) {
  const row = h('div', 'row project');

  const name = h('div', 'name');
  const toggle = h('button', 'toggle', p.open ? '▾' : '▸');
  toggle.type = 'button';
  toggle.dataset.project = pi;
  toggle.setAttribute('aria-expanded', p.open);
  toggle.setAttribute('aria-label', 'Visa/dölj rader');

  const input = h('input', 'name-input');
  input.type = 'text';
  input.value = p.name;
  input.dataset.project = pi;
  name.append(toggle, input);

  const tl = h('div', 'tl');
  cols.forEach(col => tl.append(h('div', col.isDate ? 'c d' : 'c')));

  row.append(name, tl);
  return row;
}

function dataRow(p, pi, ri, cols) {
  const row = h('div', 'row sub');
  row.append(h('div', 'name', ROW_LABELS[ri]));   // bara radens rubrik, utan projektnamn

  const tl = h('div', 'tl');
  const vals = p.values[ri];

  for (const col of cols) {
    if (col.isDate) {
      const c = h('div', 'c d');
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.step = '1';
      input.value = vals[col.key] ?? '';
      input.dataset.project = pi;
      input.dataset.row = ri;
      input.dataset.date = col.key;
      c.append(input);
      tl.append(c);
    } else {
      const sum = col.dates.reduce((s, d) => s + (vals[d] || 0), 0);
      tl.append(h('div', sum ? 'c sum' : 'c', sum ? sum : ''));
    }
  }

  row.append(tl);
  return row;
}

function render() {
  updateNameWidth();

  const { scrollLeft, scrollTop } = gantt;
  const cols = visibleColumns(TIMELINE);

  const inner = h('div', 'inner');

  const head = h('div', 'row head');
  const tl = h('div', 'tl');
  TIMELINE.forEach(n => tl.append(headNode(n)));
  head.append(h('div', 'name', 'Projekt'), tl);
  inner.append(head);

  projects.forEach((p, pi) => {
    inner.append(projectRow(p, pi, cols));
    if (p.open) {
      ROW_LABELS.forEach((_, ri) => inner.append(dataRow(p, pi, ri, cols)));
    }
  });

  gantt.replaceChildren(inner);
  gantt.scrollLeft = scrollLeft;
  gantt.scrollTop = scrollTop;
}

// ---------- Projekt ----------
function addProject() {
  projects.push({
    name: `Projekt ${projects.length + 1}`,
    open: true,
    values: ROW_LABELS.map(() => ({}))
  });
  render();
  saveData();
}

// ---------- Händelser ----------
gantt.addEventListener('click', e => {
  // Fäll ut/in kolumner (personlig vy, sparas bara lokalt)
  const colBtn = e.target.closest('button.h');
  if (colBtn) {
    const key = colBtn.dataset.key;
    expanded.has(key) ? expanded.delete(key) : expanded.add(key);
    render();
    saveLocal();
    return;
  }
  // Fäll ut/in projektets rader
  const rowBtn = e.target.closest('button.toggle');
  if (rowBtn) {
    const p = projects[rowBtn.dataset.project];
    p.open = !p.open;
    render();
    saveData();
  }
});

gantt.addEventListener('input', e => {
  const t = e.target;

  // Projektnamn: justera kolumnbredden medan man skriver
  if (t.matches('.name-input')) {
    updateNameWidth(Number(t.dataset.project), t.value);
    return;
  }

  // Siffror i datumceller
  if (!t.matches('.c input')) return;
  const vals = projects[t.dataset.project].values[t.dataset.row];
  const n = t.valueAsNumber;
  if (Number.isNaN(n)) delete vals[t.dataset.date];
  else vals[t.dataset.date] = n;
  saveData();
});

gantt.addEventListener('change', e => {
  if (!e.target.matches('.name-input')) return;
  const p = projects[e.target.dataset.project];
  p.name = e.target.value.trim() || p.name;
  render();
  saveData();
});

document.getElementById('add-project').addEventListener('click', addProject);

// ---------- Start ----------
async function init() {
  loadLocal();                       // visa cachen direkt, så sidan inte är tom
  if (projects.length) render();

  if (!hasRemote) {
    setStatus('Endast lokal lagring (fyll i config.js för att spara online)', true);
    if (!projects.length) addProject();
    return;
  }

  setStatus('Hämtar…');
  try {
    const remote = await fetchRemote();
    if (remote && Array.isArray(remote.projects)) setProjects(remote.projects);
    remoteReady = true;
    if (!projects.length) addProject();
    else { render(); if (!remote) saveData(); }   // första gången: skicka upp det som finns lokalt
    setStatus('Ansluten ✓');
  } catch (err) {
    console.warn(err);
    setStatus('Kunde inte nå databasen – ändringar sparas bara lokalt', true);
    if (!projects.length) addProject();
  }
}

init();   // måste ligga sist i filen