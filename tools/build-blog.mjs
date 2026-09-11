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
    let heading = 0;
    let leadUsed = false;

    const block = (raw) => {
        const lines = raw.split('\n').map((line) => line.trim()).filter(Boolean);
        const inline = (s) => inlineMarkup(esc(s));

        // Подзаголовок части — по нему же строится оглавление
        if (raw.startsWith('## ')) {
            return `<h2 id="chast-${++heading}">${inline(raw.slice(3).trim())}</h2>`;
        }

        // Подзаголовок внутри части
        if (raw.startsWith('### ')) {
            return `<h3>${inline(raw.slice(4).trim())}</h3>`;
        }

        // Картинка: ![подпись](адрес). Подпись обязательна — она и
        // описание для незрячих, и текст под изображением.
        const picture = raw.match(/^!\[([^\]]*)\]\((\/[^\s)]*|https?:\/\/[^\s)]+)\)$/);
        if (picture) {
            const caption = esc(picture[1].trim());
            return `<figure class="shot">
                <img src="${picture[2]}" alt="${caption}" loading="lazy" decoding="async">${caption ? `
                <figcaption>${caption}</figcaption>` : ''}
            </figure>`;
        }

        // Цитата: каждая строка начинается с «> »
        if (lines.every((line) => line.startsWith('>'))) {
            const quote = lines.map((line) => inline(line.replace(/^>\s?/, ''))).join('<br>');
            return `<blockquote>${quote}</blockquote>`;
        }

        // Список с точками: «- пункт»
        if (lines.every((line) => line.startsWith('- '))) {
            const items = lines.map((line) => `<li>${inline(line.slice(2).trim())}</li>`).join('\n                ');
            return `<ul>\n                ${items}\n            </ul>`;
        }

        // Список с номерами: «1. пункт». Номера рисует браузер, поэтому
        // в тексте можно писать хоть все единицы — порядок не собьётся.
        if (lines.every((line) => /^\d+[.)]\s/.test(line))) {
            const items = lines
                .map((line) => `<li>${inline(line.replace(/^\d+[.)]\s+/, ''))}</li>`)
                .join('\n                ');
            return `<ol>\n                ${items}\n            </ol>`;
        }

        // Обычный абзац. Самый первый становится лидом — вводным,
        // который человек читает, решая, стоит ли читать дальше.
        const cls = leadUsed ? '' : ' class="lead"';
        leadUsed = true;

        return `<p${cls}>${inline(raw).replace(/\n/g, '<br>')}</p>`;
    };

    return String(text)
        .replace(/\r\n/g, '\n')
        .split(/\n{2,}/)
        .map((p) => p.trim())
        .filter(Boolean)
        .map(block)
        .join('\n            ');
}

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня',
    'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

function humanDate(iso) {
    const d = new Date(iso);
    return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

// Время чтения. 180 слов в минуту — средний темп для русского текста
// (обычно называют 170–200). Меньше минуты не показываем: «0 мин» звучит
// как насмешка над человеком, который всё-таки читает.
function readingMinutes(text) {
    const words = String(text).trim().split(/\s+/).filter(Boolean).length;
    return Math.max(1, Math.round(words / 180));
}

// Жирный текст: **вот так**. Вызывается уже ПОСЛЕ экранирования, поэтому
// внутрь тегов не может попасть ничего постороннего из текста поста.
const bold = (html) => html.replace(/\*\*(\S(?:[\s\S]*?\S)?)\*\*/g, '<strong>$1</strong>');

// Ссылка: [текст](адрес). Тоже после экранирования.
// Пропускаем только http(s) и адреса от корня сайта — на случай, если
// в текст когда-нибудь попадёт что-то вроде javascript:.
const link = (html) => html.replace(
    /\[([^\]]+)\]\((\/[^\s)]*|https?:\/\/[^\s)]+)\)/g,
    (whole, label, href) => `<a href="${href}">${label}</a>`,
);

// Курсив: *вот так*. Идёт строго ПОСЛЕ жирного — к этому моменту все
// двойные звёздочки уже превращены в теги, и одиночные ни с чем не спорят.
const italic = (html) => html.replace(/(?<!\*)\*(\S(?:[^*]*\S)?)\*(?!\*)/g, '<em>$1</em>');

// Разметка внутри строки: ссылки, жирный, курсив —
// порядок важен, каждый следующий работает по результату предыдущего.
const inlineMarkup = (html) => italic(bold(link(html)));

// Подзаголовки нужны дважды: разметить текст и собрать из них оглавление.
// Адрес якоря — просто номер по порядку: русские буквы в адресе браузер
// показывает как %D0%BF%D1%80…, читать такое невозможно.
function collectHeadings(text) {
    return String(text)
        .replace(/\r\n/g, '\n')
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('## '))
        .map((line, i) => ({ id: `chast-${i + 1}`, title: line.slice(3).trim() }));
}

// Картинки поста — для карты сайта. Поисковик индексирует их отдельно,
// и подпись идёт туда же: по ней картинку находят в поиске по картинкам.
function collectImages(text) {
    return [...String(text).matchAll(/!\[([^\]]*)\]\((\/[^\s)]*|https?:\/\/[^\s)]+)\)/g)]
        .map((m) => ({ caption: m[1].trim(), url: m[2] }));
}

// Тизер для карточки. Функция в облаке кладёт свой, но режет ровно по счёту
// символов и рвёт слово пополам, поэтому считаем заново здесь: обрезаем по
// последнему пробелу и снимаем хвостовую пунктуацию, чтобы не вышло «слова ,…».
function makeExcerpt(text, limit = 180) {
    const clean = String(text)
        .split(/\n/)
        .filter((line) => !line.trim().startsWith('## '))
        .join(' ')
        .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replace(/\*\*/g, '')
        .replace(/(?<!\*)\*(\S(?:[^*]*\S)?)\*(?!\*)/g, '$1')
        .replace(/\s+/g, ' ')
        .trim();

    if (clean.length <= limit) return clean;

    const cut = clean.slice(0, limit);
    const lastSpace = cut.lastIndexOf(' ');

    return `${cut.slice(0, lastSpace > 0 ? lastSpace : limit).replace(/[\s,.;:!?—–-]+$/, '')}…`;
}

// Описание может быть написано автором, а может лежать с прежних времён
// вместе с разметкой внутри. Чистим в любом случае — makeExcerpt как раз
// умеет выкидывать картинки, ссылки и звёздочки.
const cleanExcerpt = (post) => post.excerpt
    ? makeExcerpt(post.excerpt, 260)
    : makeExcerpt(post.text);

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

const siteHead = (withSection) => `        <header class="site-head">
            <a class="site-logo" href="${SITE}/">Эмоциональная <em>Гавань</em></a>${withSection ? `
            <a class="site-section" href="${SITE}/blog.html">Про <em>чувства</em></a>` : ''}
        </header>`;

const sticky = (withSection) => `<header class="sticky" id="sticky">
    <a class="sticky__brand" href="${SITE}/">Эмоциональная <em>Гавань</em></a>${withSection ? `
    <a class="sticky__link" href="${SITE}/blog.html">Про <em>чувства</em></a>` : ''}
</header>

<script>
(function () {
    var bar = document.getElementById('sticky');
    var last = window.scrollY;

    window.addEventListener('scroll', function () {
        var now = window.scrollY;

        if (now <= 0) bar.classList.remove('visible');
        else if (now < last) bar.classList.add('visible');
        else if (now > last && now > 100) bar.classList.remove('visible');

        last = now;
    }, { passive: true });
})();
</script>`;

const FOOTER = `    <footer class="footer">
      <div class="footer__card">
        <div class="footer__grid">
            <div class="footer__col">
                <div class="footer__copy">© ${new Date().getFullYear()} Эмоциональная Гавань</div>
            </div>

            <div class="footer__col">
                <div class="footer__heading">Разделы</div>
                <ul class="footer__nav">
                    <li><a href="${SITE}/">Главная страница</a></li>
                    <li><a href="${SITE}/blog.html">Про чувства</a></li>
                    <li><a href="${SITE}/Privacy.html">Политика конфиденциальности</a></li>
                </ul>
            </div>

            <div class="footer__col">
                <div class="footer__heading">Связаться с автором</div>
                <div class="footer__contacts">
                    <a href="https://t.me/e_lena_patrikeeva" class="footer__contact">
                        <svg class="footer__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="12" cy="12" r="12" fill="currentColor"/>
                            <path d="M5.5 11.8L18 7l-2.5 11-3.8-3.2-1.8 1.7V14l5.5-5.2-6.8 4.2L5.5 11.8z" fill="#fff8eb"/>
                        </svg>
                        @e_lena_patrikeeva
                    </a>
                    <a href="mailto:emotional.harbor@gmail.com" class="footer__contact">
                        <svg class="footer__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <rect x="2" y="4" width="20" height="16" rx="3" fill="currentColor"/>
                            <path d="M3.5 6.5L12 12.8l8.5-6.3" stroke="#fff8eb" stroke-width="1.6" fill="none" stroke-linejoin="round"/>
                        </svg>
                        emotional.harbor@gmail.com
                    </a>
                </div>
            </div>
        </div>

      </div>

      <div class="footer__bottom">
            <div class="footer__care">Бережно к себе</div>
            <button type="button" class="footer__top-btn" id="toTop">
                Наверх
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M12 19V5M5 12l7-7 7 7"/>
                </svg>
            </button>
      </div>
    </footer>

<script>
(function () {
    var up = document.getElementById('toTop');
    if (up) up.addEventListener('click', function () {
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });
})();
<\/script>`;

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

        /* --- липкая шапка --- */

        .sticky {
            position: fixed;
            top: 0; left: 0; right: 0;
            z-index: 100;
            height: 64px;
            padding: 0 28px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            background: rgba(247, 239, 224, 0.88);
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
            border-bottom: 1px solid rgba(201, 169, 122, 0.3);
            transform: translateY(-100%);
            transition: transform 0.35s cubic-bezier(0.22, 1, 0.36, 1);
        }

        .sticky.visible { transform: translateY(0); }

        .sticky__brand, .sticky__link {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 15px;
            letter-spacing: -0.3px;
            color: var(--brown-dark);
            text-decoration: none;
            white-space: nowrap;
        }

        .sticky__link { font-size: 13px; }
        .sticky__brand em, .sticky__link em { font-style: normal; color: var(--pink); }

        @media (max-width: 560px) {
            .sticky { padding: 0 16px; height: 56px; }
            .sticky__brand { font-size: 13px; }
            .sticky__link { font-size: 11px; }
        }

        /* --- шапка сайта --- */

        .site-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 16px;
            padding: 28px 0 0;
        }

        .site-logo {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 15px;
            color: var(--brown-dark);
            text-decoration: none;
        }

        .site-logo em { font-style: normal; color: var(--pink); }

        /* Тот же приём, что у имени Гавани: первое слово тёмное, второе розовое */
        .site-section {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 15px;
            letter-spacing: 0.3px;
            color: var(--brown-dark);
            text-decoration: none;
        }

        .site-section em { font-style: normal; color: var(--pink); }

        .site-nav {
            display: flex;
            gap: 22px;
            flex-wrap: wrap;
            font-size: 14px;
        }

        .site-nav a {
            color: var(--brown-light);
            text-decoration: none;
            transition: color .2s ease;
        }

        .site-nav a:hover { color: var(--pink); }

        /* --- хлебные крошки --- */

        .crumbs {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            padding-top: 34px;
            font-size: 13px;
            color: var(--brown-light);
        }

        .crumbs a { color: var(--brown-light); text-decoration: none; }
        .crumbs a:hover { color: var(--pink); }
        .crumbs .sep { color: var(--gold); }

        /* --- читайте также --- */

        .also { margin-top: 56px; }

        .also__title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 11px;
            letter-spacing: 1.4px;
            text-transform: uppercase;
            color: var(--brown-light);
            margin-bottom: 20px;
        }

        .also__grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(210px, 1fr));
            gap: 18px;
        }

        .also__card {
            position: relative;
            display: block;
            overflow: hidden;
            padding: 24px 22px 22px;
            background: rgba(255, 248, 235, 0.75);
            border: 2px solid var(--ink);
            border-radius: 18px;
            box-shadow: 4px 5px 0 rgba(45, 52, 54, 0.1);
            text-decoration: none;
            color: inherit;
            transition: transform .25s ease, box-shadow .25s ease;
        }

        .also__card::after {
            content: '';
            position: absolute;
            top: 0; left: 0; right: 0;
            height: 5px;
        }

        .tone--pink::after { background: var(--pink-soft); }
        .tone--yellow::after { background: var(--yellow); }
        .tone--green::after { background: var(--green); }
        .tone--blue::after { background: var(--blue); }
        .tone--purple::after { background: var(--purple); }

        .also__card:hover {
            transform: translate(-2px, -3px);
            box-shadow: 7px 8px 0 rgba(45, 52, 54, 0.12);
        }

        .also__meta {
            font-family: 'Caveat', cursive;
            font-size: 17px;
            line-height: 1;
            color: var(--brown-light);
            margin-bottom: 10px;
        }

        .also__name {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 14px;
            line-height: 1.3;
            letter-spacing: -0.2px;
            margin-bottom: 8px;
        }

        .also__text {
            font-size: 13px;
            line-height: 1.6;
            color: var(--brown-mid);
        }

        /* --- соседние записи --- */

        .neighbours {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
            gap: 20px;
            margin-top: 48px;
        }

        .neighbours a {
            display: block;
            padding: 22px 26px;
            border: 1.5px dashed rgba(201, 169, 122, 0.6);
            border-radius: 16px;
            background: rgba(255, 248, 235, 0.4);
            text-decoration: none;
            color: inherit;
            transition: background .2s ease, transform .2s ease;
        }

        .neighbours a:hover { background: rgba(255, 248, 235, 0.85); transform: translateY(-2px); }

        .neighbours .next { text-align: right; }

        .neighbours__dir {
            font-family: 'Caveat', cursive;
            font-weight: 600;
            font-size: 19px;
            line-height: 1;
            color: var(--brown-light);
            margin-bottom: 8px;
        }

        .neighbours__title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 14px;
            line-height: 1.35;
            color: var(--brown-dark);
        }

        @media (max-width: 560px) {
            .neighbours { grid-template-columns: 1fr; }
            .neighbours .next { text-align: left; }
        }

        .page-head { padding: 48px 0 8px; }

        .page-title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 900;
            font-size: clamp(42px, 6.8vw, 72px);
            line-height: 0.92;
            letter-spacing: -3px;
        }

        /* Оба слова одинаковые, разница только в цвете */
        .page-title span {
            display: block;
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
            overflow: hidden;
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
            top: 24px;
            right: 24px;
            width: 74px;
            height: 74px;
            border: 2.5px solid var(--ink);
            border-radius: 50%;
            transform: rotate(-7deg);
            box-shadow: 3px 4px 0 rgba(45, 52, 54, 0.14);
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            line-height: 1;
            color: var(--ink);
        }

        .seal__num {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 13px;
        }

        /* Подпись лёгкая: она поясняет цифру, а не спорит с ней */
        .seal__unit {
            font-family: 'Jost', sans-serif;
            font-weight: 300;
            font-size: 8px;
            letter-spacing: 0.2px;
            margin-top: 4px;
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

        /* Картинка поста на карточке: полосой во всю ширину, чтобы
           список оставался списком, а не галереей */
        .card__shot {
            display: block;
            width: calc(100% + 148px);
            margin: -32px -110px 22px -38px;
            height: 190px;
            object-fit: cover;
            border-bottom: 2px solid var(--ink);
        }

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

        /* --- оглавление --- */

        .contents {
            margin: 48px 0 0;
            background: rgba(255, 248, 235, 0.65);
            border: 1.5px dashed var(--gold);
            border-radius: 20px;
            padding: 32px 36px;
            box-shadow: 3px 4px 0 rgba(120, 80, 40, 0.04);
        }

        .contents__title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 12px;
            letter-spacing: 1.5px;
            text-transform: uppercase;
            color: var(--brown-light);
            margin-bottom: 18px;
        }

        .contents__list {
            list-style: none;
            counter-reset: chast;
        }

        .contents__list li {
            counter-increment: chast;
            position: relative;
            padding-left: 34px;
            margin-bottom: 10px;
        }

        .contents__list li::before {
            content: counter(chast, decimal-leading-zero);
            position: absolute;
            left: 0;
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 12px;
            color: var(--gold);
        }

        .contents__list a {
            color: var(--brown-mid);
            text-decoration: none;
            font-size: 15px;
            transition: color .2s ease;
        }

        .contents__list a:hover { color: var(--pink); }

        /* Чтобы заголовок части не прятался под верхний край окна при переходе */
        .post-body h2 { scroll-margin-top: 24px; }

        .post-body { margin-top: 34px; }
        .post-body p { margin-bottom: 22px; }

        /* Основной текст лёгкий (Jost 300), поэтому выделение берём
           умеренное: 700 рядом с ним выглядит как крик. */
        .post-body strong { font-weight: 500; color: var(--brown-dark); }
        .post-body em { font-style: italic; }

        .post-body a {
            color: var(--pink);
            text-decoration: none;
            border-bottom: 1px solid rgba(232, 122, 156, 0.35);
            transition: border-color .2s ease;
        }

        .post-body a:hover { border-bottom-color: var(--pink); }

        /* Лид — первый абзац. Отдельной пометки в тексте не требует. */
        .post-body .lead {
            font-family: 'Lora', serif;
            font-style: italic;
            font-weight: 500;
            font-size: 19px;
            line-height: 1.65;
            color: var(--brown-mid);
            padding-left: 20px;
            border-left: 3px solid var(--gold);
            margin-bottom: 30px;
        }

        .post-body h3 {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 16px;
            letter-spacing: -0.2px;
            margin: 32px 0 14px;
        }

        .post-body ul, .post-body ol {
            margin: 0 0 24px 22px;
            padding-left: 6px;
        }

        .post-body li { margin-bottom: 10px; }
        .post-body li::marker { color: var(--gold); }

        .shot { margin: 36px 0; }

        .shot img {
            display: block;
            width: 100%;
            height: auto;
            border-radius: 20px;
            border: 2px solid var(--ink);
            box-shadow: 6px 7px 0 rgba(45, 52, 54, 0.12);
        }

        .shot figcaption {
            font-family: 'Caveat', cursive;
            font-size: 19px;
            line-height: 1.35;
            color: var(--brown-light);
            margin-top: 12px;
            text-align: center;
        }

        .post-body blockquote {
            font-family: 'Lora', serif;
            font-style: italic;
            font-weight: 500;
            font-size: 18px;
            line-height: 1.7;
            color: var(--brown-mid);
            margin: 32px 0;
            padding: 4px 0 4px 22px;
            border-left: 3px solid var(--pink);
        }

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
            width: 100%;
            padding: 12px 40px 56px;
            font-size: 13px;
            color: var(--brown-light);
        }

        /* Та же плашка, что у подвала лендинга: кремовая заливка,
           тонкая золотая рамка, скругление 16 */
        .footer__card {
            max-width: 864px;
            margin: 0 auto;
            background: rgba(255, 248, 235, 0.65);
            border: 1.5px solid rgba(201, 169, 122, 0.35);
            border-radius: 16px;
            padding: 32px 40px 28px;
        }

        /* Те же доли, что и в плашке: строка и кнопка встают под своими
           колонками, а не просто по краям */
        .footer__bottom {
            position: relative;
            max-width: 864px;
            margin: 18px auto 0;
            display: flex;
            justify-content: flex-end;
            align-items: center;
            min-height: 34px;
            padding: 0 4px;
        }

        /* По центру всей строки, независимо от колонок выше */
        .footer__care {
            position: absolute;
            left: 50%;
            transform: translateX(-50%);
        }

        .footer__care {
            font-size: 12.5px;
            color: var(--brown-light);
        }

        .footer__grid {
            display: grid;
            grid-template-columns: 2fr 1fr 1.3fr;
            gap: 32px;
            align-items: start;
        }

        .footer__heading {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 11px;
            letter-spacing: 1.4px;
            text-transform: uppercase;
            color: var(--brown-mid);
            margin-bottom: 14px;
        }

        .footer__nav { list-style: none; display: flex; flex-direction: column; gap: 8px; }

        .footer__nav a {
            color: var(--brown-light);
            text-decoration: none;
            transition: color .2s ease;
        }

        .footer__nav a:hover { color: var(--pink); }

        .footer__contacts { display: flex; flex-direction: column; gap: 10px; }

        /* Обе кнопки одинаковые и спокойные; розовеют только под курсором */
        /* Ширина фиксированная: по колонке они растягивались на пол-экрана */
        .footer__contact {
            display: flex;
            align-items: center;
            width: 100%;
            max-width: 100%;
            min-height: 42px;
            gap: 10px;
            padding: 9px 14px;
            border-radius: 12px;
            background: rgba(247, 239, 224, 0.65);
            border: 1px solid rgba(201, 169, 122, 0.55);
            color: var(--brown-dark);
            text-decoration: none;
            transition: background .2s ease, border-color .2s ease, color .2s ease,
                        transform .2s ease, box-shadow .2s ease;
        }

        .footer__contact:hover {
            background: #fff;
            border-color: var(--pink);
            color: var(--pink);
            transform: translateY(-2px);
            box-shadow: 2px 3px 0 rgba(45, 52, 54, 0.08);
        }

        /* Кружок иконки берёт цвет текста кнопки — поэтому розовеет вместе с ней */
        .footer__icon { width: 16px; height: 16px; flex-shrink: 0; color: inherit; }

        .footer__copy {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 11px;
            letter-spacing: 1.4px;
            text-transform: uppercase;
            color: var(--brown-mid);
            line-height: 1.5;
        }

        .footer__top-btn {
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: transparent;
            border: 1px dashed var(--gold);
            border-radius: 20px;
            padding: 6px 16px;
            font-family: 'Jost', sans-serif;
            font-weight: 300;
            font-size: 12.5px;
            color: var(--brown-mid);
            cursor: pointer;
            transition: background .2s ease, border-color .2s ease, color .2s ease;
        }

        .footer__top-btn:hover {
            background: var(--pink-soft);
            border-color: var(--pink);
            color: var(--brown-dark);
        }

        @media (max-width: 760px) {
            .footer { padding: 8px 16px 40px; }
            .footer__card { padding: 26px 22px 22px; }
            .footer__grid { grid-template-columns: 1fr; gap: 24px; }
            .footer__bottom { flex-direction: column; align-items: flex-start; gap: 12px; }
            .footer__care { position: static; transform: none; }
        }

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
            .footer { padding: 28px 20px 40px; gap: 16px; }
            .footer-contacts { justify-content: flex-start; }
            .card, .post-foot { padding: 24px 22px; }
            .card__shot { width: calc(100% + 44px); margin: -24px -22px 18px; height: 150px; }
            .cookie-bar { padding: 18px; left: 10px; right: 10px; bottom: 10px; }
            .cookie-bar__actions { flex-direction: column; }
            .cookie-bar__btn { width: 100%; }
        }
    </style>`;

function head({ title, description, url, published, modified, image }) {
    const article = published ? `
    <meta property="article:published_time" content="${published}">${modified ? `
    <meta property="article:modified_time" content="${modified}">` : ''}` : '';

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
    <meta property="og:image" content="${image || `${SITE}/preview-v2.jpg`}">
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
${posts.map((p, i) => `            <a class="card${collectImages(p.text)[0] ? ' card--shot' : ''}" href="${SITE}/${OUT_DIR}/${p.slug}.html">${collectImages(p.text)[0] ? `
                <img class="card__shot" src="${collectImages(p.text)[0].url}" alt="" loading="lazy" decoding="async">` : ''}
                <div class="seal seal--${SEAL_TONES[(posts.length - 1 - i) % SEAL_TONES.length]}" title="Время чтения">
                    <span class="seal__num">${readingMinutes(p.text)} мин</span>
                    <span class="seal__unit">время чтения</span>
                </div>
                <div class="card__date">${humanDate(p.date)}</div>
                <div class="card__title">${esc(p.title)}</div>
                <div class="card__excerpt">${esc(cleanExcerpt(p))}</div>
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
${siteHead(false)}

        <header class="page-head">
            <h1 class="page-title">Про <span>чувства</span></h1>
            <p class="page-sub">Здесь я пишу о том, что замечаю: о чувствах, которые трудно назвать, и о тихом порядке, который от этого появляется.</p>
            <div class="hand">без советов, как надо жить</div>
        </header>

        <div class="rule"></div>

        ${cards}
    </div>

${FOOTER}

${sticky(false)}

${COOKIE_BAR}

</body>
</html>
`;
}

// Оглавление показываем только с трёх частей: на двух пунктах оно
// выглядит как содержание книги из двух страниц.
function renderContents(text) {
    const headings = collectHeadings(text);
    if (headings.length < 3) return '';

    return `
            <nav class="contents" aria-label="Содержание">
                <div class="contents__title">Содержание</div>
                <ol class="contents__list">
${headings.map((h) => `                    <li><a href="#${h.id}">${esc(h.title)}</a></li>`).join('\n')}
                </ol>
            </nav>
`;
}

// Соседние записи. Посты отсортированы свежими вверх, поэтому «следующая»
// по чтению — та, что ниже по списку, то есть более ранняя.
function renderNeighbours(newer, older) {
    if (!newer && !older) return '';

    const link = (post, dir, label) => post
        ? `                <a href="${SITE}/${OUT_DIR}/${post.slug}.html" class="${dir}">
                    <div class="neighbours__dir">${label}</div>
                    <div class="neighbours__title">${esc(post.title)}</div>
                </a>`
        : '';

    return `
            <nav class="neighbours" aria-label="Соседние записи">
${link(older, 'prev', '← Предыдущая')}
${link(newer, 'next', 'Следующая →')}
            </nav>
`;
}

// «Читайте также»: до трёх других записей. Когда он есть, переходы
// «предыдущая / следующая» не рисуются: на трёх постах они показывали
// ровно те же названия, что и карточки прямо над ними.
function renderAlso(post, all) {
    const others = all.filter((p) => p.slug !== post.slug).slice(0, 3);
    if (others.length < 2) return '';

    return `
        <section class="also">
            <div class="also__title">Читайте также</div>
            <div class="also__grid">
${others.map((p, i) => `                <a class="also__card tone--${SEAL_TONES[i % SEAL_TONES.length]}" href="${SITE}/${OUT_DIR}/${p.slug}.html">
                    <div class="also__meta">${humanDate(p.date)} · ${readingMinutes(p.text)} мин</div>
                    <div class="also__name">${esc(p.title)}</div>
                    <div class="also__text">${esc(makeExcerpt(p.text, 90))}</div>
                </a>`).join('\n')}
            </div>
        </section>
`;
}

function renderPost(post, number, newer, older, all) {
    // Разметка для поисковика: что это статья, кто автор, когда вышла
    const jsonld = {
        '@context': 'https://schema.org',
        '@type': 'BlogPosting',
        headline: post.title,
        description: cleanExcerpt(post),
        datePublished: post.date,
        // Дата правки: поисковик показывает «обновлено», а не только «вышло»
        ...(post.updated_at ? { dateModified: post.updated_at } : {}),
        author: { '@type': 'Person', name: 'Патрикеева Елена Александровна' },
        publisher: { '@type': 'Organization', name: 'Эмоциональная Гавань' },
        mainEntityOfPage: `${SITE}/${OUT_DIR}/${post.slug}.html`,
        inLanguage: 'ru-RU',
    };

    return `${head({
        title: `${post.title} · Про чувства`,
        description: cleanExcerpt(post),
        url: `${SITE}/${OUT_DIR}/${post.slug}.html`,
        published: post.date,
        modified: post.updated_at,
        // Для превью берём jpeg-копию: webp Телеграм в превью не показывает
        image: ((collectImages(post.text)[0] || {}).url || '').replace(/\.webp$/, '.jpg'),
    })}

    <script type="application/ld+json">${JSON.stringify(jsonld)}</script>

    <div class="wrap">
        <nav class="crumbs" aria-label="Хлебные крошки">
            <a href="${SITE}/">Главная</a>
            <span class="sep">→</span>
            <a href="${SITE}/blog.html">Про чувства</a>
            <span class="sep">→</span>
            <span>${esc(post.title)}</span>
        </nav>

        <article>
            <div class="post-head">
                <div class="post-date">${humanDate(post.date)}</div>
                <div class="seal seal--${SEAL_TONES[(number - 1) % SEAL_TONES.length]}" title="Время чтения">
                    <span class="seal__num">${readingMinutes(post.text)} мин</span>
                    <span class="seal__unit">время чтения</span>
                </div>
            </div>
            <h1 class="post-title">${esc(post.title)}</h1>
${renderContents(post.text)}
            <div class="post-body">
            ${toParagraphs(post.text)}
            </div>
        </article>

        <div class="post-foot">
            <div class="post-foot__text">Если хочется не только читать про чувства, но и вести их — Гавань для этого и сделана.</div>
            <a class="post-foot__link" href="${SITE}/">Посмотреть Гавань</a>
        </div>
${renderAlso(post, all) || renderNeighbours(newer, older)}
    </div>

${FOOTER}

${sticky(true)}

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
        <lastmod>${isoDay(p.updated_at || p.date)}</lastmod>
        <changefreq>monthly</changefreq>
        <priority>0.6</priority>${collectImages(p.text).map((img) => `
        <image:image>
            <image:loc>${img.url}</image:loc>${img.caption ? `
            <image:title>${esc(img.caption)}</image:title>` : ''}
        </image:image>`).join('')}
    </url>`),
    ];

    return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
        xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
${urls.join('\n')}
</urlset>
`;
}

// ---------- сборка ----------

const res = await fetch(API);
if (!res.ok) throw new Error(`Блог ответил ${res.status} — сборку не делаем, старые файлы остаются на месте`);

const all = await res.json();
if (!Array.isArray(all)) throw new Error('Блог вернул не список постов');

// Черновики на сайт не идут. Страница уже опубликованного поста,
// переведённого в черновики, удаляется ниже вместе с остальным лишним.
const posts = all.filter((p) => p.status !== 'draft');

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
    queue.push(writeFile(
        join(OUT_DIR, `${post.slug}.html`),
        renderPost(post, posts.length - i, posts[i - 1], posts[i + 1], posts),
        'utf8',
    ));
});

await Promise.all(queue);

await writeFile('blog.html', renderList(posts), 'utf8');
await writeFile('sitemap-blog.xml', renderSitemap(posts), 'utf8');

console.log(`Собрано: ${posts.length} ${posts.length === 1 ? 'пост' : 'постов'}`);
