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

// ---------- Tillstånd ----------
const expanded = new Set(['2026']);   // nycklar för utfällda kolumner
const projects = [];                  // { name, open, values: [ {datum: tal}, ... ] }

// ---------- Spara / ladda (localStorage) ----------
function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      version: 1,
      expanded: [...expanded],
      projects
    }));
  } catch (err) {
    console.warn('Kunde inte spara till localStorage:', err);
  }
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;

    const data = JSON.parse(raw);
    if (!data || !Array.isArray(data.projects)) return false;

    projects.length = 0;
    data.projects.forEach((p, i) => {
      projects.push({
        name: typeof p.name === 'string' && p.name ? p.name : `Projekt ${i + 1}`,
        open: p.open !== false,
        // säkerställ att det finns exakt en värdelista per underrad
        values: ROW_LABELS.map((_, ri) => ({ ...(p.values?.[ri] ?? {}) }))
      });
    });

    if (Array.isArray(data.expanded)) {
      expanded.clear();
      data.expanded.forEach(k => expanded.add(String(k)));
    }
    return projects.length > 0;
  } catch (err) {
    console.warn('Kunde inte läsa sparad data:', err);
    return false;
  }
}

// ---------- Hjälpfunktioner ----------
const pad = n => String(n).padStart(2, '0');

function h(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
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

// Vilka kolumner syns just nu? (utfällda noder ersätts av sina barn)
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
  row.append(h('div', 'name', `${p.name} ${ROW_LABELS[ri]}`));

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
      // hopfälld period: visa summan av de inskrivna talen
      const sum = col.dates.reduce((s, d) => s + (vals[d] || 0), 0);
      const c = h('div', sum ? 'c sum' : 'c', sum ? sum : '');
      tl.append(c);
    }
  }

  row.append(tl);
  return row;
}

function render() {
  const gantt = document.getElementById('gantt');
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

  saveState();   // varje ändring som ritar om sidan sparas också
}

// ---------- Projekt ----------
function addProject() {
  projects.push({
    name: `Projekt ${projects.length + 1}`,
    open: true,
    values: ROW_LABELS.map(() => ({}))
  });
  render();
}

// ---------- Händelser ----------
const gantt = document.getElementById('gantt');

gantt.addEventListener('click', e => {
  // Fäll ut/in kolumner (år, kvartal, månad)
  const colBtn = e.target.closest('button.h');
  if (colBtn) {
    const key = colBtn.dataset.key;
    expanded.has(key) ? expanded.delete(key) : expanded.add(key);
    render();
    return;
  }
  // Fäll ut/in projektets rader
  const rowBtn = e.target.closest('button.toggle');
  if (rowBtn) {
    const p = projects[rowBtn.dataset.project];
    p.open = !p.open;
    render();
  }
});

// Siffror i datumceller sparas direkt (utan att rita om, så markören hänger kvar)
gantt.addEventListener('input', e => {
  const t = e.target;
  if (!t.matches('.c input')) return;
  const vals = projects[t.dataset.project].values[t.dataset.row];
  const n = t.valueAsNumber;
  if (Number.isNaN(n)) delete vals[t.dataset.date];
  else vals[t.dataset.date] = n;
  saveState();
});

// Nytt projektnamn: uppdaterar även radnamnen
gantt.addEventListener('change', e => {
  if (!e.target.matches('.name-input')) return;
  const p = projects[e.target.dataset.project];
  p.name = e.target.value.trim() || p.name;
  render();   // sparar också
});

document.getElementById('add-project').addEventListener('click', addProject);

// ---------- Start ----------
if (loadState()) render();
else addProject();