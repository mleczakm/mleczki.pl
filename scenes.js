// Animacje paneli: każdy panel ma własne płótno, które działa tylko wtedy, gdy panel jest aktywny.
(() => {
    const SKEW_TAN = Math.tan(12 * Math.PI / 180);
    const FADE_MS = 700; // Musi być nie krótsze niż przejście opacity w .panel-scene
    const SERIF = 'Georgia, "Times New Roman", serif';
    const SANS = 'Inter, sans-serif';
    const MONO = 'ui-monospace, Menlo, Consolas, monospace';

    // --- 1. Narzędzia ---

    const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const lerp = (a, b, t) => a + (b - a) * t;
    const smooth = (t) => { const x = clamp(t); return x * x * (3 - 2 * x); };
    const mod = (v, m) => ((v % m) + m) % m;
    // Ziarna drzew, chmur i opadów są stałe. Wyniki zachowują pełną precyzję,
    // a ograniczona tablica nie rośnie podczas długiej jazdy.
    const hashes = new Float64Array(2048);
    const knownHashes = new Uint8Array(hashes.length);
    const hash = (n) => {
        const reusable = Number.isInteger(n) && n >= 0 && n < hashes.length;
        if (reusable && knownHashes[n]) return hashes[n];
        const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
        const value = x - Math.floor(x);
        if (reusable) { hashes[n] = value; knownHashes[n] = 1; }
        return value;
    };
    const label = (key) => {
        const lang = document.documentElement.lang;
        return (translations[lang] && translations[lang][key]) || translations.pl[key] || '';
    };

    const colors = new Map();
    const rgb = (hex) => {
        if (colors.has(hex)) return colors.get(hex);
        const n = parseInt(hex.slice(1), 16);
        const value = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
        colors.set(hex, value);
        return value;
    };
    const mixRgb = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
    const css = (c, alpha = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${alpha})`;

    const roundedPath = (c, x, y, w, h, r) => {
        c.moveTo(x + r, y);
        c.arcTo(x + w, y, x + w, y + h, r);
        c.arcTo(x + w, y + h, x, y + h, r);
        c.arcTo(x, y + h, x, y, r);
        c.arcTo(x, y, x + w, y, r);
        c.closePath();
    };
    const roundedRect = (c, x, y, w, h, r) => {
        c.beginPath();
        roundedPath(c, x, y, w, h, r);
    };
    const poly = (c, points) => {
        c.beginPath();
        c.moveTo(points[0], points[1]);
        for (let i = 2; i < points.length; i += 2) c.lineTo(points[i], points[i + 1]);
        c.closePath();
    };
    const disc = (c, x, y, r) => { c.beginPath(); c.arc(x, y, r, 0, Math.PI * 2); c.fill(); };
    const line = (c, x1, y1, x2, y2) => { c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke(); };
    const arched = (c, x, y, w, h) => {
        c.beginPath();
        c.moveTo(x, y + h);
        c.lineTo(x, y + w / 2);
        c.arc(x + w / 2, y + w / 2, w / 2, Math.PI, 0);
        c.lineTo(x + w, y + h);
        c.closePath();
    };
    const bezier = (p, t) => {
        const u = 1 - t;
        const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
        return [
            a * p[0][0] + b * p[1][0] + d * p[2][0] + e * p[3][0],
            a * p[0][1] + b * p[1][1] + d * p[2][1] + e * p[3][1],
        ];
    };
    const drawBezier = (c, p) => {
        c.beginPath();
        c.moveTo(p[0][0], p[0][1]);
        c.bezierCurveTo(p[1][0], p[1][1], p[2][0], p[2][1], p[3][0], p[3][1]);
        c.stroke();
    };
    const setFont = (c, weight, size, family = SANS) => { c.font = `${weight} ${size}px ${family}`; };

    let textWidths = new WeakMap();
    const textWidth = (c, text) => {
        let widths = textWidths.get(c);
        if (!widths) { widths = new Map(); textWidths.set(c, widths); }
        const key = `${c.font}|${c.letterSpacing || '0px'}|${text}`;
        if (widths.has(key)) return widths.get(key);
        const width = c.measureText(text).width;
        if (widths.size >= 128) widths.clear();
        widths.set(key, width);
        return width;
    };
    // Po wczytaniu fontu pomiar wykonany na foncie zastępczym jest już nieaktualny.
    if (document.fonts) document.fonts.addEventListener('loadingdone', () => { textWidths = new WeakMap(); });

    // Niezmienne tło powstaje raz, w dokładnie tej samej rozdzielczości co scena.
    // Kopia 1:1 nie rozmywa detali i nie zmienia gęstości pikseli ani płynności.
    function createBackdrop() {
        let cachedView = null, bitmap = null, scaleX = 0, scaleY = 0;
        const draw = (c, view, paint) => {
            const transform = c.getTransform();
            if (cachedView !== view || !bitmap || bitmap.width !== c.canvas.width || bitmap.height !== c.canvas.height
                || scaleX !== transform.a || scaleY !== transform.d) {
                bitmap = document.createElement('canvas');
                bitmap.width = c.canvas.width;
                bitmap.height = c.canvas.height;
                const background = bitmap.getContext('2d', { alpha: false });
                background.setTransform(transform);
                paint(background);
                cachedView = view;
                scaleX = transform.a;
                scaleY = transform.d;
            }
            c.save();
            c.setTransform(1, 0, 0, 1, 0, 0);
            c.drawImage(bitmap, 0, 0);
            c.restore();
        };
        draw.release = () => {
            if (bitmap) { bitmap.width = 1; bitmap.height = 1; }
            bitmap = null;
            cachedView = null;
        };
        return draw;
    }
    // Chmura jako jedna ścieżka, aby półprzezroczyste kręgi nie prześwitywały przez siebie
    const puff = (c, x, y, size, seed) => {
        c.beginPath();
        for (let k = 0; k < 6; k++) {
            const ox = x + (k - 2.5) * 34 * size;
            const oy = y - Math.sin((k + 0.5) / 6 * Math.PI) * 18 * size - hash(seed * 10 + k) * 8 * size;
            const r = (22 + hash(seed * 7 + k) * 14) * size;
            c.moveTo(ox + r, oy);
            c.arc(ox, oy, r, 0, Math.PI * 2);
        }
        roundedPath(c, x - 104 * size, y - 6 * size, 208 * size, 20 * size, 10 * size);
        c.fill();
    };

    // --- 2. Scena: pomysł -> działający system (wg mleczakm.github.io) ---

    function createSystemScene() {
        const SCENARIOS = [
            { chore: 'scene_s1_in', tool: 'match_payment', result: 'scene_s1_out', metric: '~30 s' },
            { chore: 'scene_s2_in', tool: 'search_workshops', result: 'scene_s2_out', metric: '24/7' },
            { chore: 'scene_s3_in', tool: 'create_label', result: 'scene_s3_out', metric: 'scene_s3_metric' },
        ];
        const ROUTE = [['data', 'hub'], ['hub', 'agent'], ['agent', 'hub'], ['hub', 'tools'], ['tools', 'hub'], ['hub', 'result']];
        const NODES = {
            data: { key: 'scene_node_data', icon: '≡', side: -1, far: true },
            tools: { key: 'scene_node_tools', icon: '⌘', side: -1, far: false },
            agent: { key: 'scene_node_agent', icon: '✳', side: 1, far: false },
            result: { key: 'scene_node_result', icon: '↗', side: 1, far: true },
        };
        const PRE = 0.7, STEP = 1.05, HOLD = 2.6;
        const END = PRE + ROUTE.length * STEP + HOLD;

        let clock = 0, elapsed = 0, scenario = 0, routeIndex = -1;
        const heat = { hub: 0, data: 0, tools: 0, agent: 0, result: 0 };
        let ripples = [];
        const layouts = new WeakMap();
        const backdrop = createBackdrop();

        const reveal = (from, to) => smooth((elapsed - from) / 0.28) * (1 - smooth((elapsed - to) / 0.28));

        function layout(view) {
            if (layouts.has(view)) return layouts.get(view);
            const hy = view.h * 0.885;
            const left = Math.max(view.left(hy), 0);
            const right = view.right(hy);
            const width = right - left;
            const hx = (left + right) / 2;
            const compact = width < 640;
            const spread = Math.min(width / 2, 430);
            const points = { hub: [hx, hy] };
            Object.entries(NODES).forEach(([name, node]) => {
                points[name] = [
                    hx + node.side * spread * (node.far ? 0.76 : 0.38),
                    hy + (node.far ? -26 : 30),
                ];
            });
            const result = { hx, hy, left, right, width, compact, points };
            layouts.set(view, result);
            return result;
        }

        function beamPath(points, from, to) {
            const a = points[from], b = points[to];
            return [a, [b[0], a[1]], [lerp(a[0], b[0], 0.33), b[1]], b];
        }

        function drawNode(c, name, point, compact) {
            const node = NODES[name];
            const glow = heat[name];
            setFont(c, 600, 11);
            const text = label(node.key);
            const w = compact ? 38 : textWidth(c, text) + 50;
            const h = 38;
            const x = point[0] - w / 2, y = point[1] - h / 2;
            c.save();
            c.shadowColor = css([96, 165, 250], 0.2 + glow * 0.7);
            c.shadowBlur = 8 + glow * 22;
            roundedRect(c, x, y, w, h, 8);
            c.fillStyle = '#1e293b';
            c.fill();
            c.restore();
            roundedRect(c, x, y, w, h, 8);
            c.strokeStyle = css(mixRgb([51, 65, 85], [96, 165, 250], glow));
            c.lineWidth = 1;
            c.stroke();
            c.textBaseline = 'middle';
            setFont(c, 400, 17);
            c.fillStyle = '#60a5fa';
            c.textAlign = compact ? 'center' : 'left';
            c.fillText(node.icon, compact ? point[0] : x + 13, point[1] + 1);
            if (!compact) {
                setFont(c, 600, 11);
                c.fillStyle = '#e2e8f0';
                c.fillText(text, x + 36, point[1] + 1);
            }
        }

        function drawHub(c, hx, hy) {
            const size = 84 + heat.hub * 5;
            const x = hx - size / 2, y = hy - size / 2;
            c.save();
            c.shadowColor = css([59, 130, 246], 0.45 + heat.hub * 0.5);
            c.shadowBlur = 20 + heat.hub * 26;
            roundedRect(c, x - 5, y - 5, size + 10, size + 10, 18);
            c.fillStyle = '#334155';
            c.fill();
            c.restore();
            const fill = c.createLinearGradient(x, y, x, y + size);
            fill.addColorStop(0, '#1e40af');
            fill.addColorStop(1, '#172554');
            roundedRect(c, x, y, size, size, 14);
            c.fillStyle = fill;
            c.fill();
            c.textAlign = 'center';
            c.textBaseline = 'alphabetic';
            setFont(c, 700, 44, SERIF);
            c.fillStyle = '#ffffff';
            c.fillText('m', hx - 5, hy + 6);
            c.fillStyle = '#7dd3fc';
            disc(c, hx + 21, hy + 1, 4.5 + Math.sin(clock * 3) * 0.6);
            setFont(c, 600, 7);
            c.fillStyle = 'rgba(191,219,254,.85)';
            c.fillText('AI × HUMAN', hx, hy + 29);
        }

        function drawChip(c, point, text, alpha, view, options = {}) {
            if (alpha <= 0) return;
            const { mono = false, strong = false, metric = '' } = options;
            const fontSize = view.mobile ? 17 : 11.5;
            c.save();
            c.globalAlpha = alpha;
            setFont(c, strong ? 700 : 500, fontSize, mono ? MONO : SANS);
            const textW = textWidth(c, text);
            setFont(c, 800, fontSize + 4.5);
            const metricW = metric ? textWidth(c, metric) + 12 : 0;
            const w = textW + metricW + 26, h = view.mobile ? 38 : 30;
            const y = point[1] - (view.mobile ? 70 : 62) - (1 - alpha) * -8;
            const x = clamp(point[0] - w / 2, Math.max(view.left(y), 0) + 8, view.right(y) - w - 8);
            roundedRect(c, x, y, w, h, 15);
            c.fillStyle = strong ? '#2563eb' : '#0b1222';
            c.fill();
            c.strokeStyle = strong ? '#60a5fa' : '#334155';
            c.lineWidth = 1;
            c.stroke();
            c.textBaseline = 'middle';
            c.textAlign = 'left';
            setFont(c, strong ? 700 : 500, fontSize, mono ? MONO : SANS);
            c.fillStyle = strong ? '#ffffff' : '#bfdbfe';
            c.fillText(text, x + 13, y + h / 2 + 1);
            if (metric) {
                setFont(c, 800, fontSize + 4.5);
                c.fillStyle = '#bae6fd';
                c.fillText(metric, x + 13 + textW + 12, y + h / 2 + 1);
            }
            c.restore();
        }

        return {
            release() { backdrop.release(); },
            enter() {
                elapsed = 0;
                routeIndex = -1;
                ripples = [];
                Object.keys(heat).forEach((k) => { heat[k] = 0; });
            },
            update(dt) {
                clock += dt;
                elapsed += dt;
                Object.keys(heat).forEach((k) => { heat[k] = Math.max(0, heat[k] - dt * 1.3); });
                ripples = ripples.filter((r) => { r.age += dt; return r.age < 2.4; });
                if (elapsed < PRE) heat.data = Math.max(heat.data, 0.7);
                const index = Math.floor((elapsed - PRE) / STEP);
                if (index !== routeIndex && index >= 0) {
                    if (index <= ROUTE.length && routeIndex >= 0) {
                        const arrived = ROUTE[routeIndex][1];
                        heat[arrived] = 1;
                        if (arrived === 'hub') ripples.push({ age: 0 });
                    }
                    routeIndex = index;
                }
                if (elapsed >= END) {
                    elapsed = 0;
                    routeIndex = -1;
                    scenario = (scenario + 1) % SCENARIOS.length;
                }
            },
            draw(c, view) {
                const { hx, hy, compact, points, right } = layout(view);
                const item = SCENARIOS[scenario];

                backdrop(c, view, (background) => {
                    background.fillStyle = '#0f172a';
                    background.fillRect(0, 0, view.w, view.h);
                    const haze = background.createRadialGradient(hx, hy, 10, hx, hy, view.h * 0.8);
                    haze.addColorStop(0, 'rgba(37,99,235,.28)');
                    haze.addColorStop(1, 'rgba(37,99,235,0)');
                    background.fillStyle = haze;
                    background.fillRect(0, 0, view.w, view.h);
                });

                // Orbity jak w sekcji hero
                const radii = [view.h * 0.3, view.h * 0.47, view.h * 0.66, view.h * 0.86];
                radii.forEach((r, i) => {
                    c.beginPath();
                    c.arc(hx, hy, r, 0, Math.PI * 2);
                    c.strokeStyle = `rgba(147,197,253,${0.17 - i * 0.02})`;
                    c.lineWidth = 1;
                    c.setLineDash(i === 2 ? [5, 8] : []);
                    c.lineDashOffset = i === 2 ? -clock * 8 : 0;
                    c.stroke();
                });
                c.setLineDash([]);
                ripples.forEach((ripple) => {
                    const k = ripple.age / 2.4;
                    c.beginPath();
                    c.arc(hx, hy, 46 + k * view.h * 0.62, 0, Math.PI * 2);
                    c.strokeStyle = `rgba(125,211,252,${(1 - k) * 0.4})`;
                    c.lineWidth = 1.4;
                    c.stroke();
                });
                for (let i = 0; i < 7; i++) {
                    const r = radii[i % radii.length];
                    const angle = hash(i) * 6.28 + clock * (i % 2 ? 0.07 : -0.05) * (1 + hash(i + 9));
                    c.fillStyle = i % 3 ? '#60a5fa' : '#bae6fd';
                    disc(c, hx + Math.cos(angle) * r, hy + Math.sin(angle) * r, 2.2 + hash(i + 3));
                }

                // Łuki i impuls danych
                c.lineWidth = 1.2;
                c.strokeStyle = 'rgba(148,197,253,.28)';
                Object.keys(NODES).forEach((name) => drawBezier(c, beamPath(points, name, 'hub')));
                if (routeIndex >= 0 && routeIndex < ROUTE.length) {
                    const [from, to] = ROUTE[routeIndex];
                    const path = beamPath(points, from, to);
                    const t = smooth((elapsed - PRE - routeIndex * STEP) / STEP);
                    c.strokeStyle = 'rgba(125,211,252,.75)';
                    c.lineWidth = 1.6;
                    c.setLineDash([7, 7]);
                    c.lineDashOffset = -clock * 60;
                    drawBezier(c, path);
                    c.setLineDash([]);
                    for (let i = 14; i >= 0; i--) {
                        const p = bezier(path, Math.max(0, t - i * 0.016));
                        c.fillStyle = `rgba(186,230,253,${(1 - i / 15) * 0.8})`;
                        disc(c, p[0], p[1], 4.6 - i * 0.25);
                    }
                    const head = bezier(path, t);
                    c.save();
                    c.shadowColor = '#7dd3fc';
                    c.shadowBlur = 16;
                    c.fillStyle = '#ffffff';
                    disc(c, head[0], head[1], 4.6);
                    c.restore();
                }

                Object.keys(NODES).forEach((name) => drawNode(c, name, points[name], compact));
                drawHub(c, hx, hy);

                // Podpisy kolejnych etapów
                drawChip(c, points.data, label(item.chore), reveal(0, PRE + STEP * 0.7), view);
                drawChip(c, points.tools, `MCP · ${item.tool}`, reveal(PRE + STEP * 3.6, PRE + STEP * 5.2), view, { mono: true });
                const metric = item.metric.startsWith('scene_') ? label(item.metric) : item.metric;
                drawChip(c, points.result, `✓ ${label(item.result)}`, reveal(PRE + STEP * 6, END - 0.3), view, { strong: true, metric });

                // Nagłówek i licznik scenariuszy; na telefonie nie ma na nie miejsca
                if (view.mobile) return;
                c.textBaseline = 'middle';
                c.textAlign = 'center';
                setFont(c, 700, 10);
                if ('letterSpacing' in c) c.letterSpacing = '2px';
                const titleX = (view.textL + view.textR) / 2;
                const titleW = textWidth(c, label('scene_caption'));
                // Na wąskim ekranie podpis schodzi poniżej znaku marki w lewym górnym rogu
                const clearsBrand = titleX - titleW / 2 + view.screenX > 200 / view.scale;
                const top = clearsBrand ? view.h * 0.052 : 80 / view.scale;
                c.fillStyle = 'rgba(191,219,254,.85)';
                c.fillText(label('scene_caption'), titleX, top);
                if ('letterSpacing' in c) c.letterSpacing = '0px';
                c.fillStyle = '#60a5fa';
                disc(c, titleX - titleW / 2 - 12, top, 3 + Math.sin(clock * 2.4));
                setFont(c, 500, 10, MONO);
                c.textAlign = 'right';
                c.fillStyle = 'rgba(148,163,184,.9)';
                c.fillText(`0${scenario + 1} / 03`, Math.min(right, view.right(hy + 66)) - 14, hy + 66);
            },
        };
    }

    // --- 3. Scena: rowerzysta w okolicach Radzymina ---

    function createRideScene() {
        const PARALLAX_MID = 0.42, PARALLAX_FAR = 0.1;
        const SPEED = 175; // Prędkość drogi w jednostkach na sekundę
        const LOOP = 5220, TREE_STEP = 30;
        const CHURCH_X = 1500, LAKE_L = 2640, LAKE_R = 4180, BRIDGE_L = 2610, BRIDGE_R = 4210;
        const DAY_SECONDS = 100;
        const WEATHER = [
            ['clear', 16], ['cloudy', 8], ['rain', 15], ['rainbow', 10], ['fog', 11], ['cloudy', 5], ['snow', 18],
        ];
        const INTENSITY = {
            clear: { cloud: 0.15, rain: 0, snow: 0, fog: 0, rainbow: 0 },
            cloudy: { cloud: 0.8, rain: 0, snow: 0, fog: 0, rainbow: 0 },
            rain: { cloud: 1, rain: 1, snow: 0, fog: 0.15, rainbow: 0 },
            rainbow: { cloud: 0.35, rain: 0, snow: 0, fog: 0, rainbow: 1 },
            fog: { cloud: 0.5, rain: 0, snow: 0, fog: 1, rainbow: 0 },
            snow: { cloud: 0.9, rain: 0, snow: 1, fog: 0.1, rainbow: 0 },
        };
        const PALETTE = [
            { at: 0, light: 0, top: '#031510', bottom: '#0a3324', far: '#0a2f22', mountain: '#0c3a2a', forest: '#06261a', meadow: '#072a1d', ground: '#062318', road: '#141d1a', water: '#0a3a2a', stone: '#6c7f73', cloud: '#123a2c' },
            { at: 0.17, light: 0.05, top: '#04211a', bottom: '#0f4630', far: '#0f3f2e', mountain: '#134937', forest: '#082f20', meadow: '#0a3425', ground: '#072a1c', road: '#172220', water: '#0e4632', stone: '#7b8f82', cloud: '#1a4a38' },
            { at: 0.25, light: 0.55, top: '#0d5336', bottom: '#e0b567', far: '#4d8b6d', mountain: '#2f7458', forest: '#114a33', meadow: '#1a5d3f', ground: '#104a31', road: '#2a3731', water: '#6f9d78', stone: '#d9d4b4', cloud: '#e8cf9a' },
            { at: 0.36, light: 1, top: '#0f6b47', bottom: '#6fc196', far: '#58a884', mountain: '#3b8f6c', forest: '#15603f', meadow: '#22794f', ground: '#14593a', road: '#2f3e37', water: '#3f9a79', stone: '#eef3ec', cloud: '#e6f4ea' },
            { at: 0.62, light: 1, top: '#0f6b47', bottom: '#6fc196', far: '#58a884', mountain: '#3b8f6c', forest: '#15603f', meadow: '#22794f', ground: '#14593a', road: '#2f3e37', water: '#3f9a79', stone: '#eef3ec', cloud: '#e6f4ea' },
            { at: 0.74, light: 0.75, top: '#0d5336', bottom: '#e0a55a', far: '#5f8c6c', mountain: '#39745a', forest: '#124c35', meadow: '#29694a', ground: '#114c33', road: '#2b3631', water: '#7e9c6c', stone: '#e8d4a8', cloud: '#f0c98f' },
            { at: 0.83, light: 0.3, top: '#093b2b', bottom: '#c9713f', far: '#3b5f4d', mountain: '#23513f', forest: '#0c3a29', meadow: '#104232', ground: '#0c3627', road: '#1f2926', water: '#7a6a48', stone: '#a59378', cloud: '#a8704c' },
            { at: 0.91, light: 0.03, top: '#04211a', bottom: '#0f4630', far: '#0f3f2e', mountain: '#134937', forest: '#082f20', meadow: '#0a3425', ground: '#072a1c', road: '#172220', water: '#0e4632', stone: '#7b8f82', cloud: '#1a4a38' },
            { at: 1, light: 0, top: '#031510', bottom: '#0a3324', far: '#0a2f22', mountain: '#0c3a2a', forest: '#06261a', meadow: '#072a1d', ground: '#062318', road: '#141d1a', water: '#0a3a2a', stone: '#6c7f73', cloud: '#123a2c' },
        ].map((key) => {
            const parsed = { at: key.at, light: key.light };
            Object.keys(key).forEach((k) => { if (k !== 'at' && k !== 'light') parsed[k] = rgb(key[k]); });
            return parsed;
        });

        const STORM = rgb('#2c4a40'), SNOWY = rgb('#dfeee6'), FOG = rgb('#b9d6c7'), WARM = rgb('#ffcf7a');
        const OCHRE = rgb('#d6bd84'), COPPER = rgb('#3f6f5d');

        let dist = 620;
        let dayT = 0.33;
        let weatherClock = 0, weatherIndex = 0;
        const weather = { cloud: 0.15, rain: 0, snow: 0, fog: 0, rainbow: 0 };
        let snowCover = 0;
        let intro = 0;
        let clock = 0;

        function paletteAt(t) {
            let i = 0;
            while (i < PALETTE.length - 2 && PALETTE[i + 1].at <= t) i++;
            const a = PALETTE[i], b = PALETTE[i + 1];
            const k = smooth((t - a.at) / (b.at - a.at));
            const out = { light: lerp(a.light, b.light, k) };
            Object.keys(a).forEach((key) => {
                if (key !== 'at' && key !== 'light') out[key] = mixRgb(a[key], b[key], k);
            });
            const gloom = weather.cloud * 0.28 + weather.rain * 0.3 + weather.snow * 0.1;
            ['top', 'bottom', 'far', 'water'].forEach((key) => { out[key] = mixRgb(out[key], mixRgb(STORM, out[key], 0.35 + (1 - out.light) * 0.5), gloom); });
            out.cloud = mixRgb(out.cloud, mixRgb(STORM, out.cloud, 0.45), weather.rain * 0.8);
            const cover = snowCover * (0.35 + out.light * 0.5);
            out.forest = mixRgb(out.forest, SNOWY, cover * 0.4);
            out.mountain = mixRgb(out.mountain, SNOWY, cover * 0.75);
            out.far = mixRgb(out.far, SNOWY, cover * 0.6);
            out.meadow = mixRgb(out.meadow, SNOWY, cover * 0.95);
            out.ground = mixRgb(out.ground, SNOWY, cover * 0.95);
            out.road = mixRgb(out.road, SNOWY, cover * 0.28);
            out.water = mixRgb(out.water, SNOWY, cover * 0.35);
            return out;
        }

        function drawSky(c, view, pal, horizon) {
            const gradient = c.createLinearGradient(0, 0, 0, horizon);
            gradient.addColorStop(0, css(pal.top));
            gradient.addColorStop(1, css(pal.bottom));
            c.fillStyle = gradient;
            c.fillRect(0, 0, view.w, horizon + 4);

            const night = 1 - clamp(pal.light * 2.2);
            if (night > 0.02) {
                for (let i = 0; i < 110; i++) {
                    const twinkle = 0.45 + Math.sin(clock * (1 + hash(i)) + i) * 0.35;
                    c.fillStyle = `rgba(226,245,235,${night * twinkle * (1 - weather.cloud * 0.8)})`;
                    disc(c, hash(i + 5) * view.w, hash(i + 77) * horizon * 0.82, 0.6 + hash(i + 2) * 0.9);
                }
            }

            // Słońce i księżyc wędrują po łuku nad horyzontem
            const sunT = (dayT - 0.19) / 0.68;
            const span = view.w * 0.9;
            if (sunT > -0.05 && sunT < 1.05) {
                const x = view.w * 0.05 + sunT * span;
                const y = horizon + 30 - Math.sin(clamp(sunT) * Math.PI) * horizon * 0.82;
                const warm = 1 - Math.sin(clamp(sunT) * Math.PI);
                const color = mixRgb(rgb('#fff8d6'), rgb('#ffb65c'), warm);
                const veil = (1 - weather.cloud * 0.55) * (view.mobile ? 0.3 : 1); // Na telefonie słońce jest pod tekstem
                const halo = c.createRadialGradient(x, y, 4, x, y, 170);
                halo.addColorStop(0, css(color, 0.6 * veil));
                halo.addColorStop(1, css(color, 0));
                c.fillStyle = halo;
                c.fillRect(x - 170, y - 170, 340, 340);
                c.fillStyle = css(color, 0.95 * veil);
                disc(c, x, y, 28);
            }
            const moonT = mod(dayT + 0.1, 1) / 0.28;
            if (moonT < 1) {
                const x = view.w * 0.12 + moonT * view.w * 0.76;
                const y = horizon * 0.72 - Math.sin(moonT * Math.PI) * horizon * 0.55;
                const shine = smooth(moonT * 6) * smooth((1 - moonT) * 6) * (1 - weather.cloud * 0.6);
                c.fillStyle = `rgba(233,245,236,${shine})`;
                c.save();
                c.shadowColor = `rgba(233,245,236,${shine * 0.8})`;
                c.shadowBlur = 26;
                c.beginPath();
                c.arc(x, y, 20, -1.1, 1.9);
                c.quadraticCurveTo(x + 2, y + 2, x + Math.cos(-1.1) * 20, y + Math.sin(-1.1) * 20);
                c.fill();
                c.restore();
            }

            if (weather.rainbow > 0.02 && pal.light > 0.4) {
                const alpha = weather.rainbow * pal.light * 0.26;
                ['#f87171', '#fbbf24', '#fde68a', '#86efac', '#7dd3fc', '#a5b4fc'].forEach((color, i) => {
                    c.beginPath();
                    c.arc(view.w * 0.7, horizon + 30, horizon * 0.7 - i * 9, Math.PI, 0);
                    const [r, g, b] = rgb(color);
                    c.strokeStyle = `rgba(${r},${g},${b},${alpha})`;
                    c.lineWidth = 9;
                    c.stroke();
                });
            }
        }

        function drawClouds(c, view, pal, horizon) {
            for (let i = 0; i < 9; i++) {
                const threshold = i < 3 ? 0 : (i - 2) / 7;
                const alpha = smooth((weather.cloud - threshold * 0.8) / 0.25);
                if (alpha <= 0) continue;
                const span = view.w + 520;
                const x = mod(hash(i) * span - clock * (5 + hash(i + 3) * 8) - dist * 0.03, span) - 260;
                const y = horizon * (0.07 + hash(i + 11) * 0.24); // Nad tytułem panelu, by nie osłabiać kontrastu tekstu
                const size = 0.7 + hash(i + 23) * 0.65 + weather.rain * 0.25;
                c.fillStyle = css(pal.cloud, alpha * (0.34 + pal.light * 0.3));
                puff(c, x, y, size, i);
            }
        }

        function drawRidge(c, view, horizon, color, offset, height, freq, seed) {
            c.fillStyle = css(color);
            c.beginPath();
            c.moveTo(-10, horizon + 6);
            for (let x = -10; x <= view.w + 14; x += 9) {
                const wx = (x + offset) * freq;
                const peak = 1 - Math.abs(Math.sin(wx + seed));
                const jag = 1 - Math.abs(Math.sin(wx * 2.7 + seed * 2));
                const fine = Math.sin(wx * 9.1 + seed) * 0.05;
                c.lineTo(x, horizon - height * (0.28 + peak * 0.62 + jag * 0.16 + fine));
            }
            c.lineTo(view.w + 14, horizon + 6);
            c.closePath();
            c.fill();
        }

        function woodsDensity(wx) {
            if (wx > LAKE_L - 150 && wx < LAKE_R + 150) return 0;
            if (wx > CHURCH_X - 160 && wx < CHURCH_X + 260) return 0;
            if (wx > CHURCH_X - 520 && wx < CHURCH_X + 640) return 0.55; // Park
            if (wx > CHURCH_X + 640 && wx < LAKE_L - 150) return 0.14; // Łąki
            return 1;
        }

        function drawTree(c, x, base, h, round, color, shade) {
            if (round) {
                c.fillStyle = css(shade);
                c.fillRect(x - 2.5, base - h * 0.4, 5, h * 0.4);
                c.fillStyle = css(color);
                disc(c, x, base - h * 0.62, h * 0.36);
                disc(c, x - h * 0.2, base - h * 0.48, h * 0.25);
                disc(c, x + h * 0.21, base - h * 0.5, h * 0.26);
                return;
            }
            c.fillStyle = css(color);
            for (let tier = 0; tier < 3; tier++) {
                const width = h * (0.32 - tier * 0.07);
                const y = base - h * 0.14 - tier * h * 0.26;
                poly(c, [x - width, y, x + width, y, x, y - h * 0.42]);
                c.fill();
            }
        }

        function drawTrees(c, view, pal, scroll, base, row) {
            const first = Math.floor((scroll - 90) / TREE_STEP);
            const last = Math.ceil((scroll + view.w + 90) / TREE_STEP);
            const cycle = LOOP / TREE_STEP;
            const color = row === 0 ? mixRgb(pal.forest, pal.far, 0.55) : pal.forest;
            const shade = mixRgb(pal.forest, [0, 0, 0], 0.25);
            for (let i = first; i <= last; i++) {
                const id = mod(i, cycle) + row * 1000;
                const wx = mod(i * TREE_STEP, LOOP);
                const x = i * TREE_STEP - scroll + (hash(id) - 0.5) * 22;
                if (row === 0) {
                    drawTree(c, x, base, 24 + hash(id + 1) * 22, hash(id + 2) > 0.65, color, shade);
                    continue;
                }
                const density = woodsDensity(wx);
                if (hash(id + 3) > density) continue;
                const park = density > 0.2 && density < 0.9;
                const h = (park ? 88 : 62) + hash(id + 4) * 46;
                const tone = mixRgb(color, pal.meadow, hash(id + 6) * 0.35);
                drawTree(c, x, base + 2 + hash(id + 5) * 6, h, park || hash(id + 2) > 0.62, tone, shade);
            }
        }

        function drawChurch(c, x, base, pal) {
            const wall = mixRgb(mixRgb(OCHRE, pal.stone, 0.45), pal.forest, 0.1);
            const side = mixRgb(wall, pal.forest, 0.28);
            const trim = mixRgb(pal.stone, wall, 0.2);
            const cap = mixRgb(COPPER, pal.forest, 0.35);
            const glass = (1 - clamp(pal.light * 2)) > 0.3 ? css(WARM, 0.9) : css(mixRgb(pal.forest, [0, 0, 0], 0.35));

            // Nawa za fasadą
            c.fillStyle = css(side);
            c.fillRect(x + 50, base - 92, 170, 92);
            c.fillStyle = css(cap);
            poly(c, [x + 40, base - 92, x + 224, base - 92, x + 208, base - 122, x + 40, base - 122]);
            c.fill();
            c.fillStyle = glass;
            for (let i = 0; i < 4; i++) {
                arched(c, x + 78 + i * 36, base - 74, 15, 42);
                c.fill();
            }

            // Fasada z dwiema wieżami
            const tower = (cx) => {
                c.fillStyle = css(wall);
                c.fillRect(cx - 26, base - 150, 52, 150);
                c.fillRect(cx - 22, base - 212, 44, 62);
                c.fillStyle = css(trim);
                c.fillRect(cx - 28, base - 153, 56, 6);
                c.fillRect(cx - 24, base - 216, 48, 5);
                c.fillRect(cx - 28, base - 78, 56, 4);
                c.fillStyle = glass;
                arched(c, cx - 8, base - 202, 16, 42);
                c.fill();
                arched(c, cx - 8, base - 134, 16, 40);
                c.fill();
                arched(c, cx - 8, base - 60, 16, 38);
                c.fill();
                // Barokowy hełm z latarnią i krzyżem
                c.fillStyle = css(cap);
                c.beginPath();
                c.moveTo(cx - 23, base - 216);
                c.quadraticCurveTo(cx - 20, base - 236, cx - 7, base - 244);
                c.lineTo(cx + 7, base - 244);
                c.quadraticCurveTo(cx + 20, base - 236, cx + 23, base - 216);
                c.closePath();
                c.fill();
                c.fillStyle = css(wall);
                c.fillRect(cx - 6, base - 256, 12, 12);
                c.fillStyle = css(cap);
                c.beginPath();
                c.moveTo(cx - 8, base - 256);
                c.quadraticCurveTo(cx, base - 272, cx + 8, base - 256);
                c.closePath();
                c.fill();
                c.strokeStyle = css(trim);
                c.lineWidth = 1.6;
                line(c, cx, base - 268, cx, base - 286);
                line(c, cx - 4, base - 280, cx + 4, base - 280);
            };
            c.fillStyle = css(wall);
            c.fillRect(x - 26, base - 118, 52, 118);
            c.fillStyle = css(trim);
            poly(c, [x - 30, base - 118, x + 30, base - 118, x, base - 146]);
            c.fill();
            c.fillStyle = css(wall);
            poly(c, [x - 22, base - 121, x + 22, base - 121, x, base - 140]);
            c.fill();
            tower(x - 50);
            tower(x + 50);
            c.fillStyle = css(trim);
            c.fillRect(x - 15, base - 46, 30, 46);
            c.fillStyle = css(mixRgb(pal.forest, [0, 0, 0], 0.45));
            arched(c, x - 10, base - 38, 20, 38);
            c.fill();
            c.fillStyle = glass;
            disc(c, x, base - 86, 10);
            c.fillStyle = css(trim);
            c.fillRect(x - 28, base - 62, 56, 4);
        }

        function drawHouse(c, x, base, w, h, pal, seed) {
            const wall = mixRgb(pal.stone, pal.forest, 0.25);
            c.fillStyle = css(wall);
            c.fillRect(x, base - h, w, h);
            c.fillStyle = css(mixRgb(pal.forest, [0, 0, 0], 0.15));
            poly(c, [x - 6, base - h, x + w + 6, base - h, x + w / 2, base - h - h * 0.62]);
            c.fill();
            const lit = (1 - clamp(pal.light * 2)) > 0.3 && hash(seed) > 0.2;
            c.fillStyle = lit ? css(WARM, 0.95) : css(mixRgb(pal.forest, [0, 0, 0], 0.3));
            c.fillRect(x + w * 0.18, base - h * 0.68, w * 0.22, h * 0.32);
            c.fillRect(x + w * 0.6, base - h * 0.68, w * 0.22, h * 0.32);
        }

        function deckY(x, y0) {
            const k = (x - BRIDGE_L) / (BRIDGE_R - BRIDGE_L);
            return y0 - Math.sin(k * Math.PI) * 15;
        }

        // Most w Zegrzu: długa, biała belka z płytkimi łukami i latarniami
        function drawBridge(c, offset, y0, waterline, pal, reflection) {
            const SPANS = 7;
            const spanW = (BRIDGE_R - BRIDGE_L) / SPANS;
            const body = mixRgb(pal.stone, pal.bottom, reflection ? 0.45 : 0.1);
            if (!reflection) {
                // Nasypy, na których most opiera się o brzegi
                c.fillStyle = css(pal.meadow);
                poly(c, [BRIDGE_L - offset + 16, y0 + 9, BRIDGE_L - offset - 100, waterline + 6, BRIDGE_L - offset + 66, waterline + 6]);
                c.fill();
                poly(c, [BRIDGE_R - offset - 16, y0 + 9, BRIDGE_R - offset + 100, waterline + 6, BRIDGE_R - offset - 66, waterline + 6]);
                c.fill();
            }
            c.fillStyle = css(body, reflection ? 0.32 : 1);
            c.strokeStyle = css(body, reflection ? 0.32 : 1);
            // Filary
            for (let i = 1; i < SPANS; i++) {
                const wx = BRIDGE_L + i * spanW;
                const top = deckY(wx, y0) + 9;
                c.fillRect(wx - offset - 8, top, 4.5, waterline - top);
                c.fillRect(wx - offset + 3.5, top, 4.5, waterline - top);
            }
            // Pomost z łukami
            c.beginPath();
            c.moveTo(BRIDGE_L - offset, deckY(BRIDGE_L, y0));
            for (let wx = BRIDGE_L; wx <= BRIDGE_R; wx += 20) c.lineTo(wx - offset, deckY(wx, y0));
            c.lineTo(BRIDGE_R - offset, deckY(BRIDGE_R, y0));
            for (let i = SPANS - 1; i >= 0; i--) {
                const a = BRIDGE_L + i * spanW, b = a + spanW;
                const mid = (a + b) / 2;
                c.lineTo(b - offset, deckY(b, y0) + 17);
                c.quadraticCurveTo(mid - offset, deckY(mid, y0) + 2, a - offset, deckY(a, y0) + 17);
            }
            c.closePath();
            c.fill();
            if (reflection) return;

            // Bariera i latarnie
            c.strokeStyle = css(mixRgb(body, pal.forest, 0.5));
            c.lineWidth = 1;
            c.beginPath();
            for (let wx = BRIDGE_L; wx <= BRIDGE_R; wx += 20) {
                const y = deckY(wx, y0) - 4;
                if (wx === BRIDGE_L) c.moveTo(wx - offset, y);
                else c.lineTo(wx - offset, y);
            }
            c.stroke();
            const dark = 1 - clamp(pal.light * 2.2);
            for (let wx = BRIDGE_L + 60; wx < BRIDGE_R; wx += 124) {
                const x = wx - offset, y = deckY(wx, y0);
                c.strokeStyle = css(mixRgb(body, pal.forest, 0.4));
                c.lineWidth = 1.2;
                line(c, x, y, x, y - 22);
                line(c, x, y - 22, x + 6, y - 23);
                if (dark > 0.1) {
                    c.fillStyle = css(WARM, dark * 0.22);
                    disc(c, x + 6, y - 22, 11);
                    c.fillStyle = css(WARM, dark);
                    disc(c, x + 6, y - 22, 2);
                }
            }
            // Auta na moście
            for (let i = 0; i < 4; i++) {
                const k = mod(clock * 0.028 * (i % 2 ? 1 : -1) + hash(i + 40), 1);
                const wx = lerp(BRIDGE_L, BRIDGE_R, k);
                const x = wx - offset, y = deckY(wx, y0);
                c.fillStyle = css(mixRgb(pal.forest, [0, 0, 0], 0.2));
                roundedRect(c, x - 8, y - 8, 16, 7, 2);
                c.fill();
                if (dark > 0.1) {
                    c.fillStyle = i % 2 ? css(WARM, dark) : `rgba(248,113,113,${dark})`;
                    disc(c, x + (i % 2 ? 8 : -8), y - 4, 1.4);
                }
            }
        }

        function drawLake(c, view, pal, offset, horizon, bottom) {
            const l = LAKE_L - offset, r = LAKE_R - offset;
            if (r < -120 || l > view.w + 120) return;
            const gradient = c.createLinearGradient(0, horizon, 0, bottom);
            gradient.addColorStop(0, css(mixRgb(pal.water, pal.bottom, 0.45)));
            gradient.addColorStop(1, css(pal.water));
            c.fillStyle = gradient;
            c.beginPath();
            c.moveTo(l + 40, horizon);
            c.lineTo(r - 40, horizon);
            c.quadraticCurveTo(r + 26, (horizon + bottom) / 2, r - 70, bottom);
            c.lineTo(l + 70, bottom);
            c.quadraticCurveTo(l - 26, (horizon + bottom) / 2, l + 40, horizon);
            c.closePath();
            c.fill();

            const waterline = horizon + 32;
            c.save();
            c.clip();
            // Odbicie mostu w wodzie
            c.save();
            c.translate(0, waterline * 2);
            c.scale(1, -1);
            drawBridge(c, offset, horizon - 26, waterline, pal, true);
            c.restore();
            // Zmarszczki na wodzie
            const glint = mixRgb(pal.stone, pal.bottom, 0.3);
            c.strokeStyle = css(glint, 0.3 + weather.rain * 0.2);
            c.lineWidth = 1;
            for (let i = 0; i < 44; i++) {
                const x = lerp(l + 30, r - 30, hash(i + 90));
                const y = lerp(horizon + 4, bottom - 3, hash(i + 130));
                const len = 12 + hash(i + 170) * 26;
                const shift = Math.sin(clock * (0.6 + hash(i)) + i) * 7;
                line(c, x + shift, y, x + shift + len, y);
            }
            c.restore();

            drawBridge(c, offset, horizon - 26, waterline, pal, false);

            // Żaglówki: Zalew Zegrzyński słynie z żeglarstwa
            [[0.1, 0.72, 1], [0.34, 0.86, 1.25], [0.62, 0.66, 0.85], [0.88, 0.82, 1.1]].forEach(([k, depth, size], i) => {
                const drift = Math.sin(clock * 0.11 + i * 2) * 42;
                const x = lerp(l + 90, r - 90, k) + drift;
                const y = lerp(horizon, bottom, depth) + Math.sin(clock * 1.3 + i) * 1.2;
                const sail = mixRgb(pal.stone, pal.bottom, 0.08);
                c.fillStyle = css(mixRgb(pal.forest, [0, 0, 0], 0.3));
                poly(c, [x - 13 * size, y - 4 * size, x + 15 * size, y - 4 * size, x + 9 * size, y, x - 9 * size, y]);
                c.fill();
                c.fillStyle = css(sail);
                poly(c, [x + 1 * size, y - 6 * size, x + 1 * size, y - 36 * size, x + 15 * size, y - 6 * size]);
                c.fill();
                c.fillStyle = css(mixRgb(sail, pal.forest, 0.2));
                poly(c, [x - 1 * size, y - 6 * size, x - 1 * size, y - 30 * size, x - 11 * size, y - 6 * size]);
                c.fill();
                c.fillStyle = css(sail, 0.18);
                poly(c, [x + 1 * size, y + 1, x + 1 * size, y + 24 * size, x + 14 * size, y + 1]);
                c.fill();
            });
        }

        function drawStreetLamp(c, x, base, pal) {
            const dark = 1 - clamp(pal.light * 2.2);
            c.strokeStyle = css(mixRgb(pal.road, pal.stone, 0.25));
            c.lineWidth = 2.5;
            line(c, x, base, x, base - 84);
            c.beginPath();
            c.moveTo(x, base - 84);
            c.quadraticCurveTo(x, base - 94, x + 16, base - 92);
            c.stroke();
            if (dark > 0.05) {
                const glow = c.createRadialGradient(x + 16, base - 90, 2, x + 16, base - 90, 70);
                glow.addColorStop(0, css(WARM, 0.55 * dark));
                glow.addColorStop(1, css(WARM, 0));
                c.fillStyle = glow;
                c.fillRect(x - 54, base - 160, 140, 140);
                c.fillStyle = css(WARM, dark);
                disc(c, x + 16, base - 90, 3);
            }
        }

        function drawSign(c, x, base, text, pal) {
            setFont(c, 800, 12);
            const w = textWidth(c, text) + 18;
            c.strokeStyle = css(mixRgb(pal.road, pal.stone, 0.3));
            c.lineWidth = 3;
            line(c, x, base, x, base - 46);
            c.fillStyle = '#f8fafc';
            c.strokeStyle = '#0f172a';
            c.lineWidth = 1.5;
            roundedRect(c, x - w / 2, base - 66, w, 24, 3);
            c.fill();
            c.stroke();
            c.fillStyle = '#0f172a';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(text, x, base - 53);
        }

        function drawRoad(c, view, pal, roadTop, roadBottom) {
            c.fillStyle = css(pal.ground);
            c.fillRect(0, roadTop - 8, view.w, view.h - roadTop + 8);

            c.fillStyle = css(pal.road);
            c.fillRect(0, roadTop, view.w, roadBottom - roadTop);
            c.fillStyle = css(mixRgb(pal.road, pal.stone, 0.4));
            c.fillRect(0, roadTop, view.w, 2.5);
            c.fillRect(0, roadBottom - 2.5, view.w, 2.5);
            const mid = (roadTop + roadBottom) / 2;
            c.fillStyle = css(mixRgb(pal.stone, pal.road, 0.2));
            const dash = 74;
            for (let x = -mod(dist, dash); x < view.w; x += dash) c.fillRect(x, mid - 1.5, 36, 3);

            // Kępy trawy na poboczu
            c.strokeStyle = css(mixRgb(pal.ground, pal.meadow, 0.8));
            c.lineWidth = 1.5;
            const first = Math.floor((dist - 20) / 26);
            const last = Math.ceil((dist + view.w + 20) / 26);
            c.beginPath();
            for (let i = first; i <= last; i++) {
                const x = i * 26 - dist;
                const y = roadBottom + 8 + hash(i) * (view.h - roadBottom - 8);
                c.moveTo(x, y);
                c.lineTo(x - 3, y - 6 - hash(i + 2) * 6);
                c.moveTo(x, y);
                c.lineTo(x + 4, y - 5 - hash(i + 4) * 6);
            }
            c.stroke();

            // Mokra jezdnia odbija światło
            if (weather.rain > 0.1) {
                c.fillStyle = `rgba(190,225,210,${weather.rain * 0.07})`;
                c.fillRect(0, roadTop, view.w, roadBottom - roadTop);
            }
        }

        // Dwuczłonowa kinematyka odwrotna: kolano i łokieć
        function joint(ax, ay, bx, by, l1, l2, bend) {
            const dx = bx - ax, dy = by - ay;
            const d = Math.min(Math.hypot(dx, dy), l1 + l2 - 0.5);
            const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
            const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
            const ux = dx / (Math.hypot(dx, dy) || 1), uy = dy / (Math.hypot(dx, dy) || 1);
            return [ax + ux * a - uy * h * bend, ay + uy * a + ux * h * bend];
        }

        function drawWheel(c, x, y, r, angle, pal) {
            c.strokeStyle = 'rgba(203,213,225,.75)';
            c.lineWidth = 0.9;
            for (let i = 0; i < 8; i++) {
                const a = angle + i * Math.PI / 4;
                line(c, x, y, x + Math.cos(a) * (r - 3), y + Math.sin(a) * (r - 3));
            }
            c.strokeStyle = '#0b0f0e';
            c.lineWidth = 4.2;
            c.beginPath();
            c.arc(x, y, r - 1, 0, Math.PI * 2);
            c.stroke();
            c.strokeStyle = css(mixRgb(pal.stone, [148, 163, 184], 0.5));
            c.lineWidth = 1.3;
            c.beginPath();
            c.arc(x, y, r - 3.8, 0, Math.PI * 2);
            c.stroke();
            c.fillStyle = '#334155';
            disc(c, x, y, 2.6);
        }

        // Czarny Urban Arrow Family: długi rozstaw osi, małe przednie koło i skrzynia EPP z napisem na boku
        function drawCyclist(c, x, ground, pal, bikeScale) {
            const dark = 1 - clamp(pal.light * 2.2);
            const crank = dist / 31 / 2.6;
            const bob = Math.sin(crank * 2) * 0.9;

            c.save();
            c.translate(x, ground);
            c.scale(bikeScale, bikeScale);
            c.translate(-x, -ground);

            // Światło przedniej lampki
            if (dark > 0.05) {
                const cone = c.createLinearGradient(x + 116, 0, x + 380, 0);
                cone.addColorStop(0, `rgba(255,244,200,${dark * 0.5})`);
                cone.addColorStop(1, 'rgba(255,244,200,0)');
                c.fillStyle = cone;
                poly(c, [x + 118, ground - 72, x + 390, ground - 32, x + 390, ground + 26, x + 118, ground - 66]);
                c.fill();
            }

            // Cień
            c.fillStyle = `rgba(0,0,0,${0.12 + pal.light * 0.14})`;
            c.beginPath();
            c.ellipse(x + 8, ground + 3, 156, 6, 0, 0, Math.PI * 2);
            c.fill();

            const rearR = 31, frontR = 24;
            const rear = [x - 112, ground - rearR], front = [x + 128, ground - frontR];
            const bb = [x - 62, ground - 29];
            const seat = [x - 78, ground - 90];
            const seatCluster = [x - 73, ground - 70];
            const head = [x + 112, ground - 64];
            const hip = [seat[0] + 1, seat[1] - 7 + bob * 0.3];
            const shoulder = [x - 50, ground - 146 + bob];
            const grip = [x - 4, ground - 112];
            const pedal = (angle) => [bb[0] + Math.cos(angle) * 13, bb[1] + Math.sin(angle) * 13];

            const drawLeg = (angle, color, shoe) => {
                const foot = pedal(angle);
                const knee = joint(hip[0], hip[1], foot[0], foot[1], 40, 41, -1);
                c.strokeStyle = color;
                c.lineCap = 'round';
                c.lineWidth = 9.5;
                line(c, hip[0], hip[1], knee[0], knee[1]);
                c.lineWidth = 7.2;
                line(c, knee[0], knee[1], foot[0], foot[1] - 3);
                c.fillStyle = shoe;
                roundedRect(c, foot[0] - 6, foot[1] - 4, 16, 5.5, 2.4);
                c.fill();
                c.lineCap = 'butt';
            };

            // Czarne rury z jasną krawędzią, aby rower nie ginął na ciemnej drodze
            const tube = (width, trace) => {
                c.lineCap = 'round';
                c.lineJoin = 'round';
                c.strokeStyle = 'rgba(203,213,225,.38)';
                c.lineWidth = width + 1.6;
                c.beginPath();
                trace();
                c.stroke();
                c.strokeStyle = '#111316';
                c.lineWidth = width;
                c.beginPath();
                trace();
                c.stroke();
                c.lineCap = 'butt';
                c.lineJoin = 'miter';
            };

            drawLeg(crank + Math.PI, '#1e293b', '#0f172a');
            drawWheel(c, rear[0], rear[1], rearR, dist / rearR, pal);
            drawWheel(c, front[0], front[1], frontR, dist / frontR, pal);

            // Błotniki
            c.strokeStyle = '#111316';
            c.lineWidth = 2.6;
            c.beginPath();
            c.arc(rear[0], rear[1], rearR + 3.5, Math.PI * 1.02, Math.PI * 1.85);
            c.stroke();
            c.beginPath();
            c.arc(front[0], front[1], frontR + 3.5, Math.PI * 1.15, Math.PI * 1.95);
            c.stroke();

            // Rama: niska belka pod skrzynią, tylny trójkąt i widelec
            tube(5.5, () => {
                c.moveTo(head[0], head[1]);
                c.quadraticCurveTo(x + 96, ground - 11, x + 60, ground - 11);
                c.lineTo(x - 30, ground - 11);
                c.quadraticCurveTo(x - 52, ground - 12, bb[0], bb[1]);
                c.lineTo(seat[0] + 2, seat[1] + 6);
            });
            tube(3.2, () => {
                c.moveTo(bb[0], bb[1]);
                c.lineTo(rear[0], rear[1]);
                c.lineTo(seatCluster[0], seatCluster[1]);
            });
            tube(4, () => {
                c.moveTo(head[0], head[1] - 4);
                c.lineTo(front[0], front[1]);
            });

            // Silnik centralny, korba i łańcuch
            c.fillStyle = '#1a1d21';
            roundedRect(c, bb[0] - 11, bb[1] - 11, 21, 20, 5);
            c.fill();
            c.strokeStyle = '#475569';
            c.lineWidth = 1.2;
            line(c, bb[0], bb[1] - 8, rear[0], rear[1] - 4);
            line(c, bb[0], bb[1] + 8, rear[0], rear[1] + 4);
            const crankEnd = pedal(crank);
            c.strokeStyle = '#64748b';
            c.lineWidth = 2.6;
            c.lineCap = 'round';
            line(c, bb[0], bb[1], crankEnd[0], crankEnd[1]);
            c.lineCap = 'butt';

            // Siodełko
            c.fillStyle = '#0a0b0d';
            roundedRect(c, seat[0] - 13, seat[1] - 3, 27, 5.5, 2.7);
            c.fill();

            // Kolumna kierownicy
            tube(4, () => {
                c.moveTo(x - 22, ground - 70);
                c.lineTo(x - 14, ground - 112);
                c.lineTo(x + 1, ground - 113);
            });

            // Skrzynia z pianki EPP
            const shell = c.createLinearGradient(0, ground - 82, 0, ground - 17);
            shell.addColorStop(0, '#26292d');
            shell.addColorStop(0.3, '#16181b');
            shell.addColorStop(1, '#0b0c0e');
            c.fillStyle = shell;
            c.beginPath();
            c.moveTo(x - 26, ground - 82);
            c.lineTo(x + 92, ground - 70);
            c.quadraticCurveTo(x + 98, ground - 69, x + 97, ground - 63);
            c.lineTo(x + 86, ground - 26);
            c.quadraticCurveTo(x + 83, ground - 17, x + 72, ground - 17);
            c.lineTo(x - 12, ground - 17);
            c.quadraticCurveTo(x - 24, ground - 17, x - 26, ground - 29);
            c.closePath();
            c.fill();
            c.strokeStyle = 'rgba(203,213,225,.28)';
            c.lineWidth = 1;
            c.stroke();
            // Górna krawędź skrzyni
            c.strokeStyle = '#3a4046';
            c.lineWidth = 2.4;
            line(c, x - 25, ground - 80.5, x + 92, ground - 68.5);
            // Biały napis w miejscu logo producenta
            c.fillStyle = '#ffffff';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            setFont(c, 700, 12.5);
            c.fillText('cargo.mleczki.pl', x + 34, ground - 42);

            drawLeg(crank, '#334155', '#1e293b');

            // Żółta kurtka
            const jacket = c.createLinearGradient(hip[0], hip[1], shoulder[0], shoulder[1]);
            jacket.addColorStop(0, '#eab308');
            jacket.addColorStop(1, '#fde047');
            c.fillStyle = jacket;
            c.beginPath();
            c.moveTo(hip[0] - 11, hip[1] + 4);
            c.quadraticCurveTo(hip[0] - 12, shoulder[1] + 12, shoulder[0] - 7, shoulder[1] - 10);
            c.quadraticCurveTo(shoulder[0] + 10, shoulder[1] - 10, shoulder[0] + 11, shoulder[1] + 6);
            c.lineTo(hip[0] + 13, hip[1] + 5);
            c.closePath();
            c.fill();
            // Pas odblaskowy
            c.strokeStyle = 'rgba(241,245,249,.9)';
            c.lineWidth = 3;
            line(c, hip[0] - 7, hip[1] - 15, hip[0] + 17, hip[1] - 11);
            // Szyja i głowa
            const headCenter = [shoulder[0] + 12, shoulder[1] - 19 + bob * 0.3];
            c.strokeStyle = '#eab38a';
            c.lineWidth = 7;
            line(c, shoulder[0] + 3, shoulder[1] - 7, headCenter[0] - 2, headCenter[1] + 5);
            c.fillStyle = '#f1c7a0';
            disc(c, headCenter[0], headCenter[1], 10.5);
            c.fillStyle = '#d9a67f';
            disc(c, headCenter[0] + 9.5, headCenter[1] + 2, 2);
            // Biały kask
            c.fillStyle = '#ffffff';
            c.beginPath();
            c.moveTo(headCenter[0] - 13, headCenter[1] + 0.5);
            c.quadraticCurveTo(headCenter[0] - 13, headCenter[1] - 15, headCenter[0] + 2, headCenter[1] - 14.5);
            c.quadraticCurveTo(headCenter[0] + 12, headCenter[1] - 13, headCenter[0] + 14.5, headCenter[1] - 3.5);
            c.lineTo(headCenter[0] + 7, headCenter[1] - 3.5);
            c.lineTo(headCenter[0] - 13, headCenter[1] + 0.5);
            c.closePath();
            c.fill();
            c.strokeStyle = 'rgba(100,116,139,.7)';
            c.lineWidth = 1.1;
            line(c, headCenter[0] - 7, headCenter[1] - 8, headCenter[0] - 2, headCenter[1] - 11);
            line(c, headCenter[0] - 1, headCenter[1] - 6.5, headCenter[0] + 4, headCenter[1] - 10.5);
            line(c, headCenter[0] + 5, headCenter[1] - 5.5, headCenter[0] + 9, headCenter[1] - 8.5);
            c.strokeStyle = 'rgba(15,23,42,.7)';
            c.lineWidth = 1;
            line(c, headCenter[0] - 4, headCenter[1] - 1, headCenter[0] - 2, headCenter[1] + 10);
            c.fillStyle = '#1e293b';
            disc(c, headCenter[0] + 6, headCenter[1] - 0.5, 1.2);
            // Rękaw i dłoń
            const elbow = joint(shoulder[0] + 1, shoulder[1] + 1, grip[0], grip[1], 31, 31, 1);
            c.strokeStyle = '#facc15';
            c.lineCap = 'round';
            c.lineWidth = 8.5;
            line(c, shoulder[0] + 1, shoulder[1] + 1, elbow[0], elbow[1]);
            c.lineWidth = 7;
            line(c, elbow[0], elbow[1], grip[0] - 2, grip[1] - 1);
            c.lineCap = 'butt';
            c.fillStyle = '#1e293b';
            disc(c, grip[0], grip[1], 4);
            // Lampki
            c.fillStyle = dark > 0.05 ? '#fff7cc' : '#cbd5e1';
            disc(c, x + 117, ground - 70, 3);
            const blink = Math.sin(clock * 8) > 0 ? 1 : 0.35;
            c.fillStyle = `rgba(248,113,113,${0.45 + dark * 0.55 * blink})`;
            disc(c, rear[0] - 30, rear[1] - 14, 2.6);
            c.restore();
        }

        function drawPrecipitation(c, view) {
            if (weather.rain > 0.02) {
                c.strokeStyle = `rgba(214,238,228,${0.32 * weather.rain + 0.1})`;
                c.lineWidth = 1.1;
                c.beginPath();
                const count = Math.floor(190 * weather.rain);
                for (let i = 0; i < count; i++) {
                    const speed = 620 + hash(i + 1) * 260;
                    const x = mod(hash(i + 2) * (view.w + 200) - clock * speed * 0.42 - dist * 0.2, view.w + 200) - 60;
                    const y = mod(hash(i + 3) * view.h + clock * speed, view.h + 40) - 20;
                    c.moveTo(x, y);
                    c.lineTo(x - 7, y + 17);
                }
                c.stroke();
            }
            if (weather.snow > 0.02) {
                const count = Math.floor(150 * weather.snow);
                for (let i = 0; i < count; i++) {
                    const fall = 30 + hash(i + 11) * 46;
                    const sway = Math.sin(clock * (0.7 + hash(i + 5)) + i) * 14;
                    const x = mod(hash(i + 12) * (view.w + 80) - clock * 26 - dist * 0.16 + sway, view.w + 80) - 40;
                    const y = mod(hash(i + 13) * view.h + clock * fall, view.h + 20) - 10;
                    c.fillStyle = `rgba(245,252,248,${0.45 + hash(i + 14) * 0.45})`;
                    disc(c, x, y, 1.1 + hash(i + 15) * 1.9);
                }
            }
        }

        return {
            enter() { intro = 0; },
            prepare() { intro = 1; },
            update(dt) {
                clock += dt;
                intro = Math.min(1, intro + dt / 2.4);
                dist += SPEED * dt;
                dayT = mod(dayT + dt / DAY_SECONDS, 1);
                weatherClock += dt;
                if (weatherClock > WEATHER[weatherIndex][1]) {
                    weatherClock = 0;
                    weatherIndex = (weatherIndex + 1) % WEATHER.length;
                }
                const target = INTENSITY[WEATHER[weatherIndex][0]];
                const rate = Math.min(1, dt * 0.55);
                Object.keys(weather).forEach((k) => { weather[k] += (target[k] - weather[k]) * rate; });
                snowCover = clamp(snowCover + (weather.snow > 0.55 ? dt / 10 : -dt / 14));
            },
            draw(c, view) {
                const pal = paletteAt(dayT);
                const horizon = view.h * 0.745;
                const roadTop = view.h * 0.862;
                const roadBottom = view.h * 0.952;
                const scroll = dist * PARALLAX_MID;
                const offset = scroll - LOOP * Math.floor((scroll + view.w + 400) / LOOP);

                drawSky(c, view, pal, horizon);
                drawClouds(c, view, pal, horizon);
                drawRidge(c, view, horizon, pal.far, dist * PARALLAX_FAR * 0.6, 270, 0.0031, 1.3);
                drawRidge(c, view, horizon, pal.mountain, dist * PARALLAX_FAR, 170, 0.0047, 4.1);
                if (weather.fog > 0.02) {
                    c.fillStyle = css(mixRgb(FOG, pal.bottom, 0.5), weather.fog * 0.45);
                    c.fillRect(0, 0, view.w, horizon);
                }
                drawTrees(c, view, pal, scroll, horizon + 4, 0);

                const meadow = c.createLinearGradient(0, horizon, 0, roadTop);
                meadow.addColorStop(0, css(mixRgb(pal.meadow, pal.far, 0.2)));
                meadow.addColorStop(1, css(pal.meadow));
                c.fillStyle = meadow;
                c.fillRect(0, horizon, view.w, roadTop - horizon);

                // Pętla pejzażu powtarza się, więc rysujemy też jej poprzednie okrążenie
                for (const shift of [offset, offset + LOOP]) {
                    drawLake(c, view, pal, shift, horizon + 3, roadTop - 7);
                    const churchX = CHURCH_X - shift;
                    if (churchX > -320 && churchX < view.w + 320) drawChurch(c, churchX, horizon + 26, pal);
                    [[CHURCH_X + 780, 42, 30, 1], [CHURCH_X + 850, 34, 26, 2], [CHURCH_X + 950, 46, 32, 3]].forEach(([wx, w, h, seed]) => {
                        const x = wx - shift;
                        if (x > -80 && x < view.w + 80) drawHouse(c, x, horizon + 24, w, h, pal, seed);
                    });
                }
                drawTrees(c, view, pal, scroll, horizon + 24, 1);

                if (weather.fog > 0.02) {
                    c.fillStyle = css(mixRgb(FOG, pal.bottom, 0.45), weather.fog * 0.34);
                    c.fillRect(0, horizon - 90, view.w, roadTop - horizon + 90);
                }

                drawRoad(c, view, pal, roadTop, roadBottom);

                // Latarnie i tablice jadą razem z drogą; tablice wyprzedzają swoje miejsca
                const lampStep = 620;
                for (let x = -mod(dist + 180, lampStep); x < view.w + 60; x += lampStep) drawStreetLamp(c, x, roadTop, pal);
                const period = LOOP / PARALLAX_MID;
                [['RADZYMIN', CHURCH_X - 220], ['ZEGRZE', LAKE_L - 180]].forEach(([text, wx]) => {
                    const x = mod(wx / PARALLAX_MID - dist, period);
                    if (x < view.w + 80) drawSign(c, x, roadTop - 1, text, pal);
                });

                const ground = (roadTop + roadBottom) / 2 + 20;
                const bikeScale = view.mobile ? 1.25 : 1; // Na telefonie napis na skrzyni musi być czytelny
                const targetX = clamp(lerp(view.left(ground), view.textL, 0.62), view.left(ground) + 150 * bikeScale, view.w);
                const riderX = lerp(view.left(ground) - 190 * bikeScale, targetX, smooth(intro));
                drawCyclist(c, riderX, ground, pal, bikeScale);
                drawPrecipitation(c, view);

                if (weather.fog > 0.02) {
                    const mist = c.createLinearGradient(0, roadTop - 70, 0, view.h);
                    mist.addColorStop(0, css(FOG, 0));
                    mist.addColorStop(0.45, css(FOG, weather.fog * 0.12));
                    mist.addColorStop(1, css(FOG, 0));
                    c.fillStyle = mist;
                    c.fillRect(0, roadTop - 70, view.w, view.h - roadTop + 70);
                }

                // Rzadka, łagodna błyskawica w czasie burzy
                if (weather.rain > 0.75) {
                    const slot = Math.floor(clock / 6.5);
                    const phase = clock - slot * 6.5;
                    if (hash(slot) > 0.45 && phase < 0.16) {
                        c.fillStyle = `rgba(232,245,238,${0.14 * (1 - phase / 0.16)})`;
                        c.fillRect(0, 0, view.w, view.h);
                    }
                }
            },
        };
    }

    // --- 4. Scena: pisma ze społecznej drukarki ---

    function createMailScene() {
        const SPAWN_EVERY = 1.75;
        const BUILDINGS = [
            { key: 'scene_b_city', width: 136, height: 112, type: 'city' },
            { key: 'scene_b_hospital', width: 108, height: 124, type: 'hospital' },
            { key: 'scene_b_police', width: 104, height: 92, type: 'police' },
            { key: 'scene_b_roads', width: 116, height: 84, type: 'roads' },
            { key: 'scene_b_school', width: 128, height: 96, type: 'school' },
            { key: 'scene_b_county', width: 112, height: 118, type: 'county' },
        ];
        // Kolejne etapy składania: każda figura ma te same wierzchołki, by płynnie się przekształcać
        const FOLDS = [
            [-23, -30, 0, -30, 23, -30, 23, 30, 0, 30, -23, 30],
            [-23, -8, 0, -30, 23, -8, 23, 30, 0, 30, -23, 30],
            [-13, 6, 0, -34, 13, 6, 9, 30, 0, 30, -9, 30],
            [-16, 20, 0, -30, 7, 16, 5, 17, 0, 9, -4, 17],
        ];
        const WHITE = rgb('#fffbeb');

        let clock = 0, spawnClock = 0, sent = 0;
        let sheets = [];
        const pulses = BUILDINGS.map(() => ({ flash: 0, stamp: 0 }));
        const layouts = new WeakMap();
        const backdrop = createBackdrop();

        function layout(view) {
            if (layouts.has(view)) return layouts.get(view);
            const ground = view.h * 0.905;
            const left = Math.max(view.left(ground), 0);
            const right = view.right(ground);
            const deskTop = ground - 74;
            // Biurko odsuwamy od ukośnej krawędzi panelu mierzonej na wysokości monitora
            const deskX = Math.max(left, view.left(deskTop - 110)) + (view.mobile ? 8 : 62);
            const deskW = 262;
            const slot = [deskX + 232, deskTop - 28];
            const start = slot[0] + 96;
            const avail = right - start - 14;
            const scale = view.mobile ? 0.66 : 1;
            const count = view.mobile ? 3 : clamp(Math.floor(avail / 138), 2, BUILDINGS.length);
            const gap = avail / count;
            const placed = BUILDINGS.slice(0, count).map((b, i) => ({
                ...b, index: i, scale, x: start + gap * (i + 0.5),
            }));
            const result = { ground, left, right, deskX, deskW, deskTop, slot, placed };
            layouts.set(view, result);
            return result;
        }

        function drawBuilding(c, b, ground) {
            const { width: w, height: h, x, scale } = b;
            const pulse = pulses[b.index];
            c.save();
            c.translate(x, ground);
            c.scale(scale, scale);
            const wall = mixRgb(rgb('#7c2d12'), rgb('#92400e'), (b.index % 2) * 0.8);
            const edge = rgb('#5b210c');
            const lit = mixRgb(rgb('#b45309'), rgb('#fef3c7'), pulse.flash);
            const windows = (x0, y0, cols, rows, sx, sy, ww, wh) => {
                for (let row = 0; row < rows; row++) {
                    for (let col = 0; col < cols; col++) {
                        const twinkle = hash(b.index * 31 + row * 7 + col) > 0.55;
                        c.fillStyle = twinkle || pulse.flash > 0.05 ? css(lit) : css(mixRgb(wall, [0, 0, 0], 0.3));
                        c.fillRect(x0 + col * sx, y0 + row * sy, ww, wh);
                    }
                }
            };

            c.fillStyle = css(wall);
            c.fillRect(-w / 2, -h, w, h);
            c.fillStyle = css(edge);
            c.fillRect(-w / 2 - 3, -h - 4, w + 6, 5);

            if (b.type === 'city') {
                // Ratusz: kolumny, tympanon i biało-czerwona flaga
                c.fillStyle = '#fed7aa';
                poly(c, [-w / 2 - 6, -h + 2, w / 2 + 6, -h + 2, 0, -h - 25]);
                c.fill();
                c.fillStyle = css(wall);
                poly(c, [-w / 2 + 10, -h - 1, w / 2 - 10, -h - 1, 0, -h - 18]);
                c.fill();
                c.fillStyle = '#fed7aa';
                for (let i = 0; i < 5; i++) c.fillRect(-w / 2 + 13 + i * ((w - 34) / 4), -h + 22, 8, h - 22);
                c.fillRect(-w / 2, -6, w, 6);
                c.strokeStyle = css(edge);
                c.lineWidth = 2;
                line(c, 0, -h - 25, 0, -h - 58);
                const wave = Math.sin(clock * 3.2);
                c.fillStyle = '#fff7ed';
                c.fillRect(1, -h - 58, 24, 8);
                c.fillStyle = '#dc2626';
                c.beginPath();
                c.moveTo(1, -h - 50);
                c.quadraticCurveTo(13, -h - 47 + wave * 2, 25, -h - 50);
                c.lineTo(25, -h - 43);
                c.quadraticCurveTo(13, -h - 40 + wave * 2, 1, -h - 43);
                c.closePath();
                c.fill();
            } else if (b.type === 'hospital') {
                windows(-w / 2 + 11, -h + 32, 4, 3, 23, 22, 14, 12);
                c.fillStyle = '#fff7ed';
                roundedRect(c, -17, -h - 28, 34, 28, 3);
                c.fill();
                c.fillStyle = '#dc2626';
                setFont(c, 800, 23);
                c.textAlign = 'center';
                c.textBaseline = 'middle';
                c.fillText('H', 0, -h - 13);
                c.fillStyle = '#fed7aa';
                c.fillRect(-16, -22, 32, 22);
            } else if (b.type === 'police') {
                windows(-w / 2 + 11, -h + 32, 4, 2, 21, 22, 13, 13);
                const flash = Math.sin(clock * 9) > 0;
                c.fillStyle = '#1e3a8a';
                roundedRect(c, -9, -h - 13, 18, 10, 3);
                c.fill();
                c.save();
                c.shadowColor = flash ? '#60a5fa' : '#1d4ed8';
                c.shadowBlur = flash ? 22 : 6;
                c.fillStyle = flash ? '#93c5fd' : '#2563eb';
                disc(c, 0, -h - 14, 5.5);
                c.restore();
                c.fillStyle = '#fed7aa';
                c.fillRect(-13, -24, 26, 24);
            } else if (b.type === 'roads') {
                windows(-w / 2 + 12, -h + 30, 4, 1, 24, 22, 16, 13);
                c.fillStyle = '#fed7aa';
                c.fillRect(-12, -24, 24, 24);
                // Znak ostrzegawczy na dachu
                c.strokeStyle = css(edge);
                c.lineWidth = 2;
                line(c, w / 2 - 22, -h - 4, w / 2 - 22, -h - 20);
                c.fillStyle = '#fde047';
                c.strokeStyle = '#b91c1c';
                c.lineWidth = 2.5;
                poly(c, [w / 2 - 36, -h - 20, w / 2 - 8, -h - 20, w / 2 - 22, -h - 44]);
                c.fill();
                c.stroke();
            } else if (b.type === 'school') {
                windows(-w / 2 + 10, -h + 34, 5, 2, 22, 22, 16, 13);
                c.fillStyle = css(edge);
                poly(c, [-22, -h - 3, 22, -h - 3, 0, -h - 26]);
                c.fill();
                c.fillStyle = '#fff7ed';
                disc(c, 0, -h - 11, 7.5);
                c.strokeStyle = '#7c2d12';
                c.lineWidth = 1.2;
                line(c, 0, -h - 11, Math.cos(clock * 0.8) * 5, -h - 11 + Math.sin(clock * 0.8) * 5);
                line(c, 0, -h - 11, 0, -h - 15);
                c.fillStyle = '#fed7aa';
                c.fillRect(-13, -22, 26, 22);
            } else {
                windows(-w / 2 + 12, -h + 32, 4, 3, 23, 22, 13, 13);
                c.fillStyle = css(edge);
                c.fillRect(-15, -h - 32, 30, 28);
                poly(c, [-19, -h - 32, 19, -h - 32, 0, -h - 52]);
                c.fill();
                c.fillStyle = '#fff7ed';
                disc(c, 0, -h - 19, 7);
                c.fillStyle = '#fed7aa';
                c.fillRect(-13, -24, 26, 24);
            }

            // Szyld z nazwą instytucji
            setFont(c, 800, 9);
            const name = label(b.key);
            const nameW = textWidth(c, name) + 12;
            const signY = b.type === 'city' ? -h + 5 : -h + 9;
            c.fillStyle = 'rgba(255,247,237,.95)';
            roundedRect(c, -nameW / 2, signY, nameW, 15, 3);
            c.fill();
            c.fillStyle = '#7c2d12';
            c.textAlign = 'center';
            c.textBaseline = 'middle';
            c.fillText(name, 0, signY + 8);

            // Pieczątka po doręczeniu pisma
            if (pulse.stamp > 0) {
                const age = 1 - pulse.stamp;
                const size = 1.5 - smooth(age / 0.1) * 0.5;
                c.save();
                c.translate(0, -h * 0.5);
                c.rotate(-0.16);
                c.scale(size, size);
                c.globalAlpha = smooth(pulse.stamp / 0.25);
                setFont(c, 800, 11);
                const text = label('scene_stamp');
                const stampW = textWidth(c, text) + 12;
                c.fillStyle = 'rgba(254,243,199,.97)';
                roundedRect(c, -stampW / 2, -10, stampW, 20, 3);
                c.fill();
                c.strokeStyle = '#b91c1c';
                c.lineWidth = 1.8;
                c.stroke();
                c.fillStyle = '#b91c1c';
                c.fillText(text, 0, 1);
                c.restore();
            }
            c.restore();
        }

        function drawDesk(c, l) {
            const { deskX: x, deskW, deskTop: top, ground } = l;
            const wood = '#5b2a0e', metal = '#44200a';
            const px = x + 70, tw = 52, th = 104;
            const printerX = x + 134;

            // Kabel pod blatem z tętniącymi danymi
            const cable = [[px + tw - 10, top + 2], [px + tw - 8, top + 46], [printerX + 8, top + 46], [printerX + 12, top + 2]];
            c.strokeStyle = '#1c1917';
            c.lineWidth = 2;
            drawBezier(c, cable);
            for (let i = 0; i < 3; i++) {
                const p = bezier(cable, mod(clock * 0.9 + i / 3, 1));
                c.fillStyle = '#fde047';
                disc(c, p[0], p[1], 2);
            }

            // Stół
            c.fillStyle = metal;
            c.fillRect(x + 12, top + 7, 7, ground - top - 7);
            c.fillRect(x + deskW - 19, top + 7, 7, ground - top - 7);
            c.fillStyle = wood;
            roundedRect(c, x, top, deskW, 8, 2);
            c.fill();

            // Monitor z profilu: ekran patrzy w lewo i świeci na klawiaturę
            const mx = x + 34;
            const glow = c.createLinearGradient(mx, 0, mx - 54, 0);
            const work = 0.42 + Math.sin(clock * 5) * 0.06;
            glow.addColorStop(0, `rgba(254,243,199,${work})`);
            glow.addColorStop(1, 'rgba(254,243,199,0)');
            c.fillStyle = glow;
            poly(c, [mx, top - 88, mx, top - 26, mx - 54, top, mx - 54, top - 88]);
            c.fill();
            c.fillStyle = '#292524';
            roundedRect(c, mx, top - 90, 7, 68, 2);
            c.fill();
            c.fillStyle = '#fef3c7';
            c.fillRect(mx - 1.5, top - 86, 2, 60);
            c.fillStyle = '#44403c';
            poly(c, [mx + 7, top - 72, mx + 14, top - 66, mx + 14, top - 48, mx + 7, top - 40]);
            c.fill();
            c.fillStyle = '#292524';
            c.fillRect(mx + 11, top - 58, 5, 50);
            roundedRect(c, mx - 4, top - 7, 34, 7, 2);
            c.fill();
            // Klawiatura
            c.fillStyle = '#44403c';
            poly(c, [x + 2, top, x + 26, top, x + 26, top - 5, x + 2, top - 2]);
            c.fill();

            // Komputer: boczna ściana obudowy z wentylatorem
            c.fillStyle = '#292524';
            roundedRect(c, px, top - th, tw, th, 4);
            c.fill();
            c.fillStyle = '#44403c';
            roundedRect(c, px + 4, top - th + 4, tw - 8, th - 8, 2);
            c.fill();
            c.strokeStyle = '#1c1917';
            c.lineWidth = 1;
            c.beginPath();
            c.arc(px + tw / 2, top - th + 32, 16, 0, Math.PI * 2);
            c.stroke();
            c.fillStyle = '#d97706';
            for (let i = 0; i < 5; i++) {
                const a = clock * 9 + i * Math.PI * 0.4;
                c.beginPath();
                c.ellipse(px + tw / 2 + Math.cos(a) * 8, top - th + 32 + Math.sin(a) * 8, 7.5, 3, a, 0, Math.PI * 2);
                c.fill();
            }
            c.fillStyle = '#1c1917';
            for (let row = 0; row < 5; row++) {
                for (let col = 0; col < 7; col++) disc(c, px + 11 + col * 5, top - 42 + row * 5, 1.2);
            }
            c.fillStyle = Math.sin(clock * 6) > -0.3 ? '#fde047' : '#a16207';
            disc(c, px + tw - 8, top - th + 9, 2);

            // Drukarka z profilu: podajnik z tyłu, wyjście z przodu
            const py = top - 50, pw = 98, ph = 50;
            c.fillStyle = '#fffbeb';
            poly(c, [printerX + 10, py + 4, printerX - 14, py - 34, printerX - 8, py - 37, printerX + 18, py + 4]);
            c.fill();
            c.fillStyle = '#78716c';
            poly(c, [printerX + 6, py + 8, printerX - 18, py - 30, printerX - 14, py - 34, printerX + 12, py + 6]);
            c.fill();
            c.fillStyle = '#e7e5e4';
            roundedRect(c, printerX, py, pw, ph, 5);
            c.fill();
            c.fillStyle = '#d6d3d1';
            c.fillRect(printerX, py + ph - 14, pw, 14);
            c.fillStyle = '#a8a29e';
            roundedRect(c, printerX + 6, py - 3, pw - 22, 7, 2);
            c.fill();
            c.fillStyle = '#292524';
            c.fillRect(printerX + pw - 3, py + 20, 4, 9);
            c.fillStyle = Math.sin(clock * 7) > 0 ? '#fde047' : '#57534e';
            disc(c, printerX + 12, py + 11, 2.2);
            c.fillStyle = '#a8a29e';
            poly(c, [printerX + pw, py + 30, printerX + pw + 26, py + 34, printerX + pw + 26, py + 37, printerX + pw, py + 36]);
            c.fill();
        }

        function makeFlight(sheet, target, ground) {
            const start = sheet.foldAt;
            const end = [target.x, ground - target.height * target.scale * 0.5];
            const rise = 150 + hash(sent * 3.3) * 270;
            sheet.path = [
                start,
                [start[0] + 60 + hash(sent) * 120, start[1] - rise],
                [end[0] - 90 - hash(sent + 2) * 110, end[1] - rise * (0.65 + hash(sent + 4) * 0.5)],
                end,
            ];
            sheet.target = target.index;
            sheet.flightTime = 2.8 + Math.hypot(end[0] - start[0], end[1] - start[1]) / 340;
        }

        function drawPaper(c, sheet) {
            const fold = sheet.fold;
            const stage = Math.min(FOLDS.length - 2, Math.floor(fold * (FOLDS.length - 1)));
            const k = smooth(fold * (FOLDS.length - 1) - stage);
            const shape = FOLDS[stage].map((v, i) => lerp(v, FOLDS[stage + 1][i], k));
            c.fillStyle = css(mixRgb(WHITE, rgb('#fde68a'), fold * 0.25));
            poly(c, shape);
            c.fill();
            if (fold < 0.3) {
                // Treść pisma znika z pierwszym zagięciem
                const ink = 1 - fold / 0.3;
                c.fillStyle = `rgba(120,53,15,${0.75 * ink})`;
                c.fillRect(-16, -22, 14, 4);
                c.fillStyle = `rgba(120,53,15,${0.4 * ink})`;
                for (let i = 0; i < 6; i++) c.fillRect(-16, -11 + i * 6, i === 5 ? 18 : 32, 2);
            }
            // Zgięcia i cień skrzydła
            c.strokeStyle = `rgba(146,64,14,${0.5 * smooth(fold * 3)})`;
            c.lineWidth = 0.8;
            if (fold > 0.05) {
                line(c, shape[2], shape[3], shape[8], shape[9]);
            }
            if (fold > 0.34) {
                c.fillStyle = `rgba(180,83,9,${0.3 * smooth((fold - 0.34) * 3)})`;
                poly(c, [shape[2], shape[3], shape[4], shape[5], shape[6], shape[7], shape[8], shape[9]]);
                c.fill();
            }
        }

        function drawPlane(c, x, y, heading, size, alpha, wobble) {
            c.save();
            c.globalAlpha = alpha;
            c.translate(x, y);
            c.rotate(heading + Math.PI / 2 + wobble);
            c.scale(size, size);
            const f = FOLDS[3];
            c.fillStyle = 'rgba(120,53,15,.18)';
            poly(c, f.map((v, i) => v + (i % 2 ? 7 : 3)));
            c.fill();
            c.fillStyle = css(WHITE);
            poly(c, [f[2], f[3], f[0], f[1], f[10], f[11], f[8], f[9]]);
            c.fill();
            c.fillStyle = '#fde68a';
            poly(c, [f[2], f[3], f[8], f[9], f[6], f[7], f[4], f[5]]);
            c.fill();
            c.strokeStyle = 'rgba(146,64,14,.45)';
            c.lineWidth = 0.7;
            line(c, f[2], f[3], f[8], f[9]);
            c.restore();
        }

        return {
            release() { backdrop.release(); },
            enter() {
                sheets = [];
                spawnClock = SPAWN_EVERY - 0.25;
                pulses.forEach((p) => { p.flash = 0; p.stamp = 0; });
            },
            update(dt, view) {
                clock += dt;
                const l = layout(view);
                spawnClock += dt;
                if (spawnClock > SPAWN_EVERY) {
                    spawnClock = 0;
                    sent++;
                    sheets.push({ phase: 'print', time: 0, fold: 0, seed: sent });
                }
                pulses.forEach((p) => {
                    p.flash = Math.max(0, p.flash - dt * 1.2);
                    p.stamp = Math.max(0, p.stamp - dt / 1.5);
                });
                sheets.forEach((sheet) => {
                    sheet.time += dt;
                    if (sheet.phase === 'print' && sheet.time > 1) {
                        sheet.phase = 'fall';
                        sheet.time = 0;
                    } else if (sheet.phase === 'fall' && sheet.time > 0.75) {
                        sheet.phase = 'fold';
                        sheet.time = 0;
                        sheet.foldAt = [l.slot[0] + 58 + (hash(sheet.seed) - 0.5) * 18, l.slot[1] + 36];
                    } else if (sheet.phase === 'fold' && sheet.time > 1.15) {
                        sheet.phase = 'fly';
                        sheet.time = 0;
                        sheet.fold = 1;
                        const pick = l.placed[(sheet.seed * 7 + Math.floor(hash(sheet.seed) * 11)) % l.placed.length];
                        makeFlight(sheet, pick, l.ground);
                    } else if (sheet.phase === 'fly' && sheet.time > sheet.flightTime) {
                        sheet.done = true;
                        pulses[sheet.target].flash = 1;
                        pulses[sheet.target].stamp = 1;
                    }
                    if (sheet.phase === 'fold') sheet.fold = clamp(sheet.time / 1.1);
                });
                sheets = sheets.filter((sheet) => !sheet.done);
            },
            draw(c, view) {
                const l = layout(view);
                const sunX = Math.max(view.left(view.h * 0.3), 0) + 120;
                backdrop(c, view, (background) => {
                    const sky = background.createLinearGradient(0, 0, 0, l.ground);
                    sky.addColorStop(0, '#c2620a');
                    sky.addColorStop(0.7, '#e08a14');
                    sky.addColorStop(1, '#f2b23a');
                    background.fillStyle = sky;
                    background.fillRect(0, 0, view.w, view.h);
                    const halo = background.createRadialGradient(sunX, view.h * 0.24, 10, sunX, view.h * 0.24, 190);
                    halo.addColorStop(0, 'rgba(254,243,199,.55)');
                    halo.addColorStop(1, 'rgba(254,243,199,0)');
                    background.fillStyle = halo;
                    background.fillRect(sunX - 190, view.h * 0.24 - 190, 380, 380);
                    background.fillStyle = view.mobile ? 'rgba(254,243,199,.2)' : 'rgba(254,243,199,.8)';
                    disc(background, sunX, view.h * 0.24, 36);
                });

                // Chmury pozostają w ruchu, przed niezmiennym tłem i za miastem.
                for (let i = 0; i < 6; i++) {
                    const span = view.w + 300;
                    const x = mod(hash(i + 7) * span + clock * (4 + hash(i) * 7), span) - 150;
                    const y = view.h * (0.08 + hash(i + 3) * 0.42);
                    c.fillStyle = 'rgba(255,237,200,.2)';
                    puff(c, x, y, 0.72, i);
                }
                c.fillStyle = 'rgba(180,83,9,.42)';
                c.beginPath();
                c.moveTo(0, l.ground);
                for (let x = 0; x <= view.w + 40; x += 38) {
                    const h = 26 + hash(Math.floor(x / 38)) * 62;
                    c.lineTo(x, l.ground - h);
                    c.lineTo(x + 38, l.ground - h);
                }
                c.lineTo(view.w + 40, l.ground);
                c.closePath();
                c.fill();

                // Ulica z przejściem dla pieszych
                c.fillStyle = '#92400e';
                c.fillRect(0, l.ground, view.w, 8);
                c.fillStyle = '#44260f';
                c.fillRect(0, l.ground + 8, view.w, view.h - l.ground);
                c.fillStyle = 'rgba(254,243,199,.75)';
                const zebra = (l.left + l.right) / 2;
                for (let i = 0; i < 7; i++) {
                    poly(c, [zebra + i * 26 - 10, l.ground + 15, zebra + i * 26 + 4, l.ground + 15, zebra + i * 26 - 8, view.h - 6, zebra + i * 26 - 24, view.h - 6]);
                    c.fill();
                }

                l.placed.forEach((b) => drawBuilding(c, b, l.ground));
                drawDesk(c, l);

                sheets.forEach((sheet) => {
                    if (sheet.phase === 'print') {
                        // W profilu kartka to cienki pasek wysuwający się z drukarki
                        const k = smooth(sheet.time / 1);
                        c.fillStyle = css(WHITE);
                        c.fillRect(l.slot[0], l.slot[1] + 1, 40 * k, 2.4);
                    } else if (sheet.phase === 'fall') {
                        const k = sheet.time / 0.75;
                        const x = l.slot[0] + 40 + k * 18 + Math.sin(k * 6) * 5;
                        const y = l.slot[1] + 8 + k * 28;
                        c.save();
                        c.translate(x, y);
                        c.rotate(Math.sin(k * 7) * 0.28);
                        c.scale(lerp(0.2, 0.9, smooth(k)), lerp(0.1, 0.9, smooth(k * 1.4)));
                        drawPaper(c, sheet);
                        c.restore();
                    } else if (sheet.phase === 'fold') {
                        c.save();
                        c.translate(sheet.foldAt[0], sheet.foldAt[1] - smooth(sheet.time / 1.1) * 6);
                        c.scale(0.9, 0.9);
                        c.rotate(smooth(sheet.time / 1.1) * 0.5);
                        drawPaper(c, sheet);
                        c.restore();
                    } else {
                        const k = sheet.time / sheet.flightTime;
                        const t = lerp(k, smooth(k), 0.35);
                        // Kropkowany ślad za samolocikiem
                        for (let i = 1; i < 16; i++) {
                            const back = t - i * 0.016;
                            if (back <= 0) break;
                            const p = bezier(sheet.path, back);
                            c.fillStyle = `rgba(255,251,235,${0.5 * (1 - i / 16)})`;
                            disc(c, p[0], p[1], 1.5);
                        }
                        const p = bezier(sheet.path, t);
                        const q = bezier(sheet.path, Math.min(1, t + 0.01));
                        const heading = Math.atan2(q[1] - p[1], q[0] - p[0]);
                        const size = (0.82 + Math.sin(t * Math.PI) * 0.34) * (1 - smooth((k - 0.9) / 0.1) * 0.6);
                        const alpha = 1 - smooth((k - 0.94) / 0.06);
                        drawPlane(c, p[0], p[1], heading, size, alpha, Math.sin(clock * 3.4 + sheet.seed) * 0.05);
                    }
                });
            },
        };
    }

    // --- 5. Silnik: uruchamianie scen razem z aktywacją panelu ---

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const factories = [createSystemScene, createRideScene, createMailScene];

    const stages = [...document.querySelectorAll('.panel')].map((panel, index) => {
        const canvas = panel.querySelector('.panel-scene');
        return {
            panel, canvas, index, ctx: canvas.getContext('2d', { alpha: false }), scene: factories[index](),
            active: false, visible: false, stopAt: 0, view: null, dpr: 1, cssW: 0, cssH: 0, viewportW: 0,
            posterPending: false,
        };
    });

    function measure(stage) {
        const { canvas, index } = stage;
        const cssW = canvas.clientWidth, cssH = canvas.clientHeight;
        if (!cssW || !cssH) return false;
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const vw = window.innerWidth;
        if (stage.view && stage.cssW === cssW && stage.cssH === cssH && stage.viewportW === vw && stage.dpr === dpr) return false;
        stage.dpr = dpr;
        stage.cssW = cssW;
        stage.cssH = cssH;
        stage.viewportW = vw;
        // Ustawienie rozmiaru czyści płótno, więc robimy to tylko przy realnej zmianie
        const backingW = Math.round(cssW * stage.dpr), backingH = Math.round(cssH * stage.dpr);
        if (canvas.width !== backingW) canvas.width = backingW;
        if (canvas.height !== backingH) canvas.height = backingH;

        const mobile = vw < 768;
        const scale = mobile ? clamp(cssW / 620, 0.55, 0.85) : clamp(cssH / 900, 0.72, 1.5);
        const w = cssW / scale, h = cssH / scale;
        // Pozycja aktywnego panelu w oknie: kontener ma 120% szerokości, a panele proporcje 3:1:1
        const panelLeft = (-0.1 + index * 0.24) * vw;
        const panelW = 0.72 * vw;
        const originX = panelLeft + panelW / 2 - cssW / 2;
        const shift = (y) => -SKEW_TAN * (y * scale - cssH / 2);
        const textW = Math.min(600, panelW * 0.8);
        stage.view = mobile
            ? { w, h, scale, mobile, left: () => 0, right: () => w, textL: 0, textR: w }
            : {
                w, h, scale, mobile,
                screenX: originX / scale,
                left: (y) => (Math.max(panelLeft + shift(y), 0) - originX) / scale,
                right: (y) => (Math.min(panelLeft + panelW + shift(y), vw) - originX) / scale,
                textL: (cssW - textW) / 2 / scale,
                textR: (cssW + textW) / 2 / scale,
            };
        return true;
    }

    function render(stage) {
        if (!stage.view) measure(stage);
        if (!stage.view) return;
        const { ctx, view, dpr } = stage;
        ctx.setTransform(dpr * view.scale, 0, 0, dpr * view.scale, 0, 0);
        stage.scene.draw(ctx, view);
    }

    // Bez ruchu: przewijamy symulację do ładnego momentu i pokazujemy jedną klatkę
    function renderPoster(stage) {
        if (!stage.view) measure(stage);
        if (!stage.view) return;
        stage.scene.enter();
        if (stage.scene.prepare) stage.scene.prepare();
        for (let i = 0; i < 60 * 9; i++) stage.scene.update(1 / 60, stage.view);
        render(stage);
        stage.posterPending = false;
    }

    let rafId = null, lastFrame = 0;

    function loop(now) {
        rafId = null;
        if (document.hidden || reducedMotion.matches) return;
        const dt = Math.min((now - lastFrame) / 1000, 0.05);
        lastFrame = now;
        let live = false;
        stages.forEach((stage) => {
            if (!stage.active && now > stage.stopAt) {
                if (stage.stopAt) {
                    if (stage.scene.release) stage.scene.release();
                    stage.stopAt = 0;
                }
                return;
            }
            if (!stage.visible) return;
            live = true;
            if (!stage.view) measure(stage);
            if (!stage.view) return;
            stage.scene.update(dt, stage.view);
            render(stage);
        });
        rafId = live ? requestAnimationFrame(loop) : null;
    }

    function startLoop() {
        if (rafId !== null || document.hidden || reducedMotion.matches) return;
        if (!stages.some((stage) => stage.visible && (stage.active || performance.now() < stage.stopAt))) return;
        lastFrame = performance.now();
        rafId = requestAnimationFrame(loop);
    }

    function stopLoop() {
        if (rafId !== null) cancelAnimationFrame(rafId);
        rafId = null;
    }

    function syncStage(stage) {
        const active = stage.panel.classList.contains('active');
        if (active === stage.active) return;
        stage.active = active;
        if (reducedMotion.matches) {
            stage.posterPending = active;
            if (active && stage.visible && !document.hidden) renderPoster(stage);
            if (!active && stage.scene.release) stage.scene.release();
            return;
        }
        if (active) stage.scene.enter();
        else stage.stopAt = performance.now() + FADE_MS;
        startLoop();
    }

    const observer = new MutationObserver(() => stages.forEach(syncStage));
    stages.forEach((stage) => {
        observer.observe(stage.panel, { attributes: true, attributeFilter: ['class'] });
        syncStage(stage);
    });

    // Focus może pozostać na panelu, który już opuścił ekran (np. po przewinięciu
    // do wstępu). Nie rysujemy niewidocznego płótna ani karty ukrytej w tle.
    const visibilityObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
            const stage = stages.find((item) => item.panel === entry.target);
            stage.visible = entry.isIntersecting;
            if (stage.visible && stage.active && reducedMotion.matches && !document.hidden) {
                if (stage.posterPending) renderPoster(stage);
                else render(stage);
            }
        });
        startLoop();
    });
    stages.forEach((stage) => visibilityObserver.observe(stage.panel));

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) stopLoop();
        else if (reducedMotion.matches) {
            stages.forEach((stage) => {
                if (stage.active && stage.visible) {
                    if (stage.posterPending) renderPoster(stage);
                    else render(stage);
                }
            });
        } else startLoop();
    });

    reducedMotion.addEventListener('change', () => {
        stopLoop();
        stages.forEach((stage) => {
            stage.stopAt = 0;
            stage.posterPending = stage.active && reducedMotion.matches;
            if (stage.posterPending && stage.visible && !document.hidden) renderPoster(stage);
            if (!stage.active && stage.scene.release) stage.scene.release();
        });
        startLoop();
    });

    // Podpisy na płótnie muszą nadążać za językiem także wtedy, gdy nic się nie animuje
    new MutationObserver(() => {
        if (reducedMotion.matches && !document.hidden) stages.forEach((stage) => { if (stage.active && stage.visible) render(stage); });
    }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });

    function remeasure() {
        stages.forEach((stage) => {
            if (stage.active || performance.now() < stage.stopAt) {
                if (measure(stage) && stage.visible && !document.hidden) render(stage);
            } else stage.view = null;
        });
    }

    // Na telefonie wysokość panelu zależy też od treści, np. po zmianie języka
    window.addEventListener('resize', remeasure);
    const sizeObserver = new ResizeObserver(remeasure);
    stages.forEach((stage) => sizeObserver.observe(stage.canvas));
})();
