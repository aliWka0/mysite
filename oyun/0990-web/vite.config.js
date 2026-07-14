import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    publicDir: 'public',

    build: {
        outDir: 'dist',
        target: 'es2020',
        assetsInlineLimit: 0,
        chunkSizeWarningLimit: 2000,
    },

    server: {
        port: 8080,
        open: true,
    },
    preview: {
        port: 8080,
    },
});
