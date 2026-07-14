// graph.js — силовая раскладка и отрисовка графа знаний на SVG.
// Без внешних зависимостей: простая физическая модель (отталкивание + пружины + гравитация).

const SVG_NS = 'http://www.w3.org/2000/svg';

export class KnowledgeGraph {
  constructor(svg, { onSelect } = {}) {
    this.svg = svg;
    this.onSelect = onSelect || (() => {});
    this.nodes = [];
    this.links = [];
    this.nodeById = new Map();
    this.selectedId = null;
    this.hoverId = null;
    this.filter = null; // (node) => boolean

    // Слои SVG (порядок = z-index)
    this.gRoot = el('g');
    this.gLinks = el('g', { class: 'links' });
    this.gNodes = el('g', { class: 'nodes' });
    this.gRoot.append(this.gLinks, this.gNodes);
    this.svg.append(this.gRoot);

    // Трансформация вида (зум/панорама)
    this.view = { x: 0, y: 0, k: 1 };

    this._bindInteractions();
    this._raf = null;
    this.alpha = 1; // «температура» симуляции
  }

  setData({ nodes, links }) {
    const rect = this.svg.getBoundingClientRect();
    const cx = rect.width / 2 || 500;
    const cy = rect.height / 2 || 400;

    // Сохраняем координаты уже размещённых узлов, чтобы граф не «прыгал»
    // при добавлении/удалении заметок и ключевых слов.
    const prev = this.nodeById || new Map();

    this.nodes = nodes.map((n, i) => {
      const old = prev.get(n.id);
      if (old) return { ...n, x: old.x, y: old.y, vx: old.vx, vy: old.vy };
      // Новый узел появляется рядом с уже существующим соседом, если он есть.
      const angle = (i / nodes.length) * Math.PI * 2;
      const r = 60 + (i % 7) * 45;
      return {
        ...n,
        x: cx + Math.cos(angle) * r,
        y: cy + Math.sin(angle) * r,
        vx: 0, vy: 0,
      };
    });
    this.nodeById = new Map(this.nodes.map((n) => [n.id, n]));

    this.links = links
      .map((l) => ({
        ...l,
        source: this.nodeById.get(l.source),
        target: this.nodeById.get(l.target),
      }))
      .filter((l) => l.source && l.target);

    // степень узла — влияет на размер
    for (const n of this.nodes) n.degree = 0;
    for (const l of this.links) { l.source.degree++; l.target.degree++; }

    this._buildDom();
    // восстановить выделение, если выбранный узел ещё существует
    if (this.selectedId && !this.nodeById.has(this.selectedId)) this.selectedId = null;
    this._applyHighlight();
    this.reheat(prev.size ? 0.5 : 1);
  }

  reheat(alpha = 0.8) {
    this.alpha = Math.max(this.alpha, alpha);
    if (!this._raf) this._tick();
  }

  setFilter(fn) {
    this.filter = fn;
    this._applyFilter();
    this.reheat(0.5);
  }

  select(id) {
    this.selectedId = id;
    this._applyHighlight();
    this.onSelect(id ? this.nodeById.get(id) : null);
  }

  // --- Симуляция -----------------------------------------------------------
  _tick() {
    this._raf = requestAnimationFrame(() => this._tick());
    const nodes = this.nodes;
    const n = nodes.length;
    if (!n) return;

    const REPULSION = 5200;
    const SPRING = 0.02;
    const GRAVITY = 0.015;
    const DAMPING = 0.86;

    const rect = this.svg.getBoundingClientRect();
    const cx = rect.width / 2, cy = rect.height / 2;

    // Отталкивание (O(n^2), достаточно для ~70 узлов)
    for (let i = 0; i < n; i++) {
      const a = nodes[i];
      for (let j = i + 1; j < n; j++) {
        const b = nodes[j];
        let dx = a.x - b.x, dy = a.y - b.y;
        let d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = Math.cos(i + j); dy = Math.sin(i + j); d2 = 1; }
        const d = Math.sqrt(d2);
        const f = REPULSION / d2;
        const fx = (dx / d) * f, fy = (dy / d) * f;
        a.vx += fx; a.vy += fy;
        b.vx -= fx; b.vy -= fy;
      }
    }

    // Пружины связей
    for (const l of this.links) {
      const a = l.source, b = l.target;
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const rest = l.rest || 110;
      const f = (d - rest) * SPRING;
      const fx = (dx / d) * f, fy = (dy / d) * f;
      a.vx += fx; a.vy += fy;
      b.vx -= fx; b.vy -= fy;
    }

    // Гравитация к центру + интегрирование
    for (const nd of nodes) {
      if (nd.fixed) { nd.vx = 0; nd.vy = 0; continue; }
      nd.vx += (cx - nd.x) * GRAVITY;
      nd.vy += (cy - nd.y) * GRAVITY;
      nd.vx *= DAMPING; nd.vy *= DAMPING;
      nd.x += nd.vx * this.alpha;
      nd.y += nd.vy * this.alpha;
    }

    this._render();

    this.alpha *= 0.985;
    if (this.alpha < 0.02 && !this._dragging) {
      cancelAnimationFrame(this._raf);
      this._raf = null;
    }
  }

  // --- DOM -----------------------------------------------------------------
  _buildDom() {
    this.gLinks.replaceChildren();
    this.gNodes.replaceChildren();
    this.linkEls = new Map();
    this.nodeEls = new Map();

    for (const l of this.links) {
      const line = el('line', { class: `link link--${l.type}` });
      this.gLinks.append(line);
      this.linkEls.set(l, line);
    }

    for (const nd of this.nodes) {
      const statusClass = nd.type === 'book' ? `node--${nd.status}` : `node--${nd.type}`;
      const noteClass = nd.hasNote ? ' has-note' : '';
      const g = el('g', { class: `node ${statusClass}${noteClass}`, 'data-id': nd.id });
      let shape;
      if (nd.type === 'theme') {
        shape = el('rect', { class: 'node__shape node__shape--theme', rx: 4 });
      } else if (nd.type === 'keyword') {
        shape = el('circle', { class: 'node__shape node__shape--keyword' });
      } else {
        shape = el('circle', { class: 'node__shape', style: `--node-color:${nd.color}` });
      }
      const label = el('text', { class: 'node__label' });
      label.textContent = nd.short || nd.title || nd.name;
      g.append(shape, label);
      this.gNodes.append(g);
      this.nodeEls.set(nd, { g, shape, label });

      g.addEventListener('pointerdown', (e) => this._startDrag(e, nd));
      g.addEventListener('pointerenter', () => { this.hoverId = nd.id; this._applyHighlight(); });
      g.addEventListener('pointerleave', () => { this.hoverId = null; this._applyHighlight(); });
      g.addEventListener('click', (e) => { e.stopPropagation(); this.select(nd.id); });
    }
    this._applyFilter();
    this._applyHighlight();
  }

  _nodeRadius(nd) {
    if (nd.type === 'theme') return 0;
    if (nd.type === 'keyword') return 6 + Math.min(nd.degree || 0, 6) * 1.4;
    const base = nd.status === 'read' ? 10 : 8;
    return base + Math.min(nd.degree || 0, 6) * 1.6;
  }

  _render() {
    for (const [l, line] of this.linkEls) {
      line.setAttribute('x1', l.source.x);
      line.setAttribute('y1', l.source.y);
      line.setAttribute('x2', l.target.x);
      line.setAttribute('y2', l.target.y);
    }
    for (const [nd, { g, shape, label }] of this.nodeEls) {
      g.setAttribute('transform', `translate(${nd.x},${nd.y})`);
      if (nd.type === 'theme') {
        const w = (nd.name.length) * 6.2 + 16, h = 20;
        shape.setAttribute('x', -w / 2); shape.setAttribute('y', -h / 2);
        shape.setAttribute('width', w); shape.setAttribute('height', h);
        label.setAttribute('y', 4);
      } else {
        const r = this._nodeRadius(nd);
        shape.setAttribute('r', r);
        label.setAttribute('y', r + 12);
      }
    }
  }

  _applyFilter() {
    if (!this.nodeEls) return;
    for (const [nd, { g }] of this.nodeEls) {
      const visible = !this.filter || nd.type === 'theme' || this.filter(nd);
      g.classList.toggle('is-hidden', !visible);
      nd._visible = visible;
    }
    for (const [l, line] of this.linkEls) {
      const vis = (l.source._visible !== false) && (l.target._visible !== false);
      line.classList.toggle('is-hidden', !vis);
    }
  }

  _applyHighlight() {
    const active = this.hoverId || this.selectedId;
    const neighbors = new Set();
    if (active) {
      neighbors.add(active);
      for (const l of this.links) {
        if (l.source.id === active) neighbors.add(l.target.id);
        if (l.target.id === active) neighbors.add(l.source.id);
      }
    }
    for (const [nd, { g }] of this.nodeEls) {
      g.classList.toggle('is-selected', nd.id === this.selectedId);
      g.classList.toggle('is-dim', !!active && !neighbors.has(nd.id));
    }
    for (const [l, line] of this.linkEls) {
      const on = active && (l.source.id === active || l.target.id === active);
      line.classList.toggle('is-active', !!on);
      line.classList.toggle('is-dim', !!active && !on);
    }
  }

  // --- Взаимодействие ------------------------------------------------------
  _bindInteractions() {
    this.svg.addEventListener('click', () => this.select(null));

    // зум колесом
    this.svg.addEventListener('wheel', (e) => {
      e.preventDefault();
      const scale = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const rect = this.svg.getBoundingClientRect();
      const mx = e.clientX - rect.left, my = e.clientY - rect.top;
      this.view.x = mx - (mx - this.view.x) * scale;
      this.view.y = my - (my - this.view.y) * scale;
      this.view.k = Math.max(0.3, Math.min(3, this.view.k * scale));
      this._applyView();
    }, { passive: false });

    // панорама фоном
    let panning = null;
    this.svg.addEventListener('pointerdown', (e) => {
      if (e.target === this.svg) panning = { x: e.clientX, y: e.clientY, vx: this.view.x, vy: this.view.y };
    });
    window.addEventListener('pointermove', (e) => {
      if (!panning) return;
      this.view.x = panning.vx + (e.clientX - panning.x);
      this.view.y = panning.vy + (e.clientY - panning.y);
      this._applyView();
    });
    window.addEventListener('pointerup', () => { panning = null; });
  }

  _applyView() {
    this.gRoot.setAttribute('transform', `translate(${this.view.x},${this.view.y}) scale(${this.view.k})`);
  }

  _startDrag(e, nd) {
    e.stopPropagation();
    this._dragging = true;
    nd.fixed = true;
    const rect = this.svg.getBoundingClientRect();
    const toWorld = (cx, cy) => ({
      x: (cx - rect.left - this.view.x) / this.view.k,
      y: (cy - rect.top - this.view.y) / this.view.k,
    });
    const move = (ev) => {
      const p = toWorld(ev.clientX, ev.clientY);
      nd.x = p.x; nd.y = p.y; nd.vx = 0; nd.vy = 0;
      this.reheat(0.4);
    };
    const up = () => {
      this._dragging = false;
      nd.fixed = false;
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      this.reheat(0.3);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  resetView() {
    this.view = { x: 0, y: 0, k: 1 };
    this._applyView();
    this.reheat(0.6);
  }
}

function el(name, attrs = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}
