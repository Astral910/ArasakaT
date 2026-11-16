<script setup lang="ts">
// Ronda 8: el sensor SEED en 3D (el modelo real que se imprime: cuerpo + tapa de hardware/prototipo/3d), girando
// despacio. three.js se carga solo cuando se ve la tarjeta.
import { onBeforeUnmount, onMounted, ref } from 'vue'

const caja = ref<HTMLDivElement | null>(null)
let parar: (() => void) | null = null

onMounted(async () => {
  const el = caja.value
  if (!el) return
  const THREE = await import('three')
  const { STLLoader } = await import('three/examples/jsm/loaders/STLLoader.js')
  await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))) // esperar al layout
  let w = el.clientWidth || 200, h = el.clientHeight || 210
  const r = new THREE.WebGLRenderer({ antialias: true, alpha: true })
  r.setPixelRatio(Math.min(2, devicePixelRatio))
  r.setSize(w, h)
  r.toneMapping = THREE.ACESFilmicToneMapping
  el.appendChild(r.domElement)
  const ro = new ResizeObserver(() => { w = el.clientWidth || w; h = el.clientHeight || h; r.setSize(w, h); cam.aspect = w / h; cam.updateProjectionMatrix() })
  const escena = new THREE.Scene()
  const cam = new THREE.PerspectiveCamera(30, w / h, 1, 2000)
  ro.observe(el)
  escena.add(new THREE.HemisphereLight(0xfff6e6, 0x2a3a30, 1.1))
  const sol = new THREE.DirectionalLight(0xffffff, 2.2); sol.position.set(120, 200, 160); escena.add(sol)
  const contra = new THREE.DirectionalLight(0x9fe3c4, 1.0); contra.position.set(-160, 60, -120); escena.add(contra)

  const grupo = new THREE.Group()
  escena.add(grupo)
  const carga = new STLLoader()
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leer = (u: string) => new Promise<any>((ok, mal) => carga.load(u, ok, undefined, mal))
  try {
    const [gc, gt] = await Promise.all([leer('/static/seed/SEED_v4_cuerpo.stl'), leer('/static/seed/SEED_v4_tapa.stl')])
    const pla = new THREE.MeshPhysicalMaterial({ color: 0xf1ede4, roughness: 0.55, clearcoat: 0.25, clearcoatRoughness: 0.6 })
    const verde = new THREE.MeshPhysicalMaterial({ color: 0x2f8f5b, roughness: 0.5, clearcoat: 0.3 })
    const cuerpo = new THREE.Mesh(gc, pla)
    const tapa = new THREE.Mesh(gt, verde)
    // la tapa viene acostada para imprimir: se da vuelta y se apoya encima del cuerpo (cerrada)
    gt.rotateX(Math.PI)
    gc.computeBoundingBox(); gt.computeBoundingBox()
    const bc = gc.boundingBox!, bt = gt.boundingBox!
    const cc = new THREE.Vector3(), ct = new THREE.Vector3()
    bc.getCenter(cc); bt.getCenter(ct)
    gt.translate(cc.x - ct.x, cc.y - ct.y, bc.max.z - bt.min.z - 3.2)
    // centrar las geometrías en el origen: el giro queda alrededor del centro del sensor
    gt.computeBoundingBox()
    const todo = bc.clone().union(gt.boundingBox!)
    const centro = todo.getCenter(new THREE.Vector3())
    gc.translate(-centro.x, -centro.y, -centro.z)
    gt.translate(-centro.x, -centro.y, -centro.z)
    grupo.add(cuerpo, tapa)
    grupo.rotation.x = -Math.PI / 2 // Z (impresión) → Y (arriba)
    const tam = todo.getSize(new THREE.Vector3()).length()
    cam.position.set(tam * 1.45, tam * 0.95, tam * 1.6)
    cam.lookAt(0, 0, 0)
  } catch { /* sin modelo: queda el fondo */ }

  let raf = 0, t0 = performance.now()
  const paso = (t: number) => {
    grupo.rotation.z = ((t - t0) / 1000) * 0.45
    r.render(escena, cam)
    raf = requestAnimationFrame(paso)
  }
  raf = requestAnimationFrame(paso)
  parar = () => { cancelAnimationFrame(raf); ro.disconnect(); r.dispose(); r.domElement.remove() }
})
onBeforeUnmount(() => parar?.())
</script>

<template>
  <div ref="caja" class="seed3d" aria-label="Sensor SEED (modelo 3D)" role="img" />
</template>

<style scoped>
.seed3d { width: 100%; height: 100%; min-height: 220px; }
.seed3d :deep(canvas) { display: block; }
</style>
