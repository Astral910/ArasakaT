import { Page, expect } from '@playwright/test'
import fs from 'node:fs'
import path from 'node:path'

// Capturas para el dueño y la entrega.
export const SHOTS = process.env.SHOTS_DIR || 'C:\\Users\\Pc\\spaceapps-fieldshift-agentes\\estado\\muestras\\e2e'
fs.mkdirSync(SHOTS, { recursive: true })

export async function shot(page: Page, name: string, fullPage = false) {
  await page.screenshot({ path: path.join(SHOTS, `${name}.png`), fullPage, animations: 'disabled' })
}

/** Junta errores de la página (excepciones no capturadas). Los de red de terceros no cuentan. */
export function watchErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (e) => errors.push(e.message))
  return errors
}

/** Espera a que la vista monte algo con contenido real (no el esqueleto vacío). */
export async function settle(page: Page, ms = 1200) {
  await page.waitForLoadState('domcontentloaded')
  await expect(page.locator('#app')).not.toBeEmpty()
  await page.waitForTimeout(ms)
}

export type Msg = { from: string; tipo: string; texto: string; botones?: { id: string; title: string }[]; image_url?: string }
