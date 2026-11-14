// Trozos GLSL compartidos (ruido, sombras de nubes, escarcha).
import * as THREE from 'three'

/** Uniforms globales que comparten todos los materiales (se actualizan una vez por cuadro). */
export function crearUniformsGlobales() {
  return {
    uTime: { value: 0 },
    uWind: { value: 0.2 }, // 0..1
    uWindDir: { value: new THREE.Vector2(0.8, 0.6).normalize() },
    uGust: { value: 0 },
    uCloud: { value: 0.2 }, // cobertura de nubes (sombras que pasan)
    uCloudOff: { value: new THREE.Vector2() },
    uFrost: { value: 0 },
    uWet: { value: 0.3 }, // superficie mojada (lluvia reciente)
    uDry: { value: 0 }, // sequía visible
    uHeat: { value: 0 },
    uFlash: { value: 0 },
  }
}
export type UniformsGlobales = ReturnType<typeof crearUniformsGlobales>

export const GLSL_RUIDO = /* glsl */ `
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
vec2 h22(vec2 p){ float n = h21(p); return vec2(n, h21(p+n)); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s; }
// distancia al borde de celda de voronoi (grietas)
float voroBorde(vec2 p){ vec2 n=floor(p), f=fract(p); vec2 mg, mr; float md=8.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 o=h22(n+g); vec2 r=g+o-f; float d=dot(r,r); if(d<md){md=d; mr=r; mg=g;} }
  md=8.0;
  for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){ vec2 g=mg+vec2(float(i),float(j)); vec2 o=h22(n+g); vec2 r=g+o-f; if(dot(mr-r,mr-r)>0.00001) md=min(md, dot(0.5*(mr+r), normalize(r-mr))); }
  return md; }
`

/** Sombra de nubes que pasan sobre el terreno (multiplica la luz directa). */
export const GLSL_NUBES = /* glsl */ `
uniform float uCloud; uniform vec2 uCloudOff;
float sombraNubes(vec2 xz){
  if(uCloud < 0.02) return 1.0;
  float n = fbm(xz*0.0065 + uCloudOff);
  float cov = smoothstep(1.0 - uCloud*0.95, 1.0 - uCloud*0.95 + 0.22, n + uCloud*0.25);
  return 1.0 - cov*0.62*min(1.0, uCloud*1.6);
}
`

/** Inyecta la sombra de nubes en la luz directa de un MeshStandardMaterial (antes de sumar luces). */
export function inyectarSombraNubes(shader: { fragmentShader: string }) {
  shader.fragmentShader = shader.fragmentShader.replace(
    '#include <lights_fragment_end>',
    `#include <lights_fragment_end>
     { float sn = sombraNubes(vMundo.xz); reflectedLight.directDiffuse *= sn; reflectedLight.directSpecular *= sn; }`,
  )
}
