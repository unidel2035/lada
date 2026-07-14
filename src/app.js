// app.js — загрузка данных, построение графа знаний, фильтры, статистика, боковая панель.
import { KnowledgeGraph } from './graph.js';

const STATUS_ORDER = ['read', 'reading', 'planned', 'unread'];

async function loadData() {
  // При открытии через http(s) — тянем JSON. При открытии как единый файл —
  // данные уже встроены в window.__GRAPH_DATA__ (см. dist/index.html).
  if (window.__GRAPH_DATA__) return window.__GRAPH_DATA__;
  const res = await fetch('../data/knowledge-graph.json');
  if (!res.ok) throw new Error('Не удалось загрузить данные (' + res.status + ')');
  return res.json();
}

function buildGraphModel(data) {
  const disciplineById = new Map(data.disciplines.map((d) => [d.id, d]));
  const statusById = new Map(data.meta.statuses.map((s) => [s.id, s]));

  const nodes = [];
  for (const b of data.books) {
    const disc = disciplineById.get(b.discipline);
    nodes.push({
      ...b,
      type: 'book',
      color: disc ? disc.color : '#888',
      short: shorten(b.title),
    });
  }
  // темы — узлы-хабы
  for (const t of data.themes) {
    nodes.push({ id: 't:' + t.id, name: t.name, type: 'theme' });
  }

  const links = [...data.links.map((l) => ({ ...l }))];
  // связи книга—тема
  for (const b of data.books) {
    for (const th of b.themes || []) {
      links.push({ source: b.id, target: 't:' + th, type: 'theme' });
    }
  }

  return { nodes, links, disciplineById, statusById };
}

function shorten(title, max = 22) {
  if (title.length <= max) return title;
  return title.slice(0, max - 1).trimEnd() + '…';
}

function render(data) {
  document.querySelector('#app-title').textContent = data.meta.title;
  document.querySelector('#app-subtitle').textContent = data.meta.subtitle;
  document.querySelector('#app-program').textContent = data.meta.program;

  const model = buildGraphModel(data);
  const svg = document.querySelector('#graph');
  const panel = document.querySelector('#detail');

  const graph = new KnowledgeGraph(svg, {
    onSelect: (node) => showDetail(node, data, model),
  });
  graph.setData({ nodes: model.nodes, links: model.links });

  // --- Статистика + фильтры ---
  buildStats(data);
  buildFilters(data, graph, model);

  // --- Поиск ---
  const search = document.querySelector('#search');
  search.addEventListener('input', () => applyFilters(graph, model, data));

  // --- Кнопки ---
  document.querySelector('#reset-view').addEventListener('click', () => graph.resetView());

  window.__graph = graph; // для отладки
  window.__applyFilters = () => applyFilters(graph, model, data);
}

function buildStats(data) {
  const counts = countByStatus(data.books);
  const total = data.books.length;
  const readShare = Math.round((counts.read / total) * 100);

  const wrap = document.querySelector('#stats');
  wrap.innerHTML = '';
  const progress = document.createElement('div');
  progress.className = 'progress';
  progress.innerHTML = `
    <div class="progress__head">
      <span>Прогресс чтения</span>
      <strong>${counts.read} / ${total} · ${readShare}%</strong>
    </div>
    <div class="progress__bar">
      ${STATUS_ORDER.map((s) => {
        const st = data.meta.statuses.find((x) => x.id === s);
        const pct = (counts[s] / total) * 100;
        return `<span style="width:${pct}%;background:${st.color}" title="${st.label}: ${counts[s]}"></span>`;
      }).join('')}
    </div>`;
  wrap.append(progress);
}

function countByStatus(books) {
  const c = { read: 0, reading: 0, planned: 0, unread: 0 };
  for (const b of books) c[b.status] = (c[b.status] || 0) + 1;
  return c;
}

const activeStatuses = new Set(STATUS_ORDER);
const activeDisciplines = new Set();

function buildFilters(data, graph, model) {
  // статусы
  const sBox = document.querySelector('#filter-status');
  sBox.innerHTML = '';
  for (const s of data.meta.statuses) {
    const label = document.createElement('label');
    label.className = 'toggle';
    label.innerHTML = `<input type="checkbox" checked data-status="${s.id}">
      <i style="background:${s.color}"></i>${s.label}`;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) activeStatuses.add(s.id); else activeStatuses.delete(s.id);
      applyFilters(graph, model, data);
    });
    sBox.append(label);
  }

  // дисциплины
  const dBox = document.querySelector('#filter-discipline');
  dBox.innerHTML = '';
  for (const d of data.disciplines) activeDisciplines.add(d.id);
  for (const d of data.disciplines) {
    const label = document.createElement('label');
    label.className = 'toggle';
    label.innerHTML = `<input type="checkbox" checked data-disc="${d.id}">
      <i style="background:${d.color}"></i>${d.name}`;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) activeDisciplines.add(d.id); else activeDisciplines.delete(d.id);
      applyFilters(graph, model, data);
    });
    dBox.append(label);
  }
}

function applyFilters(graph, model, data) {
  const q = document.querySelector('#search').value.trim().toLowerCase();
  graph.setFilter((nd) => {
    if (nd.type !== 'book') return true;
    if (!activeStatuses.has(nd.status)) return false;
    if (!activeDisciplines.has(nd.discipline)) return false;
    if (q) {
      const hay = (nd.title + ' ' + nd.author).toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function showDetail(node, data, model) {
  const panel = document.querySelector('#detail');
  if (!node || node.type === 'theme') {
    if (node && node.type === 'theme') {
      const related = data.books.filter((b) => (b.themes || []).includes(node.id.slice(2)));
      panel.innerHTML = `
        <div class="detail__kicker">Тема</div>
        <h2 class="detail__title">${node.name}</h2>
        <div class="detail__section">
          <h3>Книги по теме (${related.length})</h3>
          <ul class="detail__list">
            ${related.map((b) => `<li><span class="dot dot--${b.status}"></span>${b.title} <em>— ${b.author}</em></li>`).join('')}
          </ul>
        </div>`;
      panel.classList.add('is-open');
      return;
    }
    panel.classList.remove('is-open');
    panel.innerHTML = emptyDetail();
    return;
  }

  const disc = model.disciplineById.get(node.discipline);
  const status = model.statusById.get(node.status);
  const connections = data.links
    .filter((l) => l.source === node.id || l.target === node.id)
    .map((l) => {
      const otherId = l.source === node.id ? l.target : l.source;
      const other = data.books.find((b) => b.id === otherId);
      const lt = data.meta.linkTypes.find((t) => t.id === l.type);
      return other ? { title: other.title, author: other.author, rel: lt ? lt.label : l.type, status: other.status } : null;
    })
    .filter(Boolean);

  panel.innerHTML = `
    <div class="detail__kicker" style="color:${disc.color}">${disc.name}</div>
    <h2 class="detail__title">${node.title}</h2>
    <div class="detail__author">${node.author}${node.year ? ' · ' + formatYear(node.year) : ''}</div>
    <div class="detail__status">
      <span class="badge" style="background:${status.color}">${status.label}</span>
      ${node.rating ? `<span class="rating">${'★'.repeat(node.rating)}${'☆'.repeat(5 - node.rating)}</span>` : ''}
    </div>
    ${node.note ? `<p class="detail__note">${node.note}</p>` : ''}
    ${node.themes && node.themes.length ? `
      <div class="detail__section">
        <h3>Темы</h3>
        <div class="tags">${node.themes.map((t) => {
          const th = data.themes.find((x) => x.id === t);
          return `<span class="tag">${th ? th.name : t}</span>`;
        }).join('')}</div>
      </div>` : ''}
    ${connections.length ? `
      <div class="detail__section">
        <h3>Интеллектуальные связи (${connections.length})</h3>
        <ul class="detail__list">
          ${connections.map((c) => `<li><span class="dot dot--${c.status}"></span><span class="rel">${c.rel}:</span> ${c.title} <em>— ${c.author}</em></li>`).join('')}
        </ul>
      </div>` : ''}`;
  panel.classList.add('is-open');
}

function formatYear(y) {
  return y < 0 ? Math.abs(y) + ' до н. э.' : String(y);
}

function emptyDetail() {
  return `<div class="detail__empty">
    <p>Выберите книгу в графе, чтобы увидеть автора, статус чтения, заметку и связи с другими текстами.</p>
    <p class="muted">Наведите курсор на узел — подсветятся его соседи. Тяните узлы, крутите колесо для зума, тяните фон для панорамы.</p>
  </div>`;
}

loadData()
  .then(render)
  .catch((err) => {
    document.querySelector('#detail').innerHTML =
      `<div class="detail__empty"><p>Ошибка загрузки данных.</p><p class="muted">${err.message}</p>
       <p class="muted">Откройте проект через локальный сервер: <code>npm start</code>, либо используйте <code>dist/index.html</code>.</p></div>`;
  });
