/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class", // nunca se agrega la clase: la app es siempre clara
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        guinda: { DEFAULT: "#9D2449", oscuro: "#611232" },
        verde: "#235B4E",
        dorado: "#BC955C",
        gris: "#98989A",
      },
      fontFamily: { sans: ["system-ui", "Segoe UI", "Roboto", "sans-serif"] },
    },
  },
  plugins: [],
};
