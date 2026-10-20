/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        slate: {
          50:'#f7f7f9',100:'#eff0f3',200:'#e4e5e9',300:'#cacdd4',400:'#767982',
          500:'#707278',600:'#555861',700:'#3d4048',800:'#2d3037',900:'#202124',950:'#17181c',
        },
        brand: {
          primary: '#202124',
          accent: '#555861',
          danger: '#ef4444', // red
          warning: '#f59e0b', // amber
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      fontWeight: {black:'600',extrabold:'600',bold:'600'},
      boxShadow: {
        'glow-green': '0 0 15px rgba(16, 185, 129, 0.25)',
        'glow-red': '0 0 15px rgba(239, 68, 68, 0.25)',
        'glow-blue': '0 0 15px rgba(59, 130, 246, 0.25)',
      },
      animation: {
        'slide-up': 'slideUp 0.3s ease-out forwards',
        'fade-in': 'fadeIn 0.2s ease-out forwards',
        'scale-in': 'scaleIn 0.25s cubic-bezier(0.34, 1.56, 0.64, 1) forwards',
      },
      keyframes: {
        slideUp: {
          '0%': { transform: 'translateY(20px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.9)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        }
      }
    },
  },
  plugins: [],
}
