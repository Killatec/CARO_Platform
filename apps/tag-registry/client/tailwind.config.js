import baseConfig from '@caro/ui/tailwind.config.js';

/** @type {import('tailwindcss').Config} */
export default {
  ...baseConfig,
  content: [
    './index.html',
    './src/**/*.{js,jsx}',
    '../../../packages/ui/src/**/*.{js,jsx}'
  ]
};
