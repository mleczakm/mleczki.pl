# mleczki.pl

Osobista strona Michała Mleczki: trzy panele (programista, rowerzysta, społecznik) z animowanymi scenami na `<canvas>`. Publikowana na GitHub Pages przez `.github/workflows/deploy.yml` po każdym pushu do `main`.

## Praca nad stroną

```sh
npm install
npm run dev     # buduje, serwuje http://localhost:4174 i przebudowuje po zmianach
npm run build   # jednorazowy build do dist/
```

Wymaga Node.js 22 lub nowszego. Katalog `dist/` nie jest w repozytorium; workflow buduje go sam.

## Układ

- `src/index.html` — treść, tłumaczenia (PL/EN) i skrypt paneli. Klasy Tailwinda wpisuje się tutaj.
- `src/styles.css` — własne style strony między dyrektywami `@tailwind`.
- `src/scenes.js` — animacje paneli.
- `public/` — pliki kopiowane bez zmian (ikony, `og-image.png`, zdjęcia, `CNAME`, `robots.txt`, `sitemap.xml`).
- `tailwind.config.js` — kolory marki i font.
- `build.mjs` — krok budowania.

## Co robi build

- Generuje statyczny CSS z Tailwinda (tylko klasy użyte w `src/index.html`), minifikuje go i wstawia do `<head>` w miejscu `<!-- build:css -->`. Strona nie ładuje Tailwinda z CDN.
- Kopiuje font Inter (zmienny, podzbiory `latin` i `latin-ext`) z paczki `@fontsource-variable/inter` do `dist/fonts/` razem z licencją OFL. Strona nie łączy się z Google Fonts.
- Minifikuje `scenes.js` i dopisuje do jego adresu skrót treści (`?v=…`), żeby przeglądarka nie łączyła nowego HTML ze starym skryptem.
- Minifikuje skrypt strony bez zmiany nazw globalnych (wołają je atrybuty `onclick` i `scenes.js`), zwija JSON-LD, usuwa komentarze i wcięcia z HTML.

Grubości fontu są celowo zadeklarowane jako 300, 400, 600 i 800, tak jak wcześniej w Google Fonts. Dlatego `font-medium` rysuje się jako 400, a `font-bold` jako 800; zmiana listy `FONT_WEIGHTS` w `build.mjs` zmieni wygląd tekstu.
