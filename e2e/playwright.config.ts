import { defineConfig } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const port = process.env.E2E_PORT || '8200'
const exe = process.platform === 'win32' ? 'fieldshift-server.exe' : 'fieldshift-server'

// ronda 5: el chat corre con un `claude` falso (e2e/claude-falso: llama al MCP real, sin la cuenta de nadie).
const claudeFalso = path.join(here, '.bin', process.platform === 'win32' ? 'claude-falso.exe' : 'claude-falso')
if (!process.env.BASE_URL && process.env.STATIC !== '1' && !fs.existsSync(claudeFalso)) {
  execSync(`go build -o "${claudeFalso}" ./e2e/claude-falso`, { cwd: root, stdio: 'inherit' })
}

// BASE_URL externo (p. ej. el link de Vercel) → no se levanta servidor.
const external = process.env.BASE_URL
// STATIC=1 → sirve web/dist sin backend (prueba del modo estático).
const staticOnly = process.env.STATIC === '1'

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: external || `http://127.0.0.1:${port}`,
    headless: true,
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1,
    locale: 'en-US',
    timezoneId: 'America/Guatemala',
    launchOptions: { args: ['--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist'] },
    trace: 'off',
  },
  webServer: external
    ? undefined
    : staticOnly
      ? {
          command: `node static-server.mjs ${port}`,
          cwd: here,
          url: `http://127.0.0.1:${port}/`,
          reuseExistingServer: false,
          timeout: 30_000,
        }
      : {
          command: path.join(root, 'bin', exe),
          cwd: root,
          url: `http://127.0.0.1:${port}/healthz`,
          reuseExistingServer: true,
          timeout: 60_000,
          env: { ADDR: `127.0.0.1:${port}`, SCHEDULER: 'off', DB_PATH: path.join(here, 'test-results', 'e2e.db'), ADMIN_TOKEN: 'e2e-token', CHAT_CLAUDE_BIN: claudeFalso, DEMO_PASS: 'demo1234' },
        },
})
