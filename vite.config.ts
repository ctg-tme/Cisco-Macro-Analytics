import { defineConfig } from 'vitest/config';

const publicFavicon = '<link rel="icon" href="/favicon.svg" type="image/svg+xml" />';
const localFavicon = '<link rel="icon" href="/favicon-local.svg" type="image/svg+xml" />';

export default defineConfig(({ command }) => ({
  base: './',
  plugins: command === 'serve'
    ? [{
        name: 'local-favicon',
        transformIndexHtml: (html) => html.replace(publicFavicon, localFavicon),
      }]
    : [],
  server: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
  },
  preview: {
    host: '127.0.0.1',
    port: 5176,
    strictPort: true,
  },
  test: {
    environment: 'node',
  },
}));
