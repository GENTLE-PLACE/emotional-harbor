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

        // Исследование: первая строка «✦ Понятие · Авторы, год», дальше текст.
        // Тот же приём, что в путеводителях: наука стоит рядом с текстом, а не
        // внутри него, — её можно пропустить, и абзац не развалится. Задумано
        // по одной врезке на запись: со второй статья становится рефератом.
        if (raw.startsWith('✦')) {
            const [head, ...rest] = lines;
            const body = rest
                .map((line) => `<p>${inline(line)}</p>`)
                .join('\n                ');
            return `<aside class="note">
                <div class="note__title">${inline(head.replace(/^✦\s?/, ''))}</div>
                ${body}
            </aside>`;
        }

        // Практика: каждая строка начинается с «+ ». Заголовок рисуется сам,
        // набирать его не нужно. Задумано по одному блоку на запись: два таких
        // блока перестают быть особенными и становятся обычным текстом в рамке.
        if (lines.every((line) => line.startsWith('+'))) {
            const body = lines
                .map((line) => `<p>${inline(line.replace(/^\+\s?/, ''))}</p>`)
                .join('\n                ');
            return `<aside class="task">
                <div class="task__title"><span aria-hidden="true">📝</span> Практика</div>
                ${body}
            </aside>`;
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

// Автор один, поэтому блок собирается из констант, а не из данных поста.
// Иконка лежит на своём бакете: внешних запросов у страницы нет и не будет.
const AUTHOR = {
    // Полное имя и в подписи, и в разметке: у текста про чувства должен быть
    // человек с фамилией, а не голос без лица. Решено 14.09.2026.
    name: 'Елена Патрикеева',
    fullName: 'Елена Патрикеева',
    role: 'Автор Эмоциональной Гавани',
    about: 'Я не психолог. Занимаюсь йогой и пилатесом. Замечать, что происходит внутри, научилась на коврике — а Гавань сделала красивой, потому что верю, что эстетика лечит.',
    icon: 'https://static.emotional-harbor.ru/Avtor.png',
};

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

// Своя обложка блога — запасное превью для соцсетей: её видно у витрины
// и у постов без собственной картинки. Обложка лендинга сюда не годится:
// она обещает шаблон в Notion, а ссылка ведёт к тексту про чувства.
// Размеры объявляем прямо в странице: без них Телеграм считает картинку
// неизвестной и рисует маленький квадратик вместо большой карточки.
const DEFAULT_PREVIEW = {
    url: `${SITE}/preview-blog.jpg`,
    width: 1200,
    height: 630,
    alt: 'Про чувства — блог Эмоциональной Гавани',
};

// Картинка поста лежит в бакете в webp, а webp в превью не показывают
// ни Телеграм, ни часть соцсетей. Рядом с ней панель кладёт jpeg-копию:
// то же имя плюс «.jpg». Проверяем, есть ли она на самом деле, — у постов,
// вышедших до этого, копии нет, и тогда берём общую обложку.
async function previewImage(url) {
    if (!url) return '';
    if (/\.(jpe?g|png)$/i.test(url)) return url;

    const candidate = `${url.replace(/\.webp$/i, '')}.jpg`;

    try {
        const res = await fetch(candidate, {
            method: 'HEAD',
            signal: AbortSignal.timeout(5000),
        });
        return res.ok ? candidate : '';
    } catch {
        return '';
    }
}

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
                            <circle cx="12" cy="12" r="12" fill="#3a3228"/>
                            <path d="M5.5 11.8L18 7l-2.5 11-3.8-3.2-1.8 1.7V14l5.5-5.2-6.8 4.2L5.5 11.8z" fill="white"/>
                        </svg>
                        @e_lena_patrikeeva
                    </a>
                    <a href="mailto:emotional.harbor@gmail.com" class="footer__contact">
                        <svg class="footer__icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
                            <circle cx="12" cy="12" r="12" fill="#3a3228"/>
                            <path d="M5.2 8.2h13.6v7.6H5.2z" fill="white"/>
                            <path d="M5.2 8.2L12 12.8l6.8-4.6" stroke="#3a3228" stroke-width="1.3" fill="none" stroke-linejoin="round"/>
                        </svg>
                        emotional.harbor@gmail.com
                    </a>
                </div>
            </div>
        </div>

      </div>

      <div class="footer__bottom">
            <div class="footer__copy">© ${new Date().getFullYear()} Эмоциональная Гавань</div>
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

        /* Выделение — главный жест на странице записи: им забирают строчку
           открыткой. Системный синий прямоугольник на бежевой бумаге в этот
           момент выглядит чужим, поэтому красим розовым песком. */
        ::selection {
            background: rgba(248, 180, 192, 0.5);
            color: var(--brown-dark);
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

        /* Полоска чтения: меряет не страницу, а сам текст статьи —
           доходит до конца ровно на последней строке, а не после подвала.
           Цвет — светлый розовый, тот же, что полоса сверху у открытки
           с цитатой: акцентный #e87a9c означает «нажми», а здесь нажимать
           нечего. Золото на такой толщине выглядит выцветшим. */
        .reading {
            position: fixed;
            top: 0; left: 0;
            z-index: 120;
            height: 4px;
            width: 0;
            background: var(--pink-soft);
            pointer-events: none;
        }

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

        /* Заголовок витрины набран вперемешку тремя шрифтами — тот же приём,
           что на экране «Смыслы». Поджатие ослаблено до 1px: на -3px буквы
           разных гарнитур начинают наезжать друг на друга. */
        .page-title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 900;
            font-size: clamp(40px, 6.4vw, 66px);
            /* Просвет держит хвост буквицы «Ч»: она вдвое выше строки, но из
               расчёта высоты исключена (line-height: 0), поэтому место под неё
               приходится добавлять здесь. При 0.95 она упиралась в «Про». */
            line-height: 1.18;
            letter-spacing: -1px;
        }

        .pt-line { display: block; }

        /* Первая строка строгая: предлог — слово служебное, ему и положено быть
           набранным ровно. Вся игра шрифтов уходит во вторую строку. Чуть
           крупнее и плотнее, как в прежней вывеске витрины. */
        .pt-line--strict { font-size: 1.08em; letter-spacing: -3px; }
        .f-unb { font-family: 'Unbounded', sans-serif; font-weight: 900; text-transform: uppercase; }
        .f-lora { font-family: 'Lora', serif; font-weight: 700; font-style: italic; font-size: 1.05em; }
        .f-cav { font-family: 'Caveat', cursive; font-weight: 700; font-size: 1.2em; }
        .f-pink { color: var(--pink); }

        /* Высокая рукописная буквица. line-height: 0 — чтобы она не раздвигала
           строки заголовка: иначе браузер считает высоту строки по самой
           крупной букве, и «Про» отъезжает вверх. */
        .pt-init {
            font-family: 'Caveat', cursive;
            font-weight: 700;
            font-size: 2em;
            line-height: 0;
            letter-spacing: 0;
            vertical-align: -0.12em;
        }

        /* След розового маркера под вторым словом. Пропорции взяты с экрана
           «Смыслы» и пересчитаны из пикселей в доли кегля: там при 52px было
           32px высоты и вынос 5/12px — чтобы полоса не отставала от заголовка,
           который на витрине резиновый. */
        .pt-marker { position: relative; z-index: 1; width: fit-content; }
        .pt-marker::before {
            content: '';
            position: absolute;
            bottom: 0.04em;
            left: -0.1em;
            right: -0.22em;
            height: 0.62em;
            background: var(--pink-soft);
            opacity: 0.45;
            z-index: -1;
            transform: rotate(-1.5deg);
            border-radius: 4px;
        }

        /* Оба слова одинаковые, разница только в цвете */


        /* Приписка от руки на полях */
        /* Прежняя строка снята 15.09.2026: обещала отсутствие советов, а они
           в текстах есть. Стиль ждёт правдивой замены. */
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
            margin-top: 34px;
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
            font-size: 20px;
            line-height: 1;
            color: var(--brown-light);
        }

        /* Рубрика — имя комнаты Гавани. Капсула: скругление больше половины
           высоты, поэтому радиус заведомо избыточный. */
        .chip {
            display: inline-block;
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 9px;
            text-transform: uppercase;
            letter-spacing: 1px;
            color: var(--brown-mid);
            border: 1.5px solid var(--gold);
            border-radius: 999px;
            padding: 5px 12px;
            background: rgba(255, 248, 235, 0.6);
        }

        .card__cat { margin-bottom: 14px; }

        /* Есть картинка — рубрика ложится прямо на неё, слева, в пару к печати
           со временем чтения справа. Заливка становится плотной: полупрозрачный
           кремовый на фотографии растворяется и перестаёт читаться. */
        .card--shot .card__cat {
            position: absolute;
            top: 26px;
            left: 26px;
            margin: 0;
            z-index: 2;
        }

        .card--shot .card__cat .chip {
            background: var(--beige);
            border-color: var(--ink);
            color: var(--brown-dark);
            box-shadow: 2px 3px 0 rgba(45, 52, 54, 0.18);
        }
        .post-cat { line-height: 1; }

        /* Подвал карточки: «читать» слева, дата справа, над ними волосяная
           линия — она отделяет служебное от текста, а не рисует рамку */
        .card__foot {
            display: flex;
            align-items: center;
            justify-content: space-between;
            flex-wrap: wrap;
            gap: 12px;
            margin-top: 22px;
            padding-top: 16px;
            border-top: 1px solid rgba(201, 169, 122, 0.4);
        }

        .card__title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 21px;
            line-height: 1.25;
            letter-spacing: -0.6px;
            margin: 0 0 10px;
        }

        .card__excerpt { color: var(--brown-mid); }

        .card__more {
            display: inline-block;
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

        /* Сверху рубрика и печать, под ними заголовок, под заголовком дата.
           Печать прижата вправо отступом, а не space-between: у записи без
           рубрики она осталась бы в этой строке одна и уехала бы влево. */
        .post-head {
            display: flex;
            align-items: center;
            gap: 20px;
            padding-top: 44px;
        }

        .post-head .seal { margin-left: auto; }

        .post-head .seal { position: static; flex-shrink: 0; }

        .post-date {
            margin-top: 16px;
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
            margin: 18px 0 0;
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

        /* Практика — блок «+ » в тексте. Заливка, скругление и тень
           те же, что у содержания: два блока в пунктирной рамке на одной
           странице должны читаться как родственники, а не как два разных
           приёма. Свой тон у практики был холоднее и выбивался. */
        .task {
            margin: 36px 0;
            padding: 26px 28px;
            border-radius: 20px;
            background: rgba(255, 248, 235, 0.65);
            border: 1.5px dashed var(--gold);
            box-shadow: 3px 4px 0 rgba(120, 80, 40, 0.04);
        }

        .task__title {
            font-family: 'Unbounded', sans-serif;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 12px;
            display: flex;
            align-items: center;
            gap: 8px;
        }

        .task p {
            font-size: 15px;
            line-height: 1.75;
            color: var(--brown-mid);
            margin-bottom: 12px;
        }

        .task p:last-child { margin-bottom: 0; }

        /* Исследование — блок «✦». Практика зовёт что-то сделать и потому
           обведена пунктиром; врезка только сообщает, поэтому тише: заливка
           без рамки. Два блока в одном тексте не должны спорить за внимание. */
        .note {
            margin: 36px 0;
            padding: 22px 26px;
            border-radius: 16px;
            background: rgba(201, 169, 122, 0.12);
        }

        .note__title {
            font-family: 'Unbounded', sans-serif;
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 1px;
            line-height: 1.5;
            color: var(--brown-light);
            margin-bottom: 10px;
        }

        .note p {
            font-size: 15px;
            line-height: 1.75;
            color: var(--brown-mid);
            margin-bottom: 10px;
        }

        .note p:last-child { margin-bottom: 0; }

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

        /* Блок автора. Иконка круглая, как в подвале лендинга — это одна
           и та же картинка, и человек должен узнать её без объяснений. */
        .author {
            display: flex;
            align-items: flex-start;
            gap: 18px;
            margin: 48px 0 0;
            padding-top: 28px;
            border-top: 1px dashed rgba(201, 169, 122, 0.55);
        }

        .author__icon {
            width: 56px;
            height: 56px;
            border-radius: 50%;
            object-fit: cover;
            border: 1.5px solid rgba(201, 169, 122, 0.5);
            flex-shrink: 0;
        }

        .author__name {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 14px;
            letter-spacing: -0.2px;
        }

        .author__role {
            font-size: 12.5px;
            letter-spacing: 0.3px;
            color: var(--brown-light);
            margin-top: 2px;
        }

        .author__about {
            font-family: 'Lora', serif;
            font-style: italic;
            font-size: 15px;
            line-height: 1.7;
            color: var(--brown-mid);
            margin-top: 10px;
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
            justify-content: space-between;
            align-items: center;
            min-height: 34px;
            padding: 0 20px;
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
            grid-template-columns: 1fr minmax(250px, 1fr);
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
            white-space: nowrap;
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
            width: 245px;
            max-width: 100%;
            min-height: 42px;
            white-space: nowrap;
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
            font-size: 10px;
            letter-spacing: 1.1px;
            text-transform: uppercase;
            color: var(--brown-mid);
            /* Высота строки 1 — иначе под буквами остаётся пустое поле,
               и к низу прижимается коробка, а не сам текст */
            line-height: 1;
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
            .card--shot .card__cat { top: 18px; left: 18px; }
            .cookie-bar { padding: 18px; left: 10px; right: 10px; bottom: 10px; }
            .cookie-bar__actions { flex-direction: column; }
            .cookie-bar__btn { width: 100%; }
        }

        /* --- открытка с цитатой (только страницы записей) --- */

        .card-cta {
            display: flex;
            flex-wrap: wrap;
            align-items: center;
            justify-content: space-between;
            gap: 16px;
            margin-top: 40px;
            padding-top: 26px;
            border-top: 1px dashed rgba(201, 169, 122, 0.55);
        }

        .card-cta__text {
            font-family: 'Lora', serif;
            font-style: italic;
            font-size: 15px;
            line-height: 1.7;
            color: var(--brown-mid);
            max-width: 430px;
        }

        .card-btn {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 11px;
            letter-spacing: 1px;
            text-transform: uppercase;
            color: var(--brown-dark);
            background: rgba(255, 248, 235, 0.85);
            border: 1.5px solid var(--gold);
            border-radius: 12px;
            padding: 13px 22px;
            cursor: pointer;
            box-shadow: 3px 4px 0 rgba(58, 50, 40, 0.1);
            transition: transform .2s ease, box-shadow .2s ease, background .2s ease;
        }

        .card-btn:hover {
            transform: translate(-1px, -2px);
            box-shadow: 5px 6px 0 rgba(58, 50, 40, 0.12);
            background: #fff8eb;
        }

        .card-btn--pink {
            background: var(--pink);
            border-color: var(--pink);
            color: #fff;
        }

        .card-btn--pink:hover { background: #d96a8c; }

        /* Кнопка, всплывающая над выделенным куском текста */
        .card-pop {
            position: fixed;
            z-index: 120;
            opacity: 0;
            pointer-events: none;
            transform: translate(-50%, -100%) scale(.96);
            transition: opacity .18s ease, transform .18s ease;
        }

        .card-pop.is-open {
            opacity: 1;
            pointer-events: auto;
            transform: translate(-50%, -100%) scale(1);
        }

        .card-modal {
            position: fixed;
            inset: 0;
            z-index: 130;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
            background: rgba(58, 50, 40, 0.6);
            backdrop-filter: blur(6px);
            -webkit-backdrop-filter: blur(6px);
            opacity: 0;
            pointer-events: none;
            transition: opacity .25s ease;
        }

        .card-modal.is-open { opacity: 1; pointer-events: auto; }

        .card-sheet {
            position: relative;
            width: 100%;
            max-width: 480px;
            max-height: 92vh;
            overflow-y: auto;
            background: rgba(255, 248, 235, 0.98);
            border: 2px solid var(--ink);
            border-radius: 20px;
            box-shadow: 6px 7px 0 rgba(45, 52, 54, 0.14);
            padding: 26px 26px 24px;
        }

        .card-sheet__close {
            position: absolute;
            top: 14px;
            right: 14px;
            width: 34px;
            height: 34px;
            border: none;
            background: none;
            font-size: 22px;
            line-height: 1;
            color: var(--brown-light);
            cursor: pointer;
        }

        .card-sheet__close:hover { color: var(--brown-dark); }

        .card-sheet__title {
            font-family: 'Unbounded', sans-serif;
            font-weight: 700;
            font-size: 15px;
            letter-spacing: -0.2px;
            padding-right: 40px;
        }

        .card-sheet__note {
            font-size: 13px;
            color: var(--brown-light);
            margin-top: 4px;
        }

        .card-formats { display: flex; gap: 8px; margin: 16px 0 14px; }

        .card-fmt {
            font-family: 'Jost', sans-serif;
            font-weight: 400;
            font-size: 13px;
            padding: 7px 16px;
            border-radius: 30px;
            border: 1.5px dashed var(--gold);
            background: transparent;
            color: var(--brown-mid);
            cursor: pointer;
        }

        .card-fmt.is-on {
            border-style: solid;
            background: rgba(247, 208, 138, 0.35);
            color: var(--brown-dark);
        }

        .card-stage {
            display: flex;
            justify-content: center;
            padding: 14px;
            border: 1.5px dashed rgba(201, 169, 122, 0.5);
            border-radius: 16px;
            background: rgba(247, 239, 224, 0.6);
        }

        .card-stage canvas {
            max-width: 100%;
            max-height: 50vh;
            height: auto;
            border-radius: 10px;
        }

        .card-acts { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 16px; }

        .card-acts .card-btn { flex: 1 1 auto; }

        @media (max-width: 560px) {
            .card-cta { flex-direction: column; align-items: flex-start; }
            .card-sheet { padding: 20px 18px 18px; }
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
    <!-- Светлая схема объявлена намеренно: без неё Chrome на телефоне
         с тёмной темой перекрашивает страницу сам и ломает бумагу. -->
    <meta name="color-scheme" content="light">
    <meta name="theme-color" content="#f7efe0">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${esc(title)}</title>
    <meta name="description" content="${esc(description)}">
    <link rel="canonical" href="${url}">
    <link rel="icon" type="image/svg+xml" href="${SITE}/favicon.svg">

    <meta property="og:type" content="${published ? 'article' : 'website'}">
    <meta property="og:title" content="${esc(title)}">
    <meta property="og:description" content="${esc(description)}">
    <meta property="og:url" content="${url}">
    <meta property="og:image" content="${image || DEFAULT_PREVIEW.url}">${image ? '' : `
    <meta property="og:image:type" content="image/jpeg">
    <meta property="og:image:width" content="${DEFAULT_PREVIEW.width}">
    <meta property="og:image:height" content="${DEFAULT_PREVIEW.height}">
    <meta property="og:image:alt" content="${DEFAULT_PREVIEW.alt}">`}
    <meta property="og:site_name" content="Эмоциональная Гавань">
    <meta property="og:locale" content="ru_RU">${article}

    <!-- Карточку рисует не размер картинки, а этот тег: без него Телеграм
         показывает мелкий квадратик, даже зная ширину и высоту. -->
    <meta name="twitter:card" content="summary_large_image">
    <meta name="twitter:title" content="${esc(title)}">
    <meta name="twitter:description" content="${esc(description)}">
    <meta name="twitter:image" content="${image || DEFAULT_PREVIEW.url}">

    <link href="https://static.emotional-harbor.ru/fonts/harbor-fonts.css" rel="stylesheet">

${METRIKA}
${CSS}
</head>
<body>`;
}

// ---------- открытка с цитатой ----------

// Читатель выделяет строчку и уносит её картинкой. Картинка рисуется на
// canvas прямо в браузере читателя: ни один сервис генерации не нужен и
// ни один байт текста никуда не уходит. Подпись на открытке — только
// адрес сайта: в чужой ленте работает он, а не имя.
// Полоска сверху у всех открыток одна и та же — гаваньский розовый.
// Пробовали брать тон записи, как у печати времени чтения, но открытка
// уходит в чужую ленту одна, без страницы вокруг: там тон ни с чем не
// рифмуется и читается случайным цветом.

// Значение внутрь <script>: JSON плюс защита от «</script>» в заголовке
const js = (value) => JSON.stringify(value).replace(/</g, '\\u003c');

function renderCard(post) {
    return `        <div class="card-cta">
            <div class="card-cta__text">Если строчка отозвалась — выделите её в тексте и заберите открыткой.</div>
            <button class="card-btn" type="button" id="card-open">Сделать открытку</button>
        </div>

<div class="card-pop" id="card-pop"><button class="card-btn card-btn--pink" type="button" id="card-pop-btn">Сделать открытку</button></div>

<div class="card-modal" id="card-modal" role="dialog" aria-label="Открытка с цитатой">
    <div class="card-sheet">
        <button class="card-sheet__close" type="button" id="card-close" aria-label="Закрыть">&times;</button>
        <div class="card-sheet__title">Открытка с цитатой</div>
        <div class="card-sheet__note">Картинка собирается прямо в Вашем браузере.</div>
        <div class="card-formats">
            <button class="card-fmt is-on" type="button" data-fmt="square">Квадрат</button>
            <button class="card-fmt" type="button" data-fmt="story">Сторис</button>
        </div>
        <div class="card-stage"><canvas id="card-canvas" width="1080" height="1080"></canvas></div>
        <div class="card-acts">
            <button class="card-btn card-btn--pink" type="button" id="card-save">Скачать картинку</button>
            <button class="card-btn" type="button" id="card-copy">Скопировать</button>
        </div>
    </div>
</div>

<script>
(function () {
    var TITLE = ${js(post.title)};
    var FALLBACK = ${js(cleanExcerpt(post))};
    var FILE = ${js('otkrytka-' + post.slug + '.png')};
    var MAX = 280;

    var pop = document.getElementById('card-pop');
    var modal = document.getElementById('card-modal');
    var canvas = document.getElementById('card-canvas');
    var text = document.querySelector('.post-body');
    if (!pop || !modal || !canvas || !text || !canvas.getContext) return;

    var ctx = canvas.getContext('2d');
    var quote = '';
    var picked = '';
    var pickedRange = null;
    var shape = 'square';
    var loaded = false;

    // Переносы строк сохраняем: если выделили четыре строки списка, на
    // открытке должны остаться четыре строки, а не сплошная лента. Схлопываем
    // только пробелы внутри строки и пустые строки, идущие подряд.
    function tidy(value) {
        return String(value)
            .replace(/\\r/g, '')
            .split('\\n')
            .map(function (line) { return line.replace(/[ \\t\\u00a0]+/g, ' ').trim(); })
            .join('\\n')
            .replace(/\\n{3,}/g, '\\n\\n')
            .trim();
    }

    // Выделение, отданное браузером строкой, теряет маркеры списка: пункты
    // слипаются в сплошную ленту. Поэтому берём не строку, а сам кусок
    // разметки — и возвращаем точки сами. Заодно отбиваем абзацы и
    // подзаголовки переносом, иначе они тоже склеятся.
    function take(range) {
        var box = document.createElement('div');
        box.appendChild(range.cloneContents());
        Array.prototype.forEach.call(box.querySelectorAll('li'), function (item) {
            item.insertBefore(document.createTextNode('• '), item.firstChild);
        });
        Array.prototype.forEach.call(box.querySelectorAll('p,li,h2,h3,h4,blockquote'), function (block) {
            block.appendChild(document.createTextNode('\\n'));
        });
        // Внутри абзаца строки разведены тегом <br> — он текста не несёт,
        // и без замены пять строк слипаются в одну ленту
        Array.prototype.forEach.call(box.querySelectorAll('br'), function (brk) {
            brk.parentNode.replaceChild(document.createTextNode('\\n'), brk);
        });
        return tidy(box.textContent);
    }

    function hidePop() { pop.classList.remove('is-open'); }

    // Кнопка всплывает только над выделением внутри самой записи:
    // заголовок, крошки и подвал открыткой не становятся.
    function onSelect() {
        var sel = window.getSelection();
        if (!sel || sel.isCollapsed || modal.classList.contains('is-open')) { hidePop(); return; }
        var said = tidy(sel.toString());
        if (said.length < 12) { hidePop(); return; }
        var range = sel.getRangeAt(0);
        if (!text.contains(range.commonAncestorContainer)) { hidePop(); return; }
        var box = range.getBoundingClientRect();
        if (!box.width || !box.height) { hidePop(); return; }
        picked = said;
        // Кусок запоминаем целиком: к нажатию на кнопку выделение может
        // уже пропасть, а разметка нужна для маркеров
        pickedRange = range.cloneRange();
        pop.style.left = Math.min(Math.max(box.left + box.width / 2, 100), window.innerWidth - 100) + 'px';
        pop.style.top = Math.max(box.top - 8, 62) + 'px';
        pop.classList.add('is-open');
    }

    document.addEventListener('selectionchange', onSelect);
    // Прокрутка уводит выделение из-под кнопки. Проверку ставим первой:
    // обработчик срабатывает на каждое движение колеса, а прятать почти
    // всегда нечего.
    window.addEventListener('scroll', function () {
        if (pop.classList.contains('is-open')) hidePop();
    }, { passive: true });
    window.addEventListener('resize', hidePop);

    // Длинную простыню на открытку не пускаем: цитата — это строчка, а не
    // половина главы. Обрываем по возможности на конце предложения: открытка,
    // кончающаяся на полуслове, читается сломанной, а не выбранной.
    // Многоточие — запасной вариант, когда целой мысли в пределе не нашлось.
    function shorten(value) {
        if (value.length <= MAX) return value;
        var cut = value.slice(0, MAX);

        var end = -1;
        var finder = /[.!?]["»)]?(?=\\s|$)/g;
        var hit;
        while ((hit = finder.exec(cut)) !== null) end = hit.index + hit[0].length;
        if (end > MAX / 2) return cut.slice(0, end);

        var stop = Math.max(cut.lastIndexOf(' '), cut.lastIndexOf('\\n'));
        if (stop > MAX * 0.6) cut = cut.slice(0, stop);
        return cut.replace(/[\\s.,;:—-]+$/, '') + '…';
    }

    function open(value) {
        quote = shorten(tidy(value));
        hidePop();
        modal.classList.add('is-open');
        document.body.style.overflow = 'hidden';
        fonts().then(draw);
    }

    function close() {
        modal.classList.remove('is-open');
        document.body.style.overflow = '';
    }

    // Шрифт, который на странице нигде не нарисован в этом начертании,
    // браузер может и не запросить — тогда canvas молча возьмёт системный,
    // и заметить подмену можно только глазами. Поэтому просим явно.
    function fonts() {
        if (loaded || !document.fonts) return Promise.resolve();
        return Promise.all([
            document.fonts.load('italic 600 48px Lora'),
            document.fonts.load('700 30px Unbounded'),
            document.fonts.load('400 21px Jost'),
        ]).then(function () { loaded = true; }, function () {});
    }

    document.getElementById('card-pop-btn').addEventListener('click', function () {
        open(pickedRange ? take(pickedRange) : picked);
    });

    // Кнопкой без выделения открытка тоже делается — на неё встаёт тизер записи
    document.getElementById('card-open').addEventListener('click', function () {
        var sel = window.getSelection();
        var said = sel && !sel.isCollapsed ? tidy(sel.toString()) : '';
        open(said.length >= 12 ? take(sel.getRangeAt(0)) : FALLBACK);
    });

    document.getElementById('card-close').addEventListener('click', close);
    modal.addEventListener('click', function (event) { if (event.target === modal) close(); });
    document.addEventListener('keydown', function (event) { if (event.key === 'Escape') close(); });

    Array.prototype.forEach.call(document.querySelectorAll('.card-fmt'), function (button) {
        button.addEventListener('click', function () {
            shape = button.getAttribute('data-fmt');
            Array.prototype.forEach.call(document.querySelectorAll('.card-fmt'), function (other) {
                other.classList.toggle('is-on', other === button);
            });
            draw();
        });
    });

    function round(x, y, w, h, r) {
        ctx.beginPath();
        ctx.moveTo(x + r, y);
        ctx.arcTo(x + w, y, x + w, y + h, r);
        ctx.arcTo(x + w, y + h, x, y + h, r);
        ctx.arcTo(x, y + h, x, y, r);
        ctx.arcTo(x, y, x + w, y, r);
        ctx.closePath();
    }

    function wrap(value, max) {
        var words = String(value).split(' ');
        var rows = [];
        var row = '';
        for (var i = 0; i < words.length; i++) {
            var next = row ? row + ' ' + words[i] : words[i];
            if (row && ctx.measureText(next).width > max) { rows.push(row); row = words[i]; }
            else { row = next; }
        }
        if (row) rows.push(row);

        // Слово длиннее строки переносить не по чему — делим по буквам
        var out = [];
        rows.forEach(function (line) {
            while (ctx.measureText(line).width > max && line.length > 1) {
                var n = line.length;
                while (n > 1 && ctx.measureText(line.slice(0, n)).width > max) n--;
                out.push(line.slice(0, n));
                line = line.slice(n);
            }
            out.push(line);
        });
        return out;
    }

    // Раскладка цитаты: каждый кусок между переносами переносится сам по себе,
    // пустая строка остаётся пустой строкой.
    function lay(value, max) {
        var out = [];
        String(value).split('\\n').forEach(function (part, i) {
            if (!part) { if (i) out.push({ text: '', pad: 0 }); return; }
            // Длинный пункт списка переносится с отступом под первую букву,
            // а не под точку: иначе маркер теряется в столбце текста
            var mark = /^•\\s/.test(part) ? ctx.measureText('• ').width : 0;
            wrap(mark ? part.slice(2) : part, max - mark).forEach(function (line, k) {
                out.push({ text: (mark && !k ? '• ' : '') + line, pad: mark && k ? mark : 0 });
            });
        });
        return out;
    }

    // Пустая строка занимает половину обычной: воздух нужен, дыра — нет
    function stack(rows, step) {
        var sum = 0;
        rows.forEach(function (row) { sum += row.text ? step : step / 2; });
        return sum;
    }

    // Кавычка-шарик: круглая голова и короткий хвост. Рисуем сами, а не
    // берём знак из шрифта — у Lora он узкий и вытянутый, в крупном кегле
    // выглядит тощим.
    // Хвост смотрит вверх, шарик внизу — форма «66». Открывающая кавычка
    // это запятая, перевёрнутая на 180°; хвостом вниз («99») рисуется
    // закрывающая, и на месте открывающей она читается ошибкой.
    function mark(x, y, r) {
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(x - r, y);
        ctx.quadraticCurveTo(x - r * 0.95, y - r * 2.1, x + r * 0.1, y - r * 1.9);
        ctx.quadraticCurveTo(x - r * 0.35, y - r * 1.1, x + r * 0.05, y - r * 0.85);
        ctx.closePath();
        ctx.fill();
    }

    function draw() {
        var story = shape === 'story';
        var W = 1080;
        var H = story ? 1920 : 1080;
        canvas.width = W;
        canvas.height = H;

        ctx.fillStyle = '#f7efe0';
        ctx.fillRect(0, 0, W, H);

        // Бумага в клетку — та же, что под всеми страницами сайта
        ctx.strokeStyle = 'rgba(201, 169, 122, 0.18)';
        ctx.lineWidth = 2;
        for (var x = 45; x < W; x += 45) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
        for (var y = 45; y < H; y += 45) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

        var mx = 70;
        var my = story ? 230 : 70;
        var cw = W - mx * 2;
        var ch = H - my * 2;
        var r = 34;

        // Плоская тень без размытия — как у карточек блога
        ctx.fillStyle = 'rgba(45, 52, 54, 0.12)';
        round(mx + 14, my + 16, cw, ch, r);
        ctx.fill();

        ctx.fillStyle = '#fff8eb';
        round(mx, my, cw, ch, r);
        ctx.fill();

        // Полоска сверху — светлый розовый, одинаковый у всех открыток.
        // Тот же, что у печати «розовый песок» на страницах: акцентный
        // #e87a9c на такой ширине кричит и спорит с подписью внизу.
        ctx.save();
        round(mx, my, cw, ch, r);
        ctx.clip();
        ctx.fillStyle = '#F8B4C0';
        ctx.fillRect(mx, my, cw, 18);
        ctx.restore();

        ctx.strokeStyle = '#2D3436';
        ctx.lineWidth = 4;
        round(mx, my, cw, ch, r);
        ctx.stroke();

        var pad = 62;
        var left = mx + pad;
        var right = mx + cw - pad;
        var maxW = cw - pad * 2;

        // Шапка: «Гавань» розовая, как логотип на сайте
        ctx.textAlign = 'left';
        ctx.textBaseline = 'alphabetic';
        ctx.font = '700 30px Unbounded, sans-serif';
        var first = 'Эмоциональная ';
        ctx.fillStyle = '#3a3228';
        ctx.fillText(first, left, my + 112);
        ctx.fillStyle = '#e87a9c';
        ctx.fillText('Гавань', left + ctx.measureText(first).width, my + 112);

        ctx.fillStyle = '#9a7050';
        ctx.font = '300 22px Jost, sans-serif';
        ctx.fillText('Про чувства', left, my + 150);

        // Подпись внизу — только адрес, и тихо. Пробовали крупнее, чтобы
        // легче было набрать руками: вышло похоже на просьбу. Кому нужно —
        // тот прочтёт и так.
        var footY = my + ch - 62;
        ctx.textAlign = 'center';
        ctx.fillStyle = '#e87a9c';
        ctx.font = '700 24px Unbounded, sans-serif';
        ctx.fillText('emotional-harbor.ru', mx + cw / 2, footY);

        // Откуда строчка — над адресом, не больше двух строк
        ctx.textAlign = 'left';
        ctx.fillStyle = '#7a5840';
        ctx.font = '400 21px Jost, sans-serif';
        var source = wrap('— из записи «' + TITLE + '»', maxW).slice(0, 2);
        var sourceY = footY - 60 - (source.length - 1) * 30;
        source.forEach(function (line, i) { ctx.fillText(line, left, sourceY + i * 30); });

        ctx.strokeStyle = 'rgba(201, 169, 122, 0.6)';
        ctx.setLineDash([9, 9]);
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(left, sourceY - 42);
        ctx.lineTo(right, sourceY - 42);
        ctx.stroke();
        ctx.setLineDash([]);

        // Цитата занимает всё, что осталось между шапкой и подписью:
        // кегль подбирается вниз, пока блок не уместится.
        var top = my + 210;
        var bottom = sourceY - 90;
        // Сама цитата в «ёлочки» не берётся: внутри текста бывают свои
        // кавычки, и вторая закрывающая подряд читается опечаткой. Роль
        // открывающей берёт на себя шарик сверху.
        // Кавычки стоят высоко и отдельно, под самой шапкой, а не жмутся
        // к первой строке: они тут знак, а не часть набора.
        var markR = story ? 26 : 22;
        var markH = markR * 3.9;
        // Шарик внизу, хвост вверх: отмеряем от макушки хвоста, а не от центра
        var markY = top + markR * 2.4;
        var textTop = top + markH;

        var size = story ? 52 : 46;
        var rows = [];
        var step = 0;
        var tall = 0;
        while (true) {
            ctx.font = 'italic 600 ' + size + 'px Lora, serif';
            rows = lay(quote, maxW);
            step = size * 1.5;
            tall = stack(rows, step);
            if (tall <= bottom - textTop || size <= 22) break;
            size -= 2;
        }

        // Бледнее заливки полоски: знак должен быть виден, но не спорить
        // с текстом за внимание
        ctx.fillStyle = 'rgba(232, 122, 156, 0.28)';
        mark(left + markR, markY, markR);
        mark(left + markR * 3.4, markY, markR);

        var pen = textTop + (bottom - textTop - tall) / 2 + size;

        ctx.fillStyle = '#3a3228';
        rows.forEach(function (row) {
            if (row.text) ctx.fillText(row.text, left + row.pad, pen);
            pen += row.text ? step : step / 2;
        });
    }

    function blink(button, said) {
        var was = button.textContent;
        button.textContent = said;
        setTimeout(function () { button.textContent = was; }, 1800);
    }

    function save() {
        var link = document.createElement('a');
        link.download = FILE;
        link.href = canvas.toDataURL('image/png');
        link.click();
    }

    document.getElementById('card-save').addEventListener('click', save);

    // Буфер обмена для картинок умеет не всякий браузер — на айфоне нет.
    // Отказ не показываем ошибкой: просто отдаём файл.
    document.getElementById('card-copy').addEventListener('click', function () {
        var button = this;
        function instead() { save(); blink(button, 'Скачала файлом'); }
        if (!canvas.toBlob || !window.ClipboardItem || !navigator.clipboard) { instead(); return; }
        canvas.toBlob(function (blob) {
            if (!blob) { instead(); return; }
            navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
                .then(function () { blink(button, 'Скопировано'); }, instead);
        });
    });
})();
</script>
`;
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
${p.category ? `
                <div class="card__cat"><span class="chip">${esc(p.category)}</span></div>` : ''}
                <div class="card__title">${esc(p.title)}</div>
                <div class="card__excerpt">${esc(cleanExcerpt(p))}</div>
                <div class="card__foot">
                    <span class="card__more">Читать дальше →</span>
                    <span class="card__date">${humanDate(p.date)}</span>
                </div>
            </a>`).join('\n')}
        </div>`
        : `<div class="empty">Здесь пока тихо. Первая запись скоро появится.</div>`;

    return `${head({
        title: 'Про чувства · Эмоциональная Гавань',
        description: 'Здесь я пишу о том, как мы чувствуем, об эмоциональной гигиене и почему это важно. Блог Эмоциональной Гавани.',
        url: `${SITE}/blog.html`,
    })}

    <div class="wrap">
${siteHead(false)}

        <header class="page-head">
            <h1 class="page-title">
                <span class="pt-line pt-line--strict">Про</span>
                <span class="pt-line pt-marker"><span class="pt-init f-pink">Ч</span><span class="f-unb">у</span><span class="f-cav">в</span><span class="f-unb f-pink">с</span><span class="f-lora">т</span><span class="f-unb">в</span><span class="f-lora">а</span></span>
            </h1>
            <p class="page-sub">Здесь я пишу о том, как мы чувствуем, об эмоциональной гигиене и почему это важно.</p>
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
        // В разметке имя полное: поисковику нужен человек, которого можно
        // найти, а на странице достаточно имени.
        author: { '@type': 'Person', name: AUTHOR.fullName, description: AUTHOR.role },
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
        // Для превью берём jpeg-копию картинки; её адрес выяснен заранее,
        // до сборки страницы (см. previewImage). Пусто — встанет обложка.
        image: post.preview,
    })}

    <script type="application/ld+json">${JSON.stringify(jsonld)}</script>

    <div class="reading" id="reading" aria-hidden="true"></div>

    <div class="wrap">
        <nav class="crumbs" aria-label="Хлебные крошки">
            <a href="${SITE}/">Главная</a>
            <span class="sep">→</span>
            <a href="${SITE}/blog.html">Про чувства</a>
            <span class="sep">→</span>
            <span>${esc(post.title)}</span>
        </nav>

        <article>
            <div class="post-head">${post.category ? `
                <div class="post-cat"><span class="chip">${esc(post.category)}</span></div>` : ''}
                <div class="seal seal--${SEAL_TONES[(number - 1) % SEAL_TONES.length]}" title="Время чтения">
                    <span class="seal__num">${readingMinutes(post.text)} мин</span>
                    <span class="seal__unit">время чтения</span>
                </div>
            </div>
            <h1 class="post-title">${esc(post.title)}</h1>
            <div class="post-date">${humanDate(post.date)}</div>
${renderContents(post.text)}
            <div class="post-body">
            ${toParagraphs(post.text)}
            </div>
        </article>

${renderCard(post)}
        <aside class="author">
            <img class="author__icon" src="${AUTHOR.icon}" alt="" width="56" height="56" loading="lazy" decoding="async">
            <div class="author__text">
                <div class="author__name">${AUTHOR.name}</div>
                <div class="author__role">${AUTHOR.role}</div>
                <p class="author__about">${esc(AUTHOR.about)}</p>
            </div>
        </aside>

        <div class="post-foot">
            <div class="post-foot__text">Если хочется не только читать про чувства, но и вести их — Гавань для этого и сделана.</div>
            <a class="post-foot__link" href="${SITE}/">Посмотреть Гавань</a>
        </div>
${renderAlso(post, all) || renderNeighbours(newer, older)}
    </div>

${FOOTER}

${sticky(true)}

<script>
(function () {
    var bar = document.getElementById('reading');
    var text = document.querySelector('.post-body');
    if (!bar || !text) return;

    var waiting = false;

    // Считаем по тексту статьи: ноль — пока первая строка не поднялась
    // к верху окна, единица — когда последняя показалась внизу.
    function draw() {
        waiting = false;

        var box = text.getBoundingClientRect();
        var seen = -box.top + window.innerHeight * 0.5;
        var all = box.height;
        var part = all > 0 ? seen / all : 0;

        if (part < 0) part = 0;
        if (part > 1) part = 1;

        bar.style.width = (part * 100).toFixed(2) + '%';
    }

    function ask() {
        if (waiting) return;
        waiting = true;
        window.requestAnimationFrame(draw);
    }

    window.addEventListener('scroll', ask, { passive: true });
    window.addEventListener('resize', ask, { passive: true });
    draw();
})();
</script>

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

// Блог отвечает из облака, а облако иногда моргает: 12.09.2026 сборка упала
// на том, что у функции не отозвался внутренний DNS — одна осечка из девяти
// запусков за сутки, соседние прошли чисто. Одна такая секунда не повод
// считать блог упавшим, поэтому спрашиваем трижды с передышкой. Если и
// третья попытка не удалась — значит, дело не в моргании, и сборку честно
// останавливаем: страницы на сайте при этом остаются прежними.
const ATTEMPTS = 3;
const PAUSE_MS = 5000;
const TIMEOUT_MS = 30000; // столько же держит шлюз; без этого зависший запрос ждал бы вечно

async function fetchPosts() {
    for (let attempt = 1; ; attempt++) {
        try {
            const res = await fetch(API, { signal: AbortSignal.timeout(TIMEOUT_MS) });
            if (!res.ok) throw new Error(`блог ответил ${res.status}`);
            return await res.json();
        } catch (err) {
            if (attempt === ATTEMPTS) {
                throw new Error(`Блог не ответил с ${ATTEMPTS} попыток (${err.message}) — сборку не делаем, старые файлы остаются на месте`);
            }
            console.log(`Попытка ${attempt} из ${ATTEMPTS} не удалась (${err.message}) — повтор через ${PAUSE_MS / 1000} с`);
            await new Promise((next) => setTimeout(next, PAUSE_MS));
        }
    }
}

const all = await fetchPosts();
if (!Array.isArray(all)) throw new Error('Блог вернул не список постов');

// Черновики на сайт не идут. Страница уже опубликованного поста,
// переведённого в черновики, удаляется ниже вместе с остальным лишним.
const posts = all.filter((p) => p.status !== 'draft');

posts.sort((a, b) => new Date(b.date) - new Date(a.date));

// Адрес картинки для соцсетей выясняем до сборки: проверка идёт запросом
// в бакет, а разметку страницы собираем уже без ожиданий.
await Promise.all(posts.map(async (post) => {
    post.preview = await previewImage((collectImages(post.text)[0] || {}).url || '');
}));

await mkdir(OUT_DIR, { recursive: true });

// Пост могли удалить из posts.json руками — тогда убираем и его страницу,
// иначе она осталась бы висеть в поиске навсегда.
const queue = [];

const alive = new Set(posts.map((p) => `${p.slug}.html`));
for (const file of await readdir(OUT_DIR)) {
    if (file.endsWith('.html') && !alive.has(file)) await rm(join(OUT_DIR, file));
}

// Ошибка в одной строке скрипта отменяет весь скрипт целиком — браузер не
// выполняет из него ничего. Страница при этом выглядит совершенно здоровой,
// а поломка видна только в консоли, которую никто не открывает: 15.09.2026
// так тихо умерла вся открытка из-за потерянных кавычек у цвета. Поэтому
// перед записью каждый встроенный скрипт компилируем. Компилируем, а не
// выполняем: `new Function` только разбирает текст, ничего не запуская.
function checkScripts(html, where) {
    const tags = /<script(?![^>]*\ssrc=)(?![^>]*\stype=)[^>]*>([\s\S]*?)<\/script>/g;
    let found;
    while ((found = tags.exec(html)) !== null) {
        try {
            new Function(found[1]);
        } catch (err) {
            throw new Error(`${where}: встроенный скрипт не компилируется (${err.message}) — страницу не пишем`);
        }
    }
}

posts.forEach((post, i) => {
    // Номер по хронологии: у первой записи он навсегда останется первым,
    // сколько бы постов ни вышло после неё.
    const page = renderPost(post, posts.length - i, posts[i - 1], posts[i + 1], posts);
    checkScripts(page, `${post.slug}.html`);
    queue.push(writeFile(join(OUT_DIR, `${post.slug}.html`), page, 'utf8'));
});

await Promise.all(queue);

const list = renderList(posts);
checkScripts(list, 'blog.html');
await writeFile('blog.html', list, 'utf8');
await writeFile('sitemap-blog.xml', renderSitemap(posts), 'utf8');

console.log(`Собрано: ${posts.length} ${posts.length === 1 ? 'пост' : 'постов'}`);
