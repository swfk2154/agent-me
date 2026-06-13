/** @type {import("tailwindcss").Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        primary: { 50: "#f3f1ff", 100: "#e8e4ff", 200: "#d2ccff", 300: "#b3a8ff", 400: "#8f7eff", 500: "#6c5ce7", 600: "#534ab7", 700: "#433d91", 800: "#363474", 900: "#2d2b5e" }
      }
    }
  },
  plugins: [],
};
