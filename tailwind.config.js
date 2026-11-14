/** @type {import('tailwindcss').Config} */
export default {
    // Klasy są skanowane także w skrypcie strony (przełącznik języka ustawia className).
    content: ['./src/index.html'],
    theme: {
        extend: {
            fontFamily: {
                sans: ['Inter', 'sans-serif'],
            },
            colors: {
                // Kolor dopasowany do cargo.mleczki.pl
                cargoGreen: '#0d5336',
                devDark: '#0f172a',
                activistAmber: '#d97706',
            },
        },
    },
};
