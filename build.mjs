// Buduje stronę do dist/: statyczny CSS z Tailwinda wstawiony do <head>, lokalny font Inter,
// zminifikowane skrypty. `node build.mjs` buduje raz, `node build.mjs --serve` buduje,
// serwuje dist/ pod http://localhost:4174 i przebudowuje po każdej zmianie źródeł.
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createReadStream, existsSync, statSync, watch } from 'node:fs';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transform } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import tailwindConfig from './tailwind.config.js';

const ROOT = dirname(fileURLToPath(import.meta.url));
const SRC = join(ROOT, 'src');
const PUBLIC = join(ROOT, 'public');
const DIST = join(ROOT, 'dist');
const INTER = join(ROOT, 'node_modules/@fontsource-variable/inter');
// Polskie znaki spoza latin (ł, ą, ę, ś…) są w latin-ext, więc potrzebne są oba podzbiory.
const FONT_SUBSETS = ['latin-ext', 'latin'];
const CSS_SLOT = /[ \t]*<!-- build:css[^>]*-->\n/;

const minify = async (code, loader, options = {}) =>
    (await transform(code, { loader, minify: true, legalComments: 'none', ...options })).code.trim();

// Te same grubości, o które strona prosiła Google Fonts. Każda ma własne @font-face (jeden plik
// zmienny na podzbiór), więc pośrednie grubości trafiają do najbliższej z nich, jak dotąd:
// font-medium rysuje się jako 400, a font-bold jako 800.
const FONT_WEIGHTS = [300, 400, 600, 800];

// @font-face z paczki fontsource: tylko potrzebne podzbiory, pliki z /fonts/, rodzina „Inter”.
async function fontFaces() {
    const css = await readFile(join(INTER, 'wght.css'), 'utf8');
    return FONT_SUBSETS.flatMap((subset) => {
        const face = css.split('@font-face').find((block) => block.includes(`inter-${subset}-wght-normal.woff2`));
        if (!face) throw new Error(`Brak podzbioru ${subset} w @fontsource-variable/inter`);
        const rule = '@font-face' + face.slice(0, face.indexOf('}') + 1)
            .replace(/font-family:[^;]+;/, "font-family: 'Inter';")
            .replace(/url\(\.\/files\//g, 'url(/fonts/');
        if (!/font-weight:[^;]+;/.test(rule)) throw new Error('Brak font-weight w @font-face paczki Inter');
        return FONT_WEIGHTS.map((weight) => rule.replace(/font-weight:[^;]+;/, `font-weight: ${weight};`));
    }).join('\n');
}

async function buildCss() {
    const source = await readFile(join(SRC, 'styles.css'), 'utf8');
    const config = { ...tailwindConfig, content: tailwindConfig.content.map((file) => join(ROOT, file)) };
    const result = await postcss([tailwind(config)]).process(`${await fontFaces()}\n${source}`, { from: join(SRC, 'styles.css') });
    return minify(result.css, 'css');
}

async function build() {
    const started = Date.now();
    await rm(DIST, { recursive: true, force: true });
    await mkdir(join(DIST, 'fonts'), { recursive: true });
    await cp(PUBLIC, DIST, { recursive: true });
    for (const subset of FONT_SUBSETS) {
        const file = `inter-${subset}-wght-normal.woff2`;
        await cp(join(INTER, 'files', file), join(DIST, 'fonts', file));
    }
    await cp(join(INTER, 'LICENSE'), join(DIST, 'fonts/Inter-OFL.txt'));

    // Sceny to zamknięty IIFE, więc można skracać także nazwy.
    const scenes = await minify(await readFile(join(SRC, 'scenes.js'), 'utf8'), 'js');
    await writeFile(join(DIST, 'scenes.js'), scenes);
    const scenesHash = createHash('sha256').update(scenes).digest('hex').slice(0, 8);

    let html = await readFile(join(SRC, 'index.html'), 'utf8');
    if (!CSS_SLOT.test(html)) throw new Error('Brak znacznika <!-- build:css --> w src/index.html');
    const css = await buildCss();

    // Skrypt strony zostawia nazwy globalne: wołają je atrybuty onclick i scenes.js.
    const scripts = [];
    for (const match of html.matchAll(/<script>([\s\S]*?)<\/script>/g)) {
        scripts.push([match[0], `<script>${await minify(match[1], 'js', { minifyIdentifiers: false })}</script>`]);
    }
    for (const [from, to] of scripts) html = html.replace(from, () => to);
    html = html.replace(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/,
        (_, json) => `<script type="application/ld+json">${JSON.stringify(JSON.parse(json))}</script>`);

    html = html
        .replace(CSS_SLOT, () => '<!--css-->\n')
        .replace(/<!--(?!css-->)[\s\S]*?-->/g, '')
        .split('\n').map((line) => line.trim()).filter(Boolean).join('\n')
        .replace('<!--css-->', () => `<style>${css}</style>`)
        .replace('src="/scenes.js"', `src="/scenes.js?v=${scenesHash}"`);
    await writeFile(join(DIST, 'index.html'), html + '\n');

    const kb = (file) => (statSync(join(DIST, file)).size / 1024).toFixed(1) + ' kB';
    console.log(`dist/ gotowe w ${Date.now() - started} ms: index.html ${kb('index.html')} (w tym CSS ${(css.length / 1024).toFixed(1)} kB), scenes.js ${kb('scenes.js')}`);
}

const TYPES = {
    '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
    '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
    '.xml': 'application/xml', '.txt': 'text/plain; charset=utf-8',
};

function serve(port) {
    createServer((request, response) => {
        const path = normalize(decodeURIComponent(new URL(request.url, 'http://localhost').pathname));
        let file = join(DIST, path);
        if (!file.startsWith(DIST)) { response.writeHead(403).end(); return; }
        if (existsSync(file) && statSync(file).isDirectory()) file = join(file, 'index.html');
        if (!existsSync(file)) { response.writeHead(404).end('Not found'); return; }
        response.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
        createReadStream(file).pipe(response);
    }).listen(port, '127.0.0.1', () => console.log(`http://localhost:${port}`));
}

await build();

if (process.argv.includes('--serve')) {
    serve(Number(process.env.PORT) || 4174);
    let pending;
    const rebuild = () => {
        clearTimeout(pending);
        pending = setTimeout(() => build().catch((error) => console.error(error.message)), 100);
    };
    for (const target of [SRC, PUBLIC, join(ROOT, 'tailwind.config.js')]) watch(target, { recursive: true }, rebuild);
}
