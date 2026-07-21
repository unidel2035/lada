// app.js — граф знаний: данные, фильтры, статистика, детали,
// а также личный слой конспектов и ключевых слов (в духе Obsidian).
import { KnowledgeGraph } from './graph.js';

const STATUS_ORDER = ['read', 'reading', 'planned', 'unread'];
const NOTES_KEY = 'lada.notes.v1';
const STATUS_KEY = 'lada.status.v1';
const THEME_KEY = 'lada.theme.v1';

// --- Глобальное состояние -------------------------------------------------
let DATA = null;
let academic = null;        // { nodes, links, disciplineById, statusById }
let graph = null;
let notes = loadNotes();    // { nodeId: { text, updated, display? } }
let statusOverrides = loadStatus(); // { bookId: status } — личные отметки чтения
let showNotesLayer = true;
let lastPersonal = { hasNote: new Set(), refs: new Map(), kwDisplay: new Map() };

const activeStatuses = new Set(STATUS_ORDER);
const activeDisciplines = new Set();
const activeCollections = new Set();        // включённые крупные разделы
let disciplineToCollection = new Map();     // дисциплина → id раздела

// --- Загрузка данных ------------------------------------------------------
async function loadData() {
  if (window.__GRAPH_DATA__) return window.__GRAPH_DATA__;
  const res = await fetch('../data/knowledge-graph.json');
  if (!res.ok) throw new Error('Не удалось загрузить данные (' + res.status + ')');
  return res.json();
}

// --- Хранилище заметок ----------------------------------------------------
function loadNotes() {
  try { return JSON.parse(localStorage.getItem(NOTES_KEY)) || {}; }
  catch { return {}; }
}
function saveNotes() {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); }
  catch { /* приватный режим / песочница — храним только в памяти */ }
}
function loadStatus() {
  try { return JSON.parse(localStorage.getItem(STATUS_KEY)) || {}; }
  catch { return {}; }
}
function saveStatus() {
  try { localStorage.setItem(STATUS_KEY, JSON.stringify(statusOverrides)); }
  catch { /* только в памяти */ }
}
// Эффективный статус книги: личная отметка важнее статуса из данных.
function effectiveStatus(book) {
  return statusOverrides[book.id] || book.status || 'unread';
}

// --- Академическая модель графа -------------------------------------------
function buildAcademicModel(data) {
  const disciplineById = new Map(data.disciplines.map((d) => [d.id, d]));
  const statusById = new Map(data.meta.statuses.map((s) => [s.id, s]));

  const nodes = [];
  for (const b of data.books) {
    const disc = disciplineById.get(b.discipline);
    nodes.push({ ...b, status: effectiveStatus(b), type: 'book', color: disc ? disc.color : '#888', short: shorten(b.title) });
  }
  // философы — узлы-персоны (раздел античной философии)
  for (const p of data.philosophers || []) {
    const disc = disciplineById.get(p.discipline);
    nodes.push({ ...p, type: 'philosopher', color: disc ? disc.color : '#888', short: shorten(p.name, 18) });
  }
  for (const t of data.themes) {
    nodes.push({ id: 't:' + t.id, name: t.name, type: 'theme' });
  }

  const links = [...data.links.map((l) => ({ ...l })), ...(data.philLinks || []).map((l) => ({ ...l }))];
  for (const b of data.books) {
    for (const th of b.themes || []) links.push({ source: b.id, target: 't:' + th, type: 'theme' });
  }
  for (const p of data.philosophers || []) {
    for (const th of p.themes || []) links.push({ source: p.id, target: 't:' + th, type: 'theme' });
  }
  return { nodes, links, disciplineById, statusById };
}

// --- Личный слой: конспекты и ключевые слова ------------------------------
function normKw(raw) { return raw.trim().replace(/\s+/g, ' ').toLowerCase(); }

function parseWikilinks(text) {
  const out = [];
  const re = /\[\[([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const display = m[1].trim();
    if (display) out.push({ norm: normKw(display), display });
  }
  return out;
}

function buildPersonalLayer() {
  const kwDisplay = new Map();   // norm -> отображаемое имя
  const links = [];
  const hasNote = new Set();
  const refs = new Map();        // norm -> Set исходных узлов (для обратных ссылок)

  for (const [nodeId, entry] of Object.entries(notes)) {
    const text = (entry && entry.text || '').trim();
    if (nodeId.startsWith('kw:')) {
      const norm = nodeId.slice(3);
      if (!kwDisplay.has(norm)) kwDisplay.set(norm, (entry && entry.display) || norm);
    }
    if (!text) continue;
    hasNote.add(nodeId);
    for (const { norm, display } of parseWikilinks(text)) {
      if (!kwDisplay.has(norm)) kwDisplay.set(norm, display);
      links.push({ source: nodeId, target: 'kw:' + norm, type: 'note' });
      if (!refs.has(norm)) refs.set(norm, new Set());
      refs.get(norm).add(nodeId);
    }
  }

  const nodes = [];
  for (const [norm, display] of kwDisplay) {
    nodes.push({ id: 'kw:' + norm, name: display, type: 'keyword', short: shorten(display, 18) });
  }
  return { nodes, links, hasNote, refs, kwDisplay };
}

function buildFullModel() {
  // Обновляем эффективный статус книг — он мог измениться отметками пользователя.
  for (const n of academic.nodes) {
    if (n.type === 'book') {
      const b = DATA.books.find((x) => x.id === n.id);
      if (b) n.status = effectiveStatus(b);
    }
  }
  const personal = buildPersonalLayer();
  lastPersonal = personal;
  const nodes = [...academic.nodes, ...(showNotesLayer ? personal.nodes : [])];
  const links = [...academic.links, ...(showNotesLayer ? personal.links : [])];
  for (const n of nodes) n.hasNote = personal.hasNote.has(n.id);
  return { nodes, links };
}

// Перестроить только граф (без перерисовки панели деталей — важно при вводе текста)
let refreshTimer = null;
function refreshGraphOnly() {
  clearTimeout(refreshTimer);
  graph.setData(buildFullModel());
  applyFilters();
  updateNotesCount();
  buildStats(DATA);
}
function scheduleGraphRefresh() {
  clearTimeout(refreshTimer);
  refreshTimer = setTimeout(refreshGraphOnly, 500);
}

// --- Вспомогательное -------------------------------------------------------
function shorten(title, max = 22) {
  return title.length <= max ? title : title.slice(0, max - 1).trimEnd() + '…';
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function renderParagraphs(text) {
  return String(text).split(/\n{2,}/).map((p) => `<p>${escapeHtml(p.trim())}</p>`).join('');
}
function formatYear(y) { return y < 0 ? Math.abs(y) + ' до н. э.' : String(y); }

// --- Инициализация ---------------------------------------------------------
function render(data) {
  DATA = data;
  document.querySelector('#app-title').textContent = data.meta.title;
  document.querySelector('#app-subtitle').textContent = data.meta.subtitle || '';
  document.querySelector('#app-program').textContent = data.meta.program || '';

  academic = buildAcademicModel(data);
  const svg = document.querySelector('#graph');
  graph = new KnowledgeGraph(svg, { onSelect: (node) => renderDetail(node) });
  graph.setData(buildFullModel());

  buildStats(data);
  buildCollections(data);
  buildFilters(data);
  applyFilters();
  updateNotesCount();

  document.querySelector('#search').addEventListener('input', applyFilters);
  document.querySelector('#reset-view').addEventListener('click', () => graph.resetView());

  const toggle = document.querySelector('#toggle-notes');
  toggle.addEventListener('change', (e) => { showNotesLayer = e.target.checked; refreshGraphOnly(); });

  document.querySelector('#export-notes').addEventListener('click', exportNotes);
  document.querySelector('#import-notes').addEventListener('click', () => document.querySelector('#import-file').click());
  document.querySelector('#import-file').addEventListener('change', importNotes);

  initTheme();
  document.querySelector('#theme-toggle').addEventListener('click', toggleTheme);

  window.__graph = graph;
}

// --- Тема ------------------------------------------------------------------
function initTheme() {
  let saved;
  try { saved = localStorage.getItem(THEME_KEY); } catch { /* ignore */ }
  const prefersLight = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  applyTheme(saved || (prefersLight ? 'light' : 'dark'));
}
function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  const icon = document.querySelector('#theme-icon');
  const label = document.querySelector('#theme-label');
  if (icon) icon.textContent = theme === 'light' ? '☀️' : '🌙';
  if (label) label.textContent = theme === 'light' ? 'Светлая' : 'Тёмная';
}
function toggleTheme() {
  const next = document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light';
  applyTheme(next);
  try { localStorage.setItem(THEME_KEY, next); } catch { /* ignore */ }
}

// --- Статистика ------------------------------------------------------------
function buildStats(data) {
  const counts = countByStatus(data.books);
  const total = data.books.length;
  const readShare = Math.round((counts.read / total) * 100);
  const wrap = document.querySelector('#stats');
  wrap.innerHTML = `
    <div class="progress">
      <div class="progress__head"><span>Прогресс чтения</span>
        <strong>${counts.read} / ${total} · ${readShare}%</strong></div>
      <div class="progress__bar">
        ${STATUS_ORDER.map((s) => {
          const st = data.meta.statuses.find((x) => x.id === s);
          return `<span style="width:${(counts[s] / total) * 100}%;background:${st.color}" title="${st.label}: ${counts[s]}"></span>`;
        }).join('')}
      </div>
      <p class="progress__hint">Отметьте статус чтения в карточке книги (кнопки под названием). Отметки сохраняются в браузере.</p>
    </div>`;
}
function countByStatus(books) {
  const c = { read: 0, reading: 0, planned: 0, unread: 0 };
  for (const b of books) c[effectiveStatus(b)] = (c[effectiveStatus(b)] || 0) + 1;
  return c;
}
function updateNotesCount() {
  const noteCount = Object.values(notes).filter((n) => n && (n.text || '').trim()).length;
  const kwCount = lastPersonal.kwDisplay.size;
  document.querySelector('#notes-count').textContent =
    noteCount || kwCount ? `Конспектов: ${noteCount} · ключевых слов: ${kwCount}` : 'Пока нет конспектов';
}

// --- Разделы графа (крупные модули) ---------------------------------------
function buildCollections(data) {
  disciplineToCollection = new Map();
  activeCollections.clear();
  const cols = data.meta.collections || [];
  for (const c of cols) {
    activeCollections.add(c.id);
    for (const dId of c.disciplines) disciplineToCollection.set(dId, c.id);
  }
  const box = document.querySelector('#filter-collections');
  if (!box) return;
  box.innerHTML = '';
  if (cols.length < 2) return; // один раздел — переключать нечего
  for (const c of cols) {
    const n = data.books.filter((b) => c.disciplines.includes(b.discipline)).length
      + (data.philosophers || []).filter((p) => c.disciplines.includes(p.discipline)).length;
    const label = document.createElement('label');
    label.className = 'toggle toggle--collection';
    label.innerHTML = `<input type="checkbox" checked data-collection="${c.id}">
      <span class="col-name">${c.name}</span><span class="col-count">${n}</span>`;
    label.querySelector('input').addEventListener('change', (e) => {
      if (e.target.checked) activeCollections.add(c.id); else activeCollections.delete(c.id);
      applyFilters();
    });
    box.append(label);
  }
}
function collectionActive(discipline) {
  const col = disciplineToCollection.get(discipline);
  return !col || activeCollections.has(col);
}

// --- Фильтры ---------------------------------------------------------------
function buildFilters(data) {
  const sBox = document.querySelector('#filter-status');
  sBox.innerHTML = '';
  for (const s of data.meta.statuses) {
    const label = document.createElement('label');
    label.className = 'toggle';
    label.innerHTML = `<input type="checkbox" checked data-status="${s.id}"><i style="background:${s.color}"></i>${s.label}`;
    label.querySelector('input').addEventListener('change', (e) => {
      e.target.checked ? activeStatuses.add(s.id) : activeStatuses.delete(s.id);
      applyFilters();
    });
    sBox.append(label);
  }
  const dBox = document.querySelector('#filter-discipline');
  dBox.innerHTML = '';
  for (const d of data.disciplines) activeDisciplines.add(d.id);
  for (const d of data.disciplines) {
    const label = document.createElement('label');
    label.className = 'toggle';
    label.innerHTML = `<input type="checkbox" checked data-disc="${d.id}"><i style="background:${d.color}"></i>${d.name}`;
    label.querySelector('input').addEventListener('change', (e) => {
      e.target.checked ? activeDisciplines.add(d.id) : activeDisciplines.delete(d.id);
      applyFilters();
    });
    dBox.append(label);
  }
}
function applyFilters() {
  const q = document.querySelector('#search').value.trim().toLowerCase();
  const bookVisible = (nd) =>
    collectionActive(nd.discipline) && activeStatuses.has(nd.status) && activeDisciplines.has(nd.discipline)
    && (!q || (nd.title + ' ' + nd.author).toLowerCase().includes(q));
  const philVisible = (nd) =>
    collectionActive(nd.discipline) && activeDisciplines.has(nd.discipline)
    && (!q || (nd.name + ' ' + (nd.school || '')).toLowerCase().includes(q));

  // темы показываем только если у них есть хотя бы один видимый узел
  const visibleThemes = new Set();
  for (const nd of academic.nodes) {
    const vis = nd.type === 'book' ? bookVisible(nd) : nd.type === 'philosopher' ? philVisible(nd) : false;
    if (vis) for (const t of nd.themes || []) visibleThemes.add('t:' + t);
  }

  graph.setFilter((nd) => {
    if (nd.type === 'book') return bookVisible(nd);
    if (nd.type === 'philosopher') return philVisible(nd);
    if (nd.type === 'theme') return visibleThemes.has(nd.id);
    return true; // ключевые слова
  });
}

// --- Панель деталей --------------------------------------------------------
function renderDetail(node) {
  const panel = document.querySelector('#detail');
  if (!node) { panel.classList.remove('is-open'); panel.innerHTML = emptyDetail(); return; }
  if (node.type === 'book') panel.innerHTML = bookDetailHtml(node);
  else if (node.type === 'philosopher') panel.innerHTML = philosopherDetailHtml(node);
  else if (node.type === 'theme') panel.innerHTML = themeDetailHtml(node);
  else if (node.type === 'keyword') panel.innerHTML = keywordDetailHtml(node);
  panel.classList.add('is-open');
  panel.scrollTop = 0;
  wireDetail(node);
}

function noteEditorHtml(nodeId) {
  const text = (notes[nodeId] && notes[nodeId].text) || '';
  const kws = parseWikilinks(text);
  return `
    <div class="detail__section">
      <h3>Мой конспект <span class="saved-flag" data-flag>сохранено</span></h3>
      <textarea class="note-editor" data-note placeholder="Пишите конспект своими словами…">${escapeHtml(text)}</textarea>
      <p class="note-hint">Свяжите понятия: напишите <b>[[ключевое слово]]</b> — оно станет узлом графа, который тоже можно раскрыть и законспектировать.</p>
      ${kws.length ? `<div class="tags" style="margin-top:8px">${
        kws.map((k) => `<span class="tag wikilink" data-kw="${escapeHtml(k.norm)}" data-disp="${escapeHtml(k.display)}">${escapeHtml(k.display)}</span>`).join('')
      }</div>` : ''}
    </div>`;
}

// Метаданные любого узла (книга или философ) — для списков связей.
function nodeMeta(id) {
  const b = DATA.books.find((x) => x.id === id);
  if (b) {
    const disc = academic.disciplineById.get(b.discipline);
    const st = effectiveStatus(b);
    return { id, kind: 'book', label: b.title, sub: b.author, color: disc ? disc.color : '#888',
      dotColor: (academic.statusById.get(st) || {}).color || '#888' };
  }
  const p = (DATA.philosophers || []).find((x) => x.id === id);
  if (p) {
    const disc = academic.disciplineById.get(p.discipline);
    const c = disc ? disc.color : '#888';
    return { id, kind: 'philosopher', label: p.name, sub: p.school || p.years, color: c, dotColor: c };
  }
  return null;
}

// Все связи узла (из links и philLinks), с подписью типа.
function connectionsFor(id) {
  const all = [...DATA.links, ...(DATA.philLinks || [])];
  const out = [];
  for (const l of all) {
    if (l.source !== id && l.target !== id) continue;
    if (l.type === 'theme') continue;
    const meta = nodeMeta(l.source === id ? l.target : l.source);
    if (!meta) continue;
    const lt = DATA.meta.linkTypes.find((t) => t.id === l.type);
    out.push({ ...meta, rel: lt ? lt.label : l.type });
  }
  return out;
}

function connectionsHtml(connections) {
  return `<div class="detail__section"><h3>Связи (${connections.length})</h3>
    <ul class="detail__list">${connections.map((c) =>
      `<li class="conn" data-goto="${escapeHtml(c.id)}"><span class="dot" style="background:${c.dotColor}"></span><span class="rel">${c.rel}:</span> <span class="b-title">${escapeHtml(c.label)}</span> <em>— ${escapeHtml(c.sub || '')}</em></li>`).join('')}</ul></div>`;
}

function themesHtml(themeIds) {
  if (!themeIds || !themeIds.length) return '';
  return `<div class="detail__section"><h3>Темы</h3>
    <div class="tags">${themeIds.map((t) => {
      const th = DATA.themes.find((x) => x.id === t);
      return `<span class="tag theme-link" data-theme="t:${t}">${escapeHtml(th ? th.name : t)}</span>`;
    }).join('')}</div></div>`;
}

function philosopherDetailHtml(node) {
  const disc = academic.disciplineById.get(node.discipline);
  const connections = connectionsFor(node.id);
  return `
    <div class="detail__kicker" style="color:${disc.color}">Философ · ${escapeHtml(node.period || 'античность')}</div>
    <h2 class="detail__title">${escapeHtml(node.name)}</h2>
    <div class="detail__author">${escapeHtml(node.years || '')}${node.school ? ' · ' + escapeHtml(node.school) : ''}</div>
    ${node.idea ? `<div class="detail__section"><h3>Основные идеи</h3><div class="detail__idea">${renderParagraphs(node.idea)}</div></div>` : ''}
    ${themesHtml(node.themes)}
    ${connections.length ? connectionsHtml(connections) : ''}
    ${noteEditorHtml(node.id)}`;
}

function bookDetailHtml(node) {
  const disc = academic.disciplineById.get(node.discipline);
  const status = academic.statusById.get(node.status);
  const connections = connectionsFor(node.id);

  return `
    <div class="detail__kicker" style="color:${disc.color}">${escapeHtml(disc.name)}</div>
    <h2 class="detail__title">${escapeHtml(node.title)}</h2>
    <div class="detail__author">${escapeHtml(node.author)}${node.year ? ' · ' + formatYear(node.year) : ''}</div>
    <div class="detail__status">
      <span class="badge" style="background:${status.color}">${status.label}</span>
      ${node.status === 'read' && node.rating ? `<span class="rating">${'★'.repeat(node.rating)}${'☆'.repeat(5 - node.rating)}</span>` : ''}
    </div>
    <div class="detail__section">
      <h3>Статус чтения</h3>
      <div class="status-picker">
        ${DATA.meta.statuses.map((s) =>
          `<button type="button" class="status-btn${node.status === s.id ? ' is-active' : ''}" data-set-status="${s.id}">
            <i style="background:${s.color}"></i>${s.label}</button>`).join('')}
      </div>
    </div>
    ${node.note ? `<p class="detail__note">${escapeHtml(node.note)}</p>` : ''}
    ${node.idea ? `<div class="detail__section"><h3>Основные идеи</h3><div class="detail__idea">${renderParagraphs(node.idea)}</div></div>` : ''}
    ${themesHtml(node.themes)}
    ${connections.length ? connectionsHtml(connections) : ''}
    ${noteEditorHtml(node.id)}`;
}

function themeDetailHtml(node) {
  const themeId = node.id.slice(2);
  const related = [
    ...DATA.books.filter((b) => (b.themes || []).includes(themeId)),
    ...(DATA.philosophers || []).filter((p) => (p.themes || []).includes(themeId)),
  ].map((n) => nodeMeta(n.id)).filter(Boolean);
  return `
    <div class="detail__kicker">Тема</div>
    <h2 class="detail__title">${escapeHtml(node.name)}</h2>
    <div class="detail__section"><h3>Книги и философы по теме (${related.length})</h3>
      <ul class="detail__list">${related.map((c) =>
        `<li class="conn" data-goto="${escapeHtml(c.id)}"><span class="dot" style="background:${c.dotColor}"></span><span class="b-title">${escapeHtml(c.label)}</span> <em>— ${escapeHtml(c.sub || '')}</em></li>`).join('')}</ul></div>
    ${noteEditorHtml(node.id)}`;
}

function keywordDetailHtml(node) {
  const norm = node.id.slice(3);
  const backSet = lastPersonal.refs.get(norm) || new Set();
  const backlinks = [...backSet].map((id) => nodeLabel(id)).filter(Boolean);
  return `
    <div class="detail__kicker" style="color:#b48ead">Ключевое слово · мой граф</div>
    <h2 class="detail__title">${escapeHtml(node.name)}</h2>
    ${backlinks.length ? `
      <div class="detail__section"><h3>Упоминается в (${backlinks.length})</h3>
        <ul class="detail__list">${backlinks.map((b) =>
          `<li class="backlink" data-goto="${escapeHtml(b.id)}"><span class="dot" style="background:${b.color}"></span><span class="b-title">${escapeHtml(b.label)}</span></li>`).join('')}</ul></div>` : ''}
    ${noteEditorHtml(node.id)}`;
}

function nodeLabel(id) {
  if (id.startsWith('t:')) {
    const t = DATA.themes.find((x) => 't:' + x.id === id);
    return t ? { id, label: 'Тема: ' + t.name, color: '#4b556b' } : null;
  }
  if (id.startsWith('kw:')) {
    const disp = lastPersonal.kwDisplay.get(id.slice(3)) || id.slice(3);
    return { id, label: disp, color: '#b48ead' };
  }
  const meta = nodeMeta(id);
  if (meta) return { id, label: meta.label, color: meta.color };
  return null;
}

function emptyDetail() {
  return `<div class="detail__empty">
    <p>Выберите книгу, тему или ключевое слово в графе.</p>
    <p class="muted">У любого узла можно вести <b>свой конспект</b> и связывать понятия через <b>[[ключевые слова]]</b> — они образуют личный граф поверх учебного.</p>
    <p class="muted">Наведите курсор — подсветятся соседи. Тяните узлы, зум колесом, панорама фоном.</p>
  </div>`;
}

// --- Живое редактирование конспекта ---------------------------------------
function wireDetail(node) {
  const panel = document.querySelector('#detail');
  const ta = panel.querySelector('[data-note]');
  if (ta) {
    const flag = panel.querySelector('[data-flag]');
    let flagTimer;
    ta.addEventListener('input', () => {
      setNote(node.id, ta.value, node);
      if (flag) { flag.classList.add('show'); clearTimeout(flagTimer); flagTimer = setTimeout(() => flag.classList.remove('show'), 900); }
      scheduleGraphRefresh();
    });
    ta.addEventListener('blur', () => {
      refreshGraphOnly();
      renderDetail(graph.nodeById.get(node.id) || node);
    });
  }
  panel.querySelectorAll('[data-set-status]').forEach((el) =>
    el.addEventListener('click', () => setStatus(node.id, el.dataset.setStatus)));
  panel.querySelectorAll('.wikilink').forEach((el) =>
    el.addEventListener('click', () => selectKeyword(el.dataset.kw, el.dataset.disp)));
  panel.querySelectorAll('.backlink, .conn').forEach((el) =>
    el.addEventListener('click', () => goTo(el.dataset.goto)));
  panel.querySelectorAll('.theme-link').forEach((el) =>
    el.addEventListener('click', () => goTo(el.dataset.theme)));
}

function setStatus(bookId, status) {
  const book = DATA.books.find((b) => b.id === bookId);
  // Повторный клик по текущему статусу — снять отметку (вернуть статус из данных).
  if (effectiveStatus(book) === status) delete statusOverrides[bookId];
  else statusOverrides[bookId] = status;
  saveStatus();
  refreshGraphOnly();
  renderDetail(graph.nodeById.get(bookId));
}

function setNote(id, text, node) {
  if (text.trim()) {
    notes[id] = { text, updated: Date.now(), display: node.type === 'keyword' ? node.name : undefined };
  } else {
    delete notes[id];
  }
  saveNotes();
}

function selectKeyword(norm, display) {
  const id = 'kw:' + norm;
  if (!showNotesLayer) { showNotesLayer = true; document.querySelector('#toggle-notes').checked = true; }
  refreshGraphOnly();
  if (graph.nodeById.has(id)) graph.select(id);
  else renderDetail({ id, name: display, type: 'keyword' });
}

function goTo(id) {
  refreshGraphOnly();
  if (graph.nodeById.has(id)) graph.select(id);
}

// --- Экспорт / импорт заметок ---------------------------------------------
function exportNotes() {
  const blob = new Blob([JSON.stringify(notes, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'konspekt-notes.json';
  a.click();
  URL.revokeObjectURL(a.href);
}
function importNotes(e) {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const imported = JSON.parse(reader.result);
      notes = { ...notes, ...imported };
      saveNotes();
      refreshGraphOnly();
      renderDetail(null);
    } catch { alert('Не удалось прочитать файл заметок.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
}

loadData().then(render).catch((err) => {
  document.querySelector('#detail').innerHTML =
    `<div class="detail__empty"><p>Ошибка загрузки данных.</p><p class="muted">${escapeHtml(err.message)}</p>
     <p class="muted">Откройте проект через локальный сервер (<code>npm start</code>) или используйте <code>dist/index.html</code>.</p></div>`;
});
