import type { Config } from 'tailwindcss';

export default {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: { DEFAULT: '#8378FF', glow: 'rgba(131,120,255,0.40)' },
        bg: { DEFAULT: '#141522', 1: '#1C1D2C', 2: '#25273A', 3: '#303248' },
        text: { DEFAULT: '#F4F5FC', 2: '#C4C7DB', 3: '#888BA4' },
        type: {
          ui: '#5BC0DE', api: '#5DE090', cron: '#FFB840',
          contract: '#F87171', db: '#B19DFF', redis: '#F58BC2'
        }
      },
      fontFamily: { sans: ['Inter', 'system-ui'], mono: ['JetBrains Mono', 'monospace'] }
    }
  },
  plugins: []
} satisfies Config;
