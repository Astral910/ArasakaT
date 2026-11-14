// Contrato HTTP del binario unido: motor + bot + alertas. Se salta si se prueba el modo estático.
import { test, expect, APIRequestContext } from '@playwright/test'
import type { Msg } from './helpers'

test.skip(process.env.STATIC === '1', 'modo estático: sin backend')

const ADMIN = { Authorization: `Bearer ${process.env.ADMIN_TOKEN || 'e2e-token'}` }

async function chat(request: APIRequestContext, sesion: string, body: Record<string, unknown>): Promise<Msg[]> {
  // Mandamos los dos nombres de campo (web: sesion/boton · bot: session_id/boton_id).
  const b: Record<string, unknown> = { sesion, session_id: sesion, ...body }
  if (body.boton) b.boton_id = body.boton
  if (body.lat !== undefined) b.tipo = 'location'
  const r = await request.post('/api/chat', { data: b })
  expect(r.ok(), `chat ${r.status()}`).toBeTruthy()
  const msgs = (await r.json()) as Msg[]
  expect(Array.isArray(msgs) && msgs.length > 0).toBeTruthy()
  return msgs
}

const ids = (m: Msg[]) => m.flatMap((x) => x.botones?.map((b) => b.id) ?? [])

test('healthz: motor, bot y alertas montados', async ({ request }) => {
  const r = await request.get('/healthz')
  expect(r.ok()).toBeTruthy()
  const h = await r.json()
  console.log('componentes', JSON.stringify(h.componentes))
  expect(h.componentes.motor).toBe('real')
  expect(h.componentes.bot).toBe('real')
})

test('plan real con 3 estrategias, ficha de 5 puntos y fuentes', async ({ request }) => {
  const r = await request.post('/api/plan', {
    data: { municipio_id: 'jocotan-chiquimula', cultivo: 'milpa', area_valor: 8, area_unidad: 'cuerda', riego: false, ganado: false, mano_obra: 'normal', semilla_cobertura: true, prioridad: 'comida', horizonte: '2026', idioma: 'en' },
  })
  expect(r.ok()).toBeTruthy()
  const p = await r.json()
  expect(p.estrategias.map((e: any) => e.id).sort()).toEqual(['S0', 'S1', 'S2'])
  for (const e of p.estrategias) {
    for (const k of ['por_que', 'evidencia', 'beneficios', 'info_faltante', 'riesgos']) expect(e.ficha[k]?.length, `${e.id}.${k}`).toBeGreaterThan(0)
    expect(e.perdidas_de_10.p10).toBeLessThanOrEqual(e.perdidas_de_10.p90)
  }
  expect(p.fuentes.length).toBeGreaterThan(0)
  expect(p.validacion.total).toBeGreaterThan(0)
  const r40 = await request.post('/api/plan', { data: { municipio_id: 'jocotan-chiquimula', cultivo: 'milpa', prioridad: 'comida', horizonte: '2040-ssp585', idioma: 'en' } })
  expect(r40.ok()).toBeTruthy()
})

test('municipios y riesgo', async ({ request }) => {
  const m = await (await request.get('/api/municipios')).json()
  expect(m.length).toBeGreaterThan(300)
  const r = await request.get('/api/riesgo?horizonte=2026')
  expect(r.ok()).toBeTruthy()
})

test('conversación completa en el simulador (ubicación → plan → tarjeta → suscripción)', async ({ request }) => {
  const s = `web-e2e-${Date.now()}`
  let m = await chat(request, s, { texto: 'hola' })
  expect(m.some((x) => x.tipo === 'location_request' || /ubicaci/i.test(x.texto))).toBeTruthy()
  m = await chat(request, s, { lat: 14.82, lon: -89.39 })
  expect(m.map((x) => x.texto).join(' ')).toContain('Jocotán')
  expect(ids(m)).toContain('milpa')
  m = await chat(request, s, { boton: 'milpa' }) // ¿riego?
  m = await chat(request, s, { boton: 'no' }) // ¿ganado?
  m = await chat(request, s, { boton: 'no' }) // ¿prioridad?
  expect(ids(m)).toContain('comida')
  m = await chat(request, s, { boton: 'comida' })
  const img = m.find((x) => x.tipo === 'image')
  expect(img?.image_url).toBeTruthy()
  const card = await request.get(img!.image_url!.replace(/^https?:\/\/[^/]+/, ''))
  expect(card.ok()).toBeTruthy()
  expect(card.headers()['content-type']).toContain('image/png')
  expect(ids(m)).toContain('sub_si')
  m = await chat(request, s, { texto: '2' })
  expect(m.map((x) => x.texto).join(' ').length).toBeGreaterThan(80)
})

test('aviso de canícula llega al simulador', async ({ request }) => {
  const h = await (await request.get('/healthz')).json()
  test.skip(h.componentes.alertas !== 'real', 'alertas todavía en falso')
  const s = `web-e2e-alerta-${Date.now()}`
  await chat(request, s, { texto: 'hola' })
  await chat(request, s, { lat: 14.82, lon: -89.39 })
  await chat(request, s, { boton: 'milpa' })
  await chat(request, s, { boton: 'no' })
  await chat(request, s, { boton: 'no' })
  await chat(request, s, { boton: 'comida' })
  let m = await chat(request, s, { boton: 'sub_si' })
  expect(ids(m)).toContain('sembro_si')
  await chat(request, s, { boton: 'sembro_si' })
  m = await chat(request, s, { texto: '20/05' })
  expect(m.map((x) => x.texto).join(' ')).toMatch(/Listo|avisar/i)
  // Fecha de la demo: el primer aviso de canícula acertado de la máquina del tiempo 2026 (jun–ago).
  const tl = await (await request.get('/api/alerts/timeline?municipio=jocotan-chiquimula&anio=2026')).json()
  const av = tl.alertas.find((x: any) => x.tipo === 'canicula' && x.fecha >= '2026-06-01' && x.fecha <= '2026-08-31' && x.verificacion === 'acierto')
  expect(av, 'sin aviso de canícula acertado en 2026').toBeTruthy()
  const run = await request.post(`/api/admin/run-alerts?date=${av.fecha}&force=1`, { headers: ADMIN })
  expect(run.ok(), `run-alerts ${run.status()}`).toBeTruthy()
  console.log('run-alerts', (await run.text()).slice(0, 300))
  // El aviso queda en la bandeja del simulador: GET /api/chat?session_id=
  const pend = await request.get(`/api/chat?session_id=${s}&sesion=${s}`)
  expect(pend.ok()).toBeTruthy()
  const inbox = (await pend.json()) as Msg[]
  console.log('bandeja', JSON.stringify(inbox).slice(0, 400))
  expect(inbox.length, 'sin avisos en la bandeja').toBeGreaterThan(0)
  expect(inbox.map((x) => x.texto).join(' ')).toMatch(/can[íi]cula|dry spell|racha seca/i)
})
