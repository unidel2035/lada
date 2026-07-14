// Сборка единого офлайн-файла dist/index.html:
// встраивает CSS, JS-модули и данные графа в один HTML (открывается двойным кликом).
// Запуск: node scripts/build.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const url = (p) => fileURLToPath(new URL(p, import.meta.url));

const [css, graphJs, appJs, data] = await Promise.all([
  readFile(url('../src/styles.css'), 'utf8'),
  readFile(url('../src/graph.js'), 'utf8'),
  readFile(url('../src/app.js'), 'utf8'),
  readFile(url('../data/knowledge-graph.json'), 'utf8'),
]);

// Склеиваем модули: убираем import/export, чтобы всё жило в одном <script>.
const graphMod = graphJs.replace(/^export\s+/gm, '');
const appMod = appJs
  .replace(/^import\s+.*$/gm, '') // убираем строку импорта KnowledgeGraph
  .replace(/^loadData\(\)[\s\S]*$/m, ''); // хвост с fetch не нужен — данные встроены

const bundle = `
${graphMod}
${appMod}
render(window.__GRAPH_DATA__);
`;

const html = `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Граф знаний культуролога</title>
  <style>${css}</style>
</head>
<body>
  <header>
    <h1 id="app-title">Граф знаний</h1>
    <p id="app-subtitle"></p>
    <p id="app-program"></p>
  </header>
  <aside class="sidebar">
    <h4>Поиск</h4>
    <input id="search" type="search" placeholder="Автор или название…" autocomplete="off">
    <h4>Прогресс</h4><div id="stats"></div>
    <h4>Статус чтения</h4><div id="filter-status"></div>
    <h4>Дисциплины / курсы</h4><div id="filter-discipline"></div>
    <button class="btn" id="reset-view">Сбросить вид</button>
  </aside>
  <main class="graph-wrap"><svg id="graph"></svg></main>
  <aside class="detail" id="detail">
    <div class="detail__empty">
      <p>Выберите книгу в графе, чтобы увидеть автора, статус чтения, заметку и связи.</p>
      <p class="muted">Наведите курсор на узел — подсветятся соседи. Тяните узлы, зум колесом, панорама фоном.</p>
    </div>
  </aside>
  <script>window.__GRAPH_DATA__ = ${data};</script>
  <script type="module">${bundle}</script>
</body>
</html>
`;

await mkdir(url('../dist'), { recursive: true });
await writeFile(url('../dist/index.html'), html);
console.log('✓ Собрано: dist/index.html (единый офлайн-файл)');
