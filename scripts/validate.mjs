// Валидация data/knowledge-graph.json: ссылочная целостность и обязательные поля.
// Запуск: node scripts/validate.mjs
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const path = fileURLToPath(new URL('../data/knowledge-graph.json', import.meta.url));
const data = JSON.parse(await readFile(path, 'utf8'));

const errors = [];
const warn = [];

const statusIds = new Set(data.meta.statuses.map((s) => s.id));
const disciplineIds = new Set(data.disciplines.map((d) => d.id));
const themeIds = new Set(data.themes.map((t) => t.id));
const bookIds = new Set();

for (const b of data.books) {
  if (!b.id) errors.push(`Книга без id: ${b.title}`);
  if (bookIds.has(b.id)) errors.push(`Дубликат id книги: ${b.id}`);
  bookIds.add(b.id);
  if (!b.title) errors.push(`Книга без названия: ${b.id}`);
  if (!b.author) warn.push(`Книга без автора: ${b.id}`);
  if (!statusIds.has(b.status)) errors.push(`Неизвестный статус «${b.status}» у ${b.id}`);
  if (!disciplineIds.has(b.discipline)) errors.push(`Неизвестная дисциплина «${b.discipline}» у ${b.id}`);
  for (const t of b.themes || []) {
    if (!themeIds.has(t)) errors.push(`Неизвестная тема «${t}» у ${b.id}`);
  }
}

const linkTypeIds = new Set(data.meta.linkTypes.map((t) => t.id));
for (const [i, l] of data.links.entries()) {
  if (!bookIds.has(l.source)) errors.push(`Связь #${i}: неизвестный source «${l.source}»`);
  if (!bookIds.has(l.target)) errors.push(`Связь #${i}: неизвестный target «${l.target}»`);
  if (!linkTypeIds.has(l.type)) errors.push(`Связь #${i}: неизвестный тип «${l.type}»`);
  if (l.source === l.target) errors.push(`Связь #${i}: петля на ${l.source}`);
}

const stats = {};
for (const b of data.books) stats[b.status] = (stats[b.status] || 0) + 1;

console.log(`Книг: ${data.books.length} | Дисциплин: ${data.disciplines.length} | Тем: ${data.themes.length} | Связей: ${data.links.length}`);
console.log('По статусам:', stats);
if (warn.length) console.log('\nПредупреждения:\n' + warn.map((w) => '  ⚠ ' + w).join('\n'));

if (errors.length) {
  console.error('\nОшибки валидации:\n' + errors.map((e) => '  ✗ ' + e).join('\n'));
  process.exit(1);
}
console.log('\n✓ Данные валидны.');
