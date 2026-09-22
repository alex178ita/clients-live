import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{js,ts,jsx,tsx,mdx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0e1116',
        panel: '#161b22',
        line: '#252c37',
        muted: '#8b97a8',
        accent: '#4da3ff',
        licence: '#2ea44f',
        services: '#0f8f8f',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
