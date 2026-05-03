import { fileURLToPath, URL } from 'node:url'
import fs from 'node:fs'
import path from 'node:path'

import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// /data/ 配下のリクエストに対して、ファイルが存在しない場合に 404 を返す。
// Vite の SPA フォールバックが index.html を 200 で返してしまうのを防ぐため。
const publicDataFallback = () => ({
    name: 'public-data-404',
    configureServer(server) {
        const publicDir = fileURLToPath(new URL('../public', import.meta.url))
        server.middlewares.use((req, res, next) => {
            if (req.url?.startsWith('/data/')) {
                const filePath = path.join(publicDir, req.url.replace(/\?.*$/, ''))
                if (!fs.existsSync(filePath)) {
                    res.statusCode = 404
                    res.end('Not Found')
                    return
                }
            }
            next()
        })
    }
})

// https://vitejs.dev/config/
export default defineConfig({
  base: './',
  plugins: [
    vue(),
    publicDataFallback(),
  ],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
      port: 8081
  }
})
