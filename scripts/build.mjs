// Сборка единого офлайн-файла dist/index.html:
// берёт разметку из src/index.html и встраивает CSS, JS-модули и данные графа
// в один HTML (открывается двойным кликом, работает без сервера).
// Запуск: node scripts/build.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const url = (p) => fileURLToPath(new URL(p, import.meta.url));

const [html, css, graphJs, appJs, data] = await Promise.all([
  readFile(url('../src/index.html'), 'utf8'),
  readFile(url('../src/styles.css'), 'utf8'),
  readFile(url('../src/graph.js'), 'utf8'),
  readFile(url('../src/app.js'), 'utf8'),
  readFile(url('../data/knowledge-graph.json'), 'utf8'),
]);

// Склеиваем модули в один <script>: убираем import/export и хвост с fetch.
const graphMod = graphJs.replace(/^export\s+/gm, '');
const appMod = appJs
  .replace(/^import\s+.*$/gm, '')
  .replace(/^loadData\(\)[\s\S]*$/m, '');
const bundle = `${graphMod}\n${appMod}\nrender(window.__GRAPH_DATA__);`;

const out = html
  .replace('<link rel="stylesheet" href="styles.css">', `<style>\n${css}\n</style>`)
  .replace(
    '<script type="module" src="app.js"></script>',
    `<script>window.__GRAPH_DATA__ = ${data};</script>\n  <script type="module">\n${bundle}\n</script>`
  );

await mkdir(url('../dist'), { recursive: true });
await writeFile(url('../dist/index.html'), out);
console.log('✓ Собрано: dist/index.html (единый офлайн-файл)');
