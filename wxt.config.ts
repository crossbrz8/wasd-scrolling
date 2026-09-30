import { defineConfig } from 'wxt';

// See https://wxt.dev/api/config.html for more info
export default defineConfig({
  manifest: {
    name: 'WASD Page Scroller',
    description: 'Scroll web pages using WASD keys. Toggle on/off with Alt+S.',
    permissions: ['storage', 'tabs'],
    action: {},
    icons: {
      16: '/icon-16.png',
      48: '/icon-48.png',
      128: '/icon-128.png',
    },
  },
});
