// ============================================================
// Демо дневника: новый месяц
// ============================================================
//
// Витрина «Погостить у Есении» (DEMO) должна выглядеть живой: отчёты
// «этого месяца» и календари считают записи по дате, и если записи
// остались в прошлом месяце, посетитель видит пустоту — «Нет записи
// за сегодня», «Добавьте больше записей».
//
// Раньше автор каждого первого числа переносила записи руками. Этот
// скрипт делает то же самое: берёт записи прошлого месяца и переставляет
// их в текущий, **число оставляет**. «Ревность» с 15 сентября уезжает
// на 15 октября. Если в новом месяце такого числа нет (31-е в месяце
// из 30 дней), запись встаёт на последний день.
//
// Старые месяцы (история) не трогаются. Повторный запуск ничего не
// ломает: записей прошлого месяца к тому моменту уже нет, переносить
// нечего.
//
// Запускается GitHub Action `.github/workflows/demo.yml` первого числа
// каждого месяца и по кнопке «Run workflow».
//
// Руками:
//   NOTION_DEMO_TOKEN=… node tools/demo-novyy-mesyats.mjs
//   … --proverka            — только показать, что уедет, ничего не менять
//   … --mesyats=2026-10     — считать «текущим» указанный месяц
//
// Ключ — от отдельной интеграции Notion, подключённой только к DEMO.
// Он лежит в секретах репозитория, в коде его нет.

const TOKEN = process.env.NOTION_DEMO_TOKEN;
const DIARY = '34e1931f-5c2f-81fb-a9ae-000b4e757b46'; // «Дневник настроения» в DEMO — источник данных
const API = 'https://api.notion.com/v1';
const VERSION = '2026-03-11';

const DRY = process.argv.includes('--proverka');
const FORCED = (process.argv.find(a => a.startsWith('--mesyats=')) || '').split('=')[1];

if (!TOKEN) {
    console.error('Нет ключа: переменная NOTION_DEMO_TOKEN пуста. В GitHub — Settings → Secrets → Actions.');
    process.exit(1);
}

// Notion иногда отвечает 429 (слишком часто) или 5xx — это не повод
// бросать перенос на полпути, пробуем ещё раз.
async function notion(method, path, body) {
    for (let attempt = 1; ; attempt++) {
        const res = await fetch(API + path, {
            method,
            headers: { Authorization: `Bearer ${TOKEN}`, 'Notion-Version': VERSION, 'Content-Type': 'application/json' },
            body: body ? JSON.stringify(body) : undefined,
        });
        if (res.ok) return res.json();
        const text = await res.text();
        if ((res.status === 429 || res.status >= 500) && attempt < 3) {
            console.log(`Notion ответил ${res.status}, повтор через 3 с`);
            await new Promise(r => setTimeout(r, 3000));
            continue;
        }
        throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
    }
}

// --- какой месяц «текущий» -----------------------------------------------

// Считаем по Москве: GitHub живёт по UTC, и в полночь первого числа
// по Гринвичу в Москве уже три часа ночи того же первого — совпадает,
// но пусть это будет явно, а не случайно.
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Moscow' }).format(new Date());
const [ty, tm] = (FORCED || today.slice(0, 7)).split('-').map(Number);
const [py, pm] = tm === 1 ? [ty - 1, 12] : [ty, tm - 1];
const ym = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
const target = ym(ty, tm), prev = ym(py, pm);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

// «2026-09-15» или «2026-09-15T09:30:00.000+03:00» → то же число в новом месяце
function move(iso) {
    if (!iso || !iso.startsWith(prev)) return iso;
    const day = Math.min(Number(iso.slice(8, 10)), daysIn(ty, tm));
    return `${target}-${String(day).padStart(2, '0')}${iso.slice(10)}`;
}
const human = iso => `${iso.slice(8, 10)}.${iso.slice(5, 7)}`;

// --- перенос ---------------------------------------------------------------

const schema = await notion('GET', `/data_sources/${DIARY}`);
const dateProps = Object.entries(schema.properties).filter(([, p]) => p.type === 'date').map(([name]) => name);
if (dateProps.length !== 1) {
    // Если в дневнике появится второе поле с датой, молча выбирать одно
    // из них нельзя — пусть человек посмотрит.
    throw new Error(`Ожидалось одно поле с датой, нашлось ${dateProps.length}: ${dateProps.join(', ') || '—'}`);
}
const DATE = dateProps[0];

const rows = [];
for (let cursor; ;) {
    const page = await notion('POST', `/data_sources/${DIARY}/query`, {
        page_size: 100,
        start_cursor: cursor,
        // Два условия в одном `date` Notion не складывает — берёт одно
        // и отдаёт лишнее. Поэтому явное «и».
        filter: { and: [
            { property: DATE, date: { on_or_after: `${prev}-01` } },
            { property: DATE, date: { before: `${target}-01` } },
        ] },
    });
    rows.push(...page.results);
    if (!page.has_more) break;
    cursor = page.next_cursor;
}
// И ещё раз своими глазами: переносим только то, что точно в прошлом месяце.
rows.splice(0, rows.length, ...rows.filter(r => r.properties[DATE].date?.start?.startsWith(prev)));

console.log(`${DRY ? 'Проверка, ничего не меняю. ' : ''}Переношу записи ${prev} → ${target}: ${rows.length} шт.`);
if (!rows.length) {
    console.log('Переносить нечего — записи прошлого месяца уже переехали или их нет.');
    process.exit(0);
}

let failed = 0;
for (const row of rows) {
    const title = Object.values(row.properties).find(p => p.type === 'title')?.title.map(t => t.plain_text).join('') || '(без названия)';
    const date = row.properties[DATE].date;
    const next = { ...date, start: move(date.start), end: date.end ? move(date.end) : null };
    const line = `  ${title.slice(0, 50)}: ${human(date.start)} → ${human(next.start)}`;
    if (DRY) { console.log(line); continue; }
    try {
        await notion('PATCH', `/pages/${row.id}`, { properties: { [DATE]: { date: next } } });
        console.log(line);
    } catch (err) {
        failed++;
        console.error(`${line} — НЕ ВЫШЛО: ${err.message}`);
    }
}

// Упавший перенос должен быть виден: GitHub пришлёт письмо, как
// с упавшей сборкой блога. Уже перенесённые записи останутся на новом
// месте, повторный запуск доделает остальные.
if (failed) {
    console.error(`Не перенеслось: ${failed} из ${rows.length}. Запустите ещё раз — перенесённые не тронутся.`);
    process.exit(1);
}
