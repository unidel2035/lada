// Служебный скрипт: вливает поле `idea` в книги knowledge-graph.json.
// Идеи берутся из JSON-файлов вида {id, idea}[], путь к папке — аргумент.
// Запуск: node scripts/merge-ideas.mjs <папка-с-ideas-*.json>
import { readFile, writeFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const dir = process.argv[2];
if (!dir) { console.error('Укажите папку с ideas-*.json'); process.exit(1); }

const dataPath = fileURLToPath(new URL('../data/knowledge-graph.json', import.meta.url));
const data = JSON.parse(await readFile(dataPath, 'utf8'));
const byId = new Map([...data.books, ...(data.philosophers || [])].map((n) => [n.id, n]));

const files = (await readdir(dir)).filter((f) => f.startsWith('ideas-') && f.endsWith('.json'));
let applied = 0;
const missing = [];

for (const f of files) {
  const arr = JSON.parse(await readFile(join(dir, f), 'utf8'));
  for (const { id, idea } of arr) {
    const book = byId.get(id);
    if (!book) { missing.push(id); continue; }
    if (idea && idea.trim()) { book.idea = idea.trim(); applied++; }
  }
}

const without = [...data.books, ...(data.philosophers || [])].filter((b) => !b.idea).map((b) => b.id);
await writeFile(dataPath, JSON.stringify(data, null, 2) + '\n');

console.log(`Влито идей: ${applied}`);
if (missing.length) console.log('Неизвестные id из файлов идей:', missing);
if (without.length) console.log('Книги БЕЗ идеи (' + without.length + '):', without.join(', '));
else console.log('✓ У всех книг есть развёрнутая идея.');
