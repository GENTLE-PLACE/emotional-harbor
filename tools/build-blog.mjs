// ============================================================
// build-blog.mjs — раскладывает посты блога в настоящие HTML-файлы
// ============================================================
//
// Зачем это вообще нужно:
//   Посты хранятся в бакете и отдаются по адресу blog.emotional-harbor.ru/posts.
//   Можно было бы рисовать их прямо в браузере — но тогда поисковый робот
//   увидит пустую страницу: он часто не дожидается, пока отработают скрипты.
//   Поэтому раз в четверть часа GitHub запускает этот файл, он забирает посты
//   и пишет их в обычный HTML, который виден сразу и всем.
//
// Что получается на выходе:
//   blog.html            — витрина со списком карточек
//   blog/<slug>.html     — страница каждого поста
//   sitemap-blog.xml     — карта блога для поисковиков
//
// Запускается сам через .github/workflows/blog.yml. Руками:  node tools/build-blog.mjs

import { writeFile, mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';

const API = 'https://blog.emotional-harbor.ru/posts';
const SITE = 'https://emotional-harbor.ru';
const OUT_DIR = 'blog';

// ---------- вспомогательное ----------

// Текст от человека попадает в HTML, поэтому угловые скобки и амперсанды
// обезвреживаем: иначе случайный «<» сломает вёрстку страницы.
const esc = (s) => String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

// Пустая строка — новый абзац. Одиночный перенос — перенос внутри абзаца.
// Строка, начатая с «## », становится подзаголовком: по ним поисковику видно
// устройство статьи, а читателю — где можно перевести дух.
function toParagraphs(text) {
    return String(text)
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => p.startsWith('## ')
            ? `<h2>${esc(p.slice(3).trim())}</h2>`
            : `<p>${esc(p).replace(/\n/g, '<br>')}</p>`)
        .join('\n            ');
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function humanDate(iso) {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Тизер для карточки. Функция в облаке кладёт свой, но режет ровно по счёту
// символов и рвёт слово пополам, поэтому считаем заново здесь: обрезаем по
// последнему пробелу и снимаем хвостовую пунктуацию, чтобы не вышло «слова ,…».
function makeExcerpt(text, limit = 180) {
    const clean = String(text)
        .split(/\n/)
        .filter((line) => !line.trim().startsWith('## '))
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length <= limit) return clean;

    const cut = clean.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');

    return `${cut.slice(0, lastSpace > 0 ? lastSpace : limit).replace(/[\s,.;:!?—–-]+$/, '')}…`;
}

const SEAL_TONES = ['pink', 'yellow', 'green', 'blue', 'purple'];

const isoDay = (iso) => new Date(iso).toISOString().slice(0, 10);

// ---------- общие куски страницы ----------

// Метрика заводится только после согласия — так же, как на лендинге.
// Скрипт лишь объявляет функцию; вызывает её cookie-баннер внизу страницы.
const METRIKA = `    <script>
    (function () {
        var COUNTER = 110240785;

        window.ehGetConsent = function () {
            var m = document.cookie.match(/(?:^|;\\s*)eh_consent=([^;]*)/);
            return m ? decodeURIComponent(m[1]) : null;
        };

        window.ehLoadMetrika = function () {
            if (window.ehMetrikaLoaded) return;
            window.ehMetrikaLoaded = true;
            (function(m,e,t,r,i,k,a){
                m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
                m[i].l=1*new Date();
                for (var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}
                k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,
                a.parentNode.insertBefore(k,a)
            })(window, document,'script','https://mc.yandex.ru/metrika/tag.js?id='+COUNTER,'ym');

            ym(COUNTER, 'init', {ssr:true, webvisor:true, clickmap:true,
                referrer: document.referrer, url: location.href,
                accurateTrackBounce:true, trackLinks:true});
        };

        if (window.ehGetConsent() === 'all') window.ehLoadMetrika();
    })();
    </script>`;

const COOKIE_BAR = `<div id="cookie-bar" class="cookie-bar" role="dialog" aria-label="Файлы cookie">
    <div class="cookie-bar__title">Забота о деталях</div>
    <div class="cookie-bar__text">
        Гавань использует файлы cookie и Яндекс.Метрику.<br>
        Иногда я смотрю на путь гостей по сайту, чтобы замечать, где Вы задержались, где перечитали дважды,
        а где закрыли вкладку. Не для того, чтобы понять, кто Вы.<br>
        Если приватность Вам важнее, Яндекс.Метрику можно отключить.
        Подробности — в <a href="${SITE}/Privacy.html" target="_blank">Политике обработки персональных данных</a>.
    </div>
    <div class="cookie-bar__actions">
        <button type="button" class="cookie-bar__btn cookie-bar__btn--accept" onclick="ehSetConsent('all')">Разрешить аналитику</button>
        <button type="button" class="cookie-bar__btn cookie-bar__btn--minimal" onclick="ehSetConsent('necessary')">Пройти незаметно</button>
    </div>
</div>

<script>
(function () {
    var bar = document.getElementById('cookie-bar');

    window.ehSetConsent = function (value) {
        var d = new Date(); d.setFullYear(d.getFullYear() + 1);
        document.cookie = 'eh_consent=' + value + '; path=/; expires=' + d.toUTCString() + '; SameSite=Lax';
        bar.classList.remove('is-open');
        if (value === 'all' && typeof window.ehLoadMetrika === 'function') window.ehLoadMetrika();
    };

    if (!window.ehGetConsent()) {
        setTimeout(function () { bar.classList.add('is-open'); }, 900);
    }
})();
</script>`;

const FOOTER = `    <footer class="footer">
        <div class="footer-col">
            <img class="author-photo" src="https://static.emotional-harbor.ru/Avtor.png"
                 alt="Логотип автора Эмоциональной Гавани — Елена Патрикеева"
                 width="48" height="48" loading="lazy" decoding="async">
            <div>
                <div class="author-name">Патрикеева Елена Александровна</div>
                <div class="author-inn">ИНН 503505258709</div>
            </div>
        </div>
        <div class="footer-col footer-col--docs">
            <a href="${SITE}/Oferta.html" class="footer-link">Публичная оферта</a>
            <a href="${SITE}/Privacy.html" class="footer-link">Политика конфиденциальности</a>
            <a href="https://t.me/e_lena_patrikeeva" class="footer-link">@e_lena_patrikeeva</a>
        </div>
    </footer>`;

const CSS = `    <style>
        :root {
            --beige: #f7efe0;
            --brown-dark: #3a3228;
            --brown-mid: #7a5840;
            --brown-light: #9a7050;
            --gold: #c9a97a;
            --pink: #e87a9c;
            --pink-soft: #F8B4C0;
            --yellow: #F7D08A;
            --green: #b8e0d2;
            --blue: #A5C2F1;
            --purple: #e0c8f0;
            --ink: #2D3436;
        }

        * { margin: 0; padding: 0; box-sizing: border-box; }

        body {
            background: var(--beige);
            font-family: 'Jost', sans-serif;
            font-weight: 300;
            font-size: 15px;
            line-height: 1.85;
            color: var(--brown-dark);
            position: relative;
        }

        /* Бумага в клетку под всем содержимым — как на лендинге */
        body::before {
            content: '';
            position: fixed;
            inset: 0;
            background-image:
                linear-gradient(to right, rgba(201,169,122,0.08) 1px, transparent 1px),
                linear-gradient(to bottom, rgba(201,169,122,0.08) 1px, transparent 1px);
            background-size: 30px 30px;
            pointer-events: none;
            z-index: 0;
        }

        .wrap {
            position: relative;
            z-index: 1;
            max-width: 780px;
            margin: 0 auto;
            padding: 0 24px 72px;
        }

        .topbar {
            display: flex;
            align-items: center;
            gap: 18px;
            padding: 28px 0 0;
            font-size: 13px;
        }

        .topbar a {
            color: var(--brown-light);
            text-decoration: none;
            border-bottom: 1px solid transparent;
            transition: color .2s ease, border-color .2s ease;
        }

        .topbar a:hover { color: var(--pink); border-bottom-color: var(--pink); }

        .page-head { padding: 48px 0 8px; }

        .page-title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: clamp(34px, 5.5vw, 58px);
            line-height: 0.92;
            letter-spacing: -2px;
        }

        /* Второе слово — розовым и крупнее, как на обложках */
        .page-title span {
            display: block;
            font-weight: 900;
            font-size: clamp(42px, 6.8vw, 72px);
            letter-spacing: -3px;
            color: var(--pink);
        }

        /* Приписка от руки на полях */
        .hand {
            font-family: 'Caveat', cursive;
            font-weight: 600;
            font-size: 25px;
            line-height: 1.2;
            color: var(--pink);
            transform: rotate(-2deg);
            display: inline-block;
            margin-top: 16px;
        }

        .page-sub {
            font-family: 'Lora', serif;
            font-style: italic;
            font-weight: 500;
            font-size: 17px;
            line-height: 1.65;
            color: var(--brown-mid);
            margin-top: 18px;
            max-width: 520px;
        }

        .rule {
            height: 1px;
            background: repeating-linear-gradient(90deg, var(--gold) 0 8px, transparent 8px 16px);
            margin: 40px 0 8px;
        }

        /* --- список постов --- */

        .cards { display: flex; flex-direction: column; gap: 24px; margin-top: 32px; }

        .card {
            position: relative;
            display: block;
            text-decoration: none;
            color: inherit;
            background: rgba(255, 248, 235, 0.75);
            border: 2px solid var(--ink);
            border-radius: 20px;
            padding: 30px 90px 28px 34px;
            box-shadow: 6px 7px 0 rgba(45, 52, 54, 0.12);
            transition: transform .25s ease, box-shadow .25s ease;
        }

        /* Карточки лежат чуть вразнобой, как разложенные на столе */
        .card:nth-child(odd) { transform: rotate(-0.5deg); }
        .card:nth-child(even) { transform: rotate(0.4deg); }

        /* Бумагу приподнимают и выравнивают; тень удлиняется, а не размывается */
        .card:hover {
            transform: rotate(0deg) translate(-2px, -4px);
            box-shadow: 10px 12px 0 rgba(45, 52, 54, 0.14);
        }

        /* Круглая печать с номером записи — прямая цитата с обложек */
        .seal {
            position: absolute;
            top: 26px;
            right: 26px;
            width: 54px;
            height: 54px;
            border: 2.5px solid var(--ink);
            border-radius: 50%;
            transform: rotate(-7deg);
            box-shadow: 3px 4px 0 rgba(45, 52, 54, 0.14);
        }

        .seal::before {
            content: '';
            position: absolute;
            inset: 4px;
            border-radius: 50%;
            border: 1.5px dashed rgba(45, 52, 54, 0.3);
        }

        .seal--pink { background: var(--pink-soft); }
        .seal--yellow { background: var(--yellow); }
        .seal--green { background: var(--green); }
        .seal--blue { background: var(--blue); }
        .seal--purple { background: var(--purple); }

        .card__date {
            font-family: 'Caveat', cursive;
            font-weight: 600;
            font-size: 21px;
            line-height: 1;
            color: var(--brown-light);
        }

        .card__title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 21px;
            line-height: 1.25;
            letter-spacing: -0.6px;
            margin: 12px 0 10px;
        }

        .card__excerpt { color: var(--brown-mid); }

        .card__more {
            display: inline-block;
            margin-top: 18px;
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 10.5px;
            letter-spacing: 1.2px;
            text-transform: uppercase;
            color: var(--brown-mid);
            background: rgba(201, 169, 122, 0.2);
            border: 1px solid rgba(201, 169, 122, 0.55);
            border-radius: 30px;
            padding: 7px 16px;
        }

        .card:hover .card__more { background: var(--pink); color: #fff; border-color: var(--pink); }

        .empty {
            margin-top: 32px;
            font-family: 'Lora', serif;
            font-style: italic;
            font-size: 17px;
            color: var(--brown-mid);
        }

        /* --- страница поста --- */

        .post-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 20px;
            padding-top: 44px;
        }

        .post-head .seal { position: static; flex-shrink: 0; }

        .post-date {
            font-family: 'Caveat', cursive;
            font-weight: 600;
            font-size: 23px;
            line-height: 1;
            color: var(--brown-light);
        }

        .post-title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: clamp(28px, 4.2vw, 42px);
            line-height: 1.08;
            letter-spacing: -1.5px;
            margin: 14px 0 0;
        }

        .post-body { margin-top: 34px; }
        .post-body p { margin-bottom: 22px; }

        .post-body h2 {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 19px;
            line-height: 1.3;
            letter-spacing: -0.4px;
            margin: 40px 0 18px;
        }

        .post-foot {
            position: relative;
            margin-top: 56px;
            padding: 34px 34px 32px;
            background: rgba(255, 248, 235, 0.75);
            border: 2px solid var(--ink);
            border-radius: 20px;
            box-shadow: 6px 7px 0 rgba(45, 52, 54, 0.12);
            transform: rotate(-0.4deg);
        }

        /* Полоска скотча, которой открытку как будто прикрепили к странице */
        .post-foot::before {
            content: '';
            position: absolute;
            top: -13px;
            left: 50%;
            width: 116px;
            height: 26px;
            margin-left: -58px;
            background: rgba(247, 208, 138, 0.75);
            border: 1px solid rgba(45, 52, 54, 0.15);
            transform: rotate(-2deg);
        }

        .post-foot__text {
            font-family: 'Lora', serif;
            font-style: italic;
            font-size: 17px;
            line-height: 1.65;
            color: var(--brown-mid);
        }

        .post-foot__link {
            display: inline-block;
            margin-top: 18px;
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 12px;
            letter-spacing: 1px;
            text-transform: uppercase;
            color: #fff;
            background: var(--pink);
            border-radius: 12px;
            padding: 16px 30px;
            text-decoration: none;
            box-shadow: 4px 5px 0 rgba(58, 50, 40, 0.18);
            transition: transform .2s ease, box-shadow .2s ease;
        }

        .post-foot__link:hover {
            transform: translate(-1px, -2px);
            box-shadow: 6px 7px 0 rgba(58, 50, 40, 0.18);
        }

        /* --- подвал --- */

        .footer {
            position: relative;
            z-index: 1;
            max-width: 780px;
            margin: 0 auto;
            padding: 36px 24px 56px;
            border-top: 1px solid rgba(201, 169, 122, 0.4);
            display: flex;
            flex-wrap: wrap;
            gap: 28px;
            justify-content: space-between;
            font-size: 13px;
            color: var(--brown-light);
        }

        .footer-col { display: flex; align-items: center; gap: 12px; }
        .footer-col--docs { flex-direction: column; align-items: flex-start; gap: 6px; }
        .author-photo { border-radius: 50%; }
        .author-name { color: var(--brown-mid); }
        .footer-link { color: var(--brown-light); text-decoration: none; }
        .footer-link:hover { color: var(--pink); }

        /* --- cookie-баннер: обе кнопки рядом и равноценны --- */

        .cookie-bar {
            position: fixed; left: 16px; right: 16px; bottom: 16px;
            z-index: 9000;
            display: none;
            background: var(--beige);
            border: 2px solid var(--gold);
            border-radius: 16px;
            box-shadow: 6px 6px 0 rgba(58, 50, 40, 0.14);
            padding: 22px 26px;
            max-width: 760px; margin: 0 auto;
        }

        .cookie-bar.is-open { display: block; }

        .cookie-bar__title {
            font-family: 'Unbounded', sans-serif; font-weight: 600;
            font-size: 15px; color: var(--brown-dark); margin-bottom: 8px;
        }

        .cookie-bar__text {
            font-size: 14px; line-height: 1.75;
            color: var(--brown-mid); margin-bottom: 18px;
        }

        .cookie-bar__text a { color: var(--pink); }

        .cookie-bar__actions { display: flex; gap: 12px; flex-wrap: wrap; }

        .cookie-bar__btn {
            font-family: 'Jost', sans-serif; font-weight: 500; font-size: 14px;
            padding: 12px 22px; border-radius: 12px; cursor: pointer;
            border: 2px solid transparent;
            transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
        }

        .cookie-bar__btn--accept {
            background: var(--pink); color: #fff;
            box-shadow: 3px 3px 0 rgba(58, 50, 40, 0.18);
        }

        .cookie-bar__btn--minimal {
            background: transparent; color: var(--brown-mid); border-color: var(--gold);
        }

        @media (max-width: 560px) {
            .card, .post-foot { padding: 24px 22px; }
            .cookie-bar { padding: 18px; left: 10px; right: 10px; bottom: 10px; }
            .cookie-bar__actions { flex-direction: column; }
            .cookie-bar__btn { width: 100%; }
        }
    </style>`;

function head({ title, description, url, published }) {
    const article = published ? `
    <meta property="article:published_time" content="${published}">` : '';

    return `<!DOCTYPE html>
<html lang="ru">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${url}">
    <link rel="icon" type="image/svg+xml" href="${SITE}/favicon.svg">

    <meta property="og:type" content="${published ? 'article' : 'website'}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${SITE}/preview-v2.jpg">
    <meta property="og:locale" content="ru_RU">${article}

    <link href="https://static.emotional-harbor.ru/fonts/harbor-fonts.css" rel="stylesheet">

${METRIKA}
${CSS}
</head>
<body>`;
}

// ---------- страницы ----------

function renderList(posts) {
    const cards = posts.length
        ? `<div class="cards">
${posts.map((p, i) => `            <a class="card" href="${SITE}/${OUT_DIR}/${p.slug}.html">
                <div class="seal seal--${SEAL_TONES[(posts.length - 1 - i) % SEAL_TONES.length]}" aria-hidden="true"></div>
                <div class="card__date">${humanDate(p.date)}</div>
                <div class="card__title">${esc(p.title)}</div>
                <div class="card__excerpt">${esc(makeExcerpt(p.text))}</div>
                <span class="card__more">Читать дальше →</span>
            </a>`).join('\n')}
        </div>`
        : `<div class="empty">Здесь пока тихо. Первая запись скоро появится.</div>`;

    return `${head({
        title: 'Про чувства · Эмоциональная Гавань',
        description: 'Записи о чувствах, внимании к себе и тихом порядке внутри — от автора Эмоциональной Гавани.',
        url: `${SITE}/blog.html`,
    })}

    <div class="wrap">
        <nav class="topbar">
            <a href="${SITE}/">← Эмоциональная Гавань</a>
        </nav>

        <header class="page-head">
            <h1 class="page-title">Про<span>чувства</span></h1>
            <p class="page-sub">Здесь я пишу о том, что замечаю: о чувствах, которые трудно назвать, и о тихом порядке, который от этого появляется.</p>
            <div class="hand">без советов, как надо жить</div>
        </header>

        <div class="rule"></div>

        ${cards}
    </div>

${FOOTER}

${COOKIE_BAR}

</body>
</html>
`;
}

function renderPost(post, number) {
    // Разметка для поисковика: что это статья, кто автор, когда вышла
    const jsonld = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: makeExcerpt(post.text),
        datePublished: post.date,
        author: { '@type': 'Person', name: 'Патрикеева Елена Александровна' },
        publisher: { '@type': 'Organization', name: 'Эмоциональная Гавань' },
        mainEntityOfPage: `${SITE}/${OUT_DIR}/${post.slug}.html`,
        inLanguage: 'ru-RU',
    };

    return `${head({
        title: `${post.title} · Про чувства`,
        description: makeExcerpt(post.text),
        url: `${SITE}/${OUT_DIR}/${post.slug}.html`,
        published: post.date,
    })}

    <script type="application/ld+json">${JSON.stringify(jsonld)}</script>

    <div class="wrap">
        <nav class="topbar">
            <a href="${SITE}/blog.html">← Про чувства</a>
            <a href="${SITE}/">Эмоциональная Гавань</a>
        </nav>

        <article>
            <div class="post-head">
                <div class="post-date">${humanDate(post.date)}</div>
                <div class="seal seal--${SEAL_TONES[(number - 1) % SEAL_TONES.length]}" aria-hidden="true"></div>
            </div>
            <h1 class="post-title">${esc(post.title)}</h1>

            <div class="post-body">
            ${toParagraphs(post.text)}
            </div>
        </article>

        <div class="post-foot">
            <div class="post-foot__text">Если хочется не только читать про чувства, но и вести их — Гавань для этого и сделана.</div>
            <a class="post-foot__link" href="${SITE}/">Посмотреть Гавань</a>
        </div>
    </div>

${FOOTER}

${COOKIE_BAR}

</body>
</html>
`;
}

function renderSitemap(posts) {
    const urls = [
        `    <url>
        <loc>${SITE}/blog.html</loc>
        <changefreq>weekly</changefreq>
        <priority>0.7</priority>
    </url>`,
        ...posts.map((p) => `    <url>
        <loc>${SITE}/${OUT_DIR}/${p.slug}.html</loc>
        <lastmod>${isoDay(p.date)}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.6</priority>
    </url>`),
    ];

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.join('\n')}
</urlset>
`;
}

// ---------- сборка ----------

const res = await fetch(API);
if (!res.ok) throw new Error(`Блог ответил ${res.status} — сборку не делаем, старые файлы остаются на месте`);

const posts = await res.json();
if (!Array.isArray(posts)) throw new Error('Блог вернул не список постов');

posts.sort((a, b) => new Date(b.date) - new Date(a.date));

await mkdir(OUT_DIR, { recursive: true });

// Пост могли удалить из posts.json руками — тогда убираем и его страницу,
// иначе она осталась бы висеть в поиске навсегда.
const queue = [];

const alive = new Set(posts.map((p) => `${p.slug}.html`));
for (const file of await readdir(OUT_DIR)) {
    if (file.endsWith('.html') && !alive.has(file)) await rm(join(OUT_DIR, file));
}

posts.forEach((post, i) => {
    // Номер по хронологии: у первой записи он навсегда останется первым,
    // сколько бы постов ни вышло после неё.
    queue.push(writeFile(join(OUT_DIR, `${post.slug}.html`), renderPost(post, posts.length - i), 'utf8'));
});

await Promise.all(queue);

await writeFile('blog.html', renderList(posts), 'utf8');
await writeFile('sitemap-blog.xml', renderSitemap(posts), 'utf8');

console.log(`Собрано: ${posts.length} ${posts.length === 1 ? 'пост' : 'постов'}`);
