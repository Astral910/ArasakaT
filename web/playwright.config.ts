import { defineConfig, devices } from '@playwright/test'

// Headless, sin sonido y con la GPU (axiomas del dueño). Un solo navegador a la vez.
const args = ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist']
export default defineConfig({
  testDir: 'e2e',
  workers: 1,
  timeout: 120_000,
  reporter: 'list',
  use: { baseURL: process.env.BASE_URL || 'http://127.0.0.1:5201', headless: true, launchOptions: { args } },
  projects: [
    { name: 'escritorio', use: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 } },
    { name: 'celular', use: { ...devices['Pixel 7'], browserName: 'chromium' } },
  ],
  webServer: { command: 'npx vite --host 127.0.0.1 --port 5201', url: 'http://127.0.0.1:5201', reuseExistingServer: true, timeout: 60_000 },
})
