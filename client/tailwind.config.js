/** @type {import('tailwindcss').Config} */

// Semantic colours read the CSS variables in src/index.css (RGB channels), so
// `bg-accent/10` style opacity modifiers work and dark mode is one class flip.
const token = (name) => `rgb(var(--${name}) / <alpha-value>)`;

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      fontFamily: {
        sans: ['"Inter Variable"', 'ui-sans-serif', 'system-ui', '-apple-system', '"Segoe UI"', 'sans-serif'],
        mono: ['"JetBrains Mono Variable"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
      },
      fontSize: {
        '2xs': ['0.714rem', { lineHeight: '1rem' }], // 10px at the 14px root
      },
      colors: {
        // Legacy scale kept so older pages keep rendering; new code uses `accent`.
        brand: {
          50: '#eef2ff', 100: '#e0e7ff', 200: '#c7d2fe', 300: '#a5b4fc', 400: '#818cf8',
          500: '#6366f1', 600: '#4f46e5', 700: '#4338ca', 800: '#3730a3', 900: '#312e81', 950: '#1e1b4b',
        },
        bg: { DEFAULT: token('bg'), subtle: token('bg-subtle') },
        surface: { DEFAULT: token('surface'), raised: token('surface-raised'), sunken: token('surface-sunken') },
        fg: { DEFAULT: token('text'), muted: token('text-muted'), subtle: token('text-subtle') },
        accent: {
          DEFAULT: token('accent'), hover: token('accent-hover'), fg: token('accent-fg'),
          subtle: token('accent-subtle'), 'subtle-fg': token('accent-subtle-fg'),
        },
        success: { DEFAULT: token('success'), subtle: token('success-subtle'), 'subtle-fg': token('success-subtle-fg') },
        warning: { DEFAULT: token('warning'), subtle: token('warning-subtle'), 'subtle-fg': token('warning-subtle-fg') },
        danger: { DEFAULT: token('danger'), subtle: token('danger-subtle'), 'subtle-fg': token('danger-subtle-fg') },
        info: { DEFAULT: token('info'), subtle: token('info-subtle'), 'subtle-fg': token('info-subtle-fg') },
      },
      textColor: {
        muted: token('text-muted'),
        subtle: token('text-subtle'),
      },
      borderColor: {
        DEFAULT: token('border'),
        default: token('border'),
        strong: token('border-strong'),
      },
      ringColor: {
        DEFAULT: token('ring'),
        focus: token('ring'),
      },
      borderRadius: {
        control: '6px',
        card: '10px',
        dialog: '12px',
      },
      boxShadow: {
        popover: '0 10px 30px -10px rgb(0 0 0 / 0.25), 0 2px 6px -2px rgb(0 0 0 / 0.08)',
      },
      keyframes: {
        'fade-in': { from: { opacity: 0 }, to: { opacity: 1 } },
        'pop-in': { from: { opacity: 0, transform: 'translateY(4px) scale(0.98)' }, to: { opacity: 1, transform: 'none' } },
        'slide-in-right': { from: { transform: 'translateX(16px)', opacity: 0 }, to: { transform: 'none', opacity: 1 } },
      },
      animation: {
        'fade-in': 'fade-in 120ms ease-out',
        'pop-in': 'pop-in 140ms ease-out',
        'slide-in-right': 'slide-in-right 180ms ease-out',
      },
    },
  },
  plugins: [],
};
