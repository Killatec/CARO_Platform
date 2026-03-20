/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './src/**/*.{js,jsx}',
    '../../apps/*/client/src/**/*.{js,jsx}'
  ],
  theme: {
    extend: {
      colors: {
        // Design tokens will be mapped here
        // Using CSS custom properties from tokens/index.css
      }
    }
  },
  plugins: []
};
