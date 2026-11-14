// Ruido de valor determinista (CPU) para relieve, texturas y ubicación de elementos.
export function hash(x: number, y: number) { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s) }
export function vnoise(x: number, y: number) {
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy)
  const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1)
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy
}
export function fbm2(x: number, y: number, oct = 5) {
  let s = 0, a = 0.5
  for (let i = 0; i < oct; i++) { s += a * vnoise(x, y); x = x * 2.03 + 17.1; y = y * 2.03 + 9.2; a *= 0.5 }
  return s
}
/** Generador pseudoaleatorio (Park–Miller) con semilla. */
export function rng(semilla: number) {
  let s = Math.abs(Math.floor(semilla * 7919)) % 2147483646 + 1
  return () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646 }
}
