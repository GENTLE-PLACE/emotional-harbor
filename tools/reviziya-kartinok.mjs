// ============================================================
// Ревизия картинок блога
// ============================================================
//
// Показывает, какие файлы в бакете `emotional-harbor-blog-img` больше
// не упоминаются ни в одной записи блога. Сам ничего не удаляет —
// печатает список и готовые команды, решение остаётся за человеком.
//
// Зачем это нужно. Функция `harbor-blog` при удалении записи убирает её
// из `posts.json` и на этом останавливается: картинка остаётся в бакете
// навсегда. Удалить её функция и не может — у сервисного аккаунта роль
// `storage.uploader`, она даёт загрузку и чтение, но не удаление.
// Автоудаление сознательно не делали: оно необратимо, версионирования
// у бакета с картинками нет, а один и тот же адрес может стоять в двух
// записях сразу.
//
// Запуск:  node tools/reviziya-kartinok.mjs
//
// Работает через `yc`, который уже установлен и авторизован, поэтому
// ни паролей, ни ключей доступа здесь не требуется.

import { execFileSync } from 'node:child_process';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const IMAGE_BUCKET = 'emotional-harbor-blog-img';
const POSTS_BUCKET = 'emotional-harbor-blog';
const POSTS_KEY = 'blog/posts.json';
const IMAGE_HOST = `https://storage.yandexcloud.net/${IMAGE_BUCKET}`;

// Без оболочки: так аргументы уходят как есть, без склейки в строку,
// и путь с пробелами не требует кавычек.
const yc = (args) => execFileSync('yc', args, { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });

// --- что лежит в бакете ------------------------------------------------

function readBucket() {
    const raw = yc(['storage', 's3api', 'list-objects', '--bucket', IMAGE_BUCKET, '--format', 'json']);
    const data = JSON.parse(raw);
    const list = data.contents || data.Contents || [];

    return list.map((item) => ({
        key: item.key || item.Key,
        size: Number(item.size || item.Size || 0),
        changed: (item.last_modified || item.lastModified || '').slice(0, 10),
    }));
}

// --- что упоминают записи ----------------------------------------------

function readPosts() {
    // posts.json достаём прямо из бакета: так видны и черновики, которые
    // по адресу /posts без пароля не отдаются.
    const file = join(tmpdir(), `posts-reviziya-${Date.now()}.json`);

    try {
        // Имя файла идёт последним аргументом, без флага: в yc 1.34
        // у get-object флага --output нет.
        yc(['storage', 's3api', 'get-object', '--bucket', POSTS_BUCKET, '--key', POSTS_KEY, file]);
        return JSON.parse(readFileSync(file, 'utf8'));
    } finally {
        try { rmSync(file); } catch { /* файла может и не быть */ }
    }
}

// Картинки записи живут прямо в её тексте: ![подпись](адрес)
function keysFromText(text) {
    const host = IMAGE_HOST.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const re = new RegExp(`${host}/([^\\s)"'<]+)`, 'g');
    const keys = new Set();
    let found;

    while ((found = re.exec(String(text || '')))) keys.add(found[1]);

    return keys;
}

// --- разбор -------------------------------------------------------------

const files = readBucket();
const posts = readPosts();

const used = new Map();

for (const post of posts) {
    for (const key of keysFromText(post.text)) {
        if (!used.has(key)) used.set(key, []);
        used.get(key).push(`${post.title}${post.status === 'draft' ? ' (черновик)' : ''}`);
    }
}

// У каждой картинки две копии: webp для страницы и jpeg для соцсетей.
// В тексте стоит только первая, поэтому вторую считаем нужной заодно с ней.
function isUsed(key) {
    if (used.has(key)) return true;

    const withoutJpeg = key.replace(/\.jpg$/, '');

    return used.has(withoutJpeg) || used.has(`${withoutJpeg}.webp`);
}

const orphans = files.filter((file) => !isUsed(file.key));
const kb = (bytes) => `${Math.round(bytes / 1024)} КБ`;

console.log(`\nЗаписей в блоге: ${posts.length}`);
console.log(`Файлов в бакете: ${files.length}, вес ${kb(files.reduce((sum, f) => sum + f.size, 0))}\n`);

if (!orphans.length) {
    console.log('Ничьих картинок нет — каждый файл стоит в какой-нибудь записи.\n');
    process.exit(0);
}

console.log(`Ничьих картинок: ${orphans.length}, вес ${kb(orphans.reduce((sum, f) => sum + f.size, 0))}\n`);

for (const file of orphans) {
    console.log(`  ${file.key}`);
    console.log(`      ${kb(file.size)}, загружена ${file.changed}`);
}

console.log('\nЕсли всё перечисленное действительно лишнее — команды на удаление:\n');

for (const file of orphans) {
    console.log(`  yc storage s3api delete-object --bucket ${IMAGE_BUCKET} --key ${file.key}`);
}

// Удаление здесь необратимо: версионирования у этого бакета нет.
console.log('\nУдаление необратимо — у бакета с картинками версионирование не включено.\n');
