// Сообщает Яндексу о страницах блога, которые изменились в последнем коммите.
//
// Протокол IndexNow: сайт сам говорит поисковику «вот этот адрес обновился»,
// и робот приходит за ним, не дожидаясь, пока сам заметит его в карте сайта.
// Яндекс пересылает такие уведомления и другим поисковикам протокола (Bing и
// прочим). Google протокол не поддерживает — туда только через Search Console.
//
// Уходят только адреса страниц. Ничего о посетителях.
//
// Запускается из .github/workflows/blog.yml после git push. Страницу надо
// отдать роботу уже новой, а GitHub Pages выкладывает её с задержкой в
// минуту-две, поэтому сначала ждём, пока сайт начнёт отдавать то же, что
// лежит в репозитории.
//
// Отказ здесь ничего не ломает: страницы уже на сайте, а Яндекс найдёт их
// сам по карте блога, просто позже. Поэтому скрипт всегда выходит без ошибки.

import { readFileSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const SITE = 'https://emotional-harbor.ru';
const HOST = 'emotional-harbor.ru';
// Ключ не секретный: протокол требует, чтобы он лежал на сайте открыто,
// в файле с тем же именем. Так поисковик убеждается, что пишет владелец.
const KEY = '67859a5d62632357d65f29dc75e34677';
const ENDPOINT = 'https://yandex.com/indexnow';

const WAIT_TOTAL_MS = 10 * 60 * 1000;
const WAIT_STEP_MS = 20 * 1000;

const sha = (buf) => createHash('sha1').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Файлы, которые поменял последний коммит: страницы постов и витрина блога.
// Удалённые посты тоже сообщаем — робот увидит 404 и уберёт страницу из поиска.
const changed = execSync('git diff --name-only HEAD~1 HEAD -- blog.html "blog/*.html"', { encoding: 'utf8' })
    .split('\n').map((s) => s.trim()).filter(Boolean);

if (!changed.length) {
    console.log('IndexNow: страниц блога в коммите нет, сообщать нечего.');
    process.exit(0);
}

const urlOf = (file) => `${SITE}/${file}`;

// Ждём, пока сайт отдаст новую версию хотя бы одной существующей страницы.
// Все файлы коммита выкладываются разом, поэтому одной проверки достаточно.
async function waitForDeploy() {
    const probe = changed.find((f) => existsSync(f));
    if (!probe) return true;
    const want = sha(readFileSync(probe));
    const deadline = Date.now() + WAIT_TOTAL_MS;
    while (Date.now() < deadline) {
        try {
            const res = await fetch(urlOf(probe) + '?v=' + Date.now(), { cache: 'no-store' });
            if (res.ok && sha(Buffer.from(await res.arrayBuffer())) === want) return true;
        } catch { /* сеть моргнула — попробуем на следующем шаге */ }
        await sleep(WAIT_STEP_MS);
    }
    return false;
}

try {
    const live = await waitForDeploy();
    if (!live) console.log('IndexNow: сайт за 10 минут не отдал новую версию — сообщаю всё равно.');

    const urlList = changed.map(urlOf);
    const res = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ host: HOST, key: KEY, keyLocation: `${SITE}/${KEY}.txt`, urlList }),
    });
    // 200 и 202 — принято. Любой другой ответ пишем как есть: лог не должен
    // говорить «отправлено», если не отправлено (урок Телеграма).
    if (res.status === 200 || res.status === 202) {
        console.log(`IndexNow: Яндекс принял ${urlList.length} адрес(а), ответ ${res.status}:\n  ${urlList.join('\n  ')}`);
    } else {
        console.log(`IndexNow: Яндекс ответил ${res.status} — ${(await res.text()).slice(0, 300)}`);
    }
} catch (err) {
    console.log('IndexNow: не удалось сообщить —', err.message);
}
