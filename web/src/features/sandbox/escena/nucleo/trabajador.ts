// Web Worker de la escena: cálculos pesados fuera del hilo principal (campo de distancia de la parcela).
// Mensajes: { tipo, ... } → respuesta con el resultado (transferible).
import { calcularCampo } from './ubicacion'

self.onmessage = (e: MessageEvent) => {
  const m = e.data
  if (m?.tipo === 'campo') {
    const c = calcularCampo(m.poli, m.margen, m.maxLado)
    ;(self as unknown as Worker).postMessage(c, [c.d.buffer])
  }
}
