// Materiales de la ciudad (MeshStandardMaterial + trozos GLSL): fachadas con ventanas, puertas, zócalo y
// pátina; techos de losa, lámina acanalada, teja o pizarra con la foto satelital mezclada; calles de asfalto
// con marcas, terracería con huellas y banquetas con juntas. Reciben sombras y la sombra de nubes.
import * as THREE from 'three'
import { GLSL_NUBES, GLSL_RUIDO, type UniformsGlobales } from '../glsl'

type U = Partial<UniformsGlobales>

function base(U: U | undefined, clave: string, extra: (sh: THREE.WebGLProgramParametersWithUniforms) => void, opts: THREE.MeshStandardMaterialParameters = {}) {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, metalness: 0, ...opts })
  const conNubes = !!(U && U.uCloud && U.uCloudOff)
  m.onBeforeCompile = (sh) => {
    if (conNubes) Object.assign(sh.uniforms, { uCloud: U!.uCloud, uCloudOff: U!.uCloudOff })
    sh.uniforms.uWet = U?.uWet ?? { value: 0 }
    sh.uniforms.uDry = U?.uDry ?? { value: 0 }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMundo; varying vec3 vLocal;')
      .replace('#include <fog_vertex>', `#include <fog_vertex>
        vLocal = position;
        #ifdef USE_INSTANCING
          vMundo = (modelMatrix * instanceMatrix * vec4(transformed,1.0)).xyz; vLocal = (instanceMatrix * vec4(position,1.0)).xyz;
        #else
          vMundo = (modelMatrix * vec4(transformed,1.0)).xyz;
        #endif`)
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', `#include <common>
        varying vec3 vMundo; varying vec3 vLocal; uniform float uWet, uDry;
        ${GLSL_RUIDO}
        ${conNubes ? GLSL_NUBES : 'float sombraNubes(vec2 p){ return 1.0; }'}`)
      .replace('#include <lights_fragment_end>', `#include <lights_fragment_end>
        { float sn = sombraNubes(vMundo.xz); reflectedLight.directDiffuse *= sn; reflectedLight.directSpecular *= sn; }`)
    extra(sh)
  }
  m.customProgramCacheKey = () => 'ciudad-' + clave + (conNubes ? '-n' : '')
  return m
}

/** Muros. Atributos: aFach = (u a lo largo de la arista m, v altura sobre el suelo m, largo arista, alto del muro);
 * aInfo = (semilla 0..1, fachada, alto de nivel, u de la puerta o -1). */
export function materialMuros(U?: U) {
  return base(U, 'muros', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aFach; attribute vec4 aInfo; varying vec4 vFach; varying vec4 vInfo;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFach = aFach; vInfo = aInfo;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vFach; varying vec4 vInfo;\nfloat vidrioF; float marcoF;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float u = vFach.x, v = vFach.y, largo = vFach.z, alto = vFach.w;
        // la interpolación mueve los valores constantes en ~1e-6 y el hash lo amplifica: se cuantizan
        float sem = floor(vInfo.x*512.0 + 0.5)/512.0, fach = floor(vInfo.y + 0.5), nh = max(2.6, vInfo.z), pu = vInfo.w;
        vec3 muro = pow(diffuseColor.rgb, vec3(1.0/2.2)); // se trabaja en sRGB y se vuelve a lineal al final
        // pátina: manchas de lluvia bajo las ventanas y suciedad abajo
        float n1 = fbm(vec2(u*0.35 + sem*40.0, v*0.25));
        muro *= 0.9 + 0.16*n1;
        muro *= 1.0 - 0.18*smoothstep(1.6, 0.0, v);
        vidrioF = 0.0; marcoF = 0.0;
        float nivel = floor(max(v,0.0) / nh), fv = v - nivel*nh;
        bool bajo = nivel < 0.5;
        bool hastial = v > alto - 0.05;
        float pix = max(fwidth(u), fwidth(v)); // tamaño del píxel en metros: los patrones finos se apagan de lejos
        float finoL = 1.0 - smoothstep(0.02, 0.06, pix), finoB = 1.0 - smoothstep(0.04, 0.12, pix);
        // ladrillo (Europa)
        if (abs(fach - 2.0) < 0.5) {
          vec2 b = vec2(u/0.24, v/0.075); b.x += mod(floor(b.y),2.0)*0.5;
          vec2 f = fract(b); float junta = step(f.x, 0.05) + step(f.y, 0.12);
          muro *= mix(1.0, mix(0.86 + 0.2*h21(floor(b)), 0.75, clamp(junta,0.0,1.0)*0.55) * 1.04, finoL);
        }
        // bloque visto (concreto/casa sin repellar en algunas)
        if (abs(fach) < 0.5 && sem > 0.82) {
          vec2 b = vec2(u/0.4, v/0.2); b.x += mod(floor(b.y),2.0)*0.5; vec2 f = fract(b);
          muro = mix(vec3(0.53,0.52,0.49), mix(vec3(0.55,0.54,0.51), vec3(0.4,0.39,0.37), clamp(step(f.x,0.03)+step(f.y,0.06),0.0,1.0)) * (0.92+0.12*h21(floor(b))), finoB);
        }
        // zócalo
        float zoc = 1.0 - step(0.55, v);
        vec3 colZoc = abs(fach - 1.0) < 0.5 ? muro*0.55 : vec3(0.42,0.41,0.4) * (0.9+0.1*n1);
        muro = mix(muro, colZoc, zoc);
        // cornisa / remate arriba
        float rem = smoothstep(alto - 0.35, alto - 0.3, v) * (1.0 - step(alto + 0.6, v));
        muro = mix(muro, muro*0.82, rem*0.7);
        // franjas de entrepiso en concreto y torre
        if (fach > 2.5 && fach < 3.5) {
          // torre: ventanas corridas por nivel (antepecho + vidrio) con montantes finos
          float mont = step(fract(u/1.6), 0.035) * finoB;
          float ante = 1.0 - step(0.95, fv);
          vidrioF = (1.0 - ante) * (1.0 - mont) * step(fv, nh - 0.12);
          marcoF = (1.0 - ante) * mont;
          muro = mix(muro, muro*0.78, step(nh - 0.12, fv)); // canto de losa
          if (hastial || v < 0.55 || (bajo && fv < 0.5)) { vidrioF = 0.0; marcoF = 0.0; }
        } else if (abs(fach - 4.0) < 0.5) {
          // bodega: lámina acanalada en los muros, ventilas arriba, portón
          muro *= 0.9 + 0.1*step(0.5, fract(u/0.2));
          float ve = step(alto - 1.4, v) * step(v, alto - 0.6) * step(0.25, fract(u/4.0)) * step(fract(u/4.0), 0.75);
          vidrioF = hastial ? 0.0 : ve;
        } else if (!hastial && v > 0.55) {
          // ventanas por nivel
          float paso = abs(fach - 1.0) < 0.5 ? 3.6 : (abs(fach - 2.0) < 0.5 ? 2.4 : 2.9);
          float anchoV = abs(fach - 1.0) < 0.5 ? 1.2 : (abs(fach - 2.0) < 0.5 ? 1.15 : 1.25);
          float n = max(1.0, floor((largo - 1.0) / paso));
          float c0 = (largo - n*paso)*0.5;
          float k = floor((u - c0) / paso);
          float cu = c0 + (k + 0.5)*paso;
          bool hay = k >= 0.0 && k < n && h21(vec2(k + sem*91.0, nivel)) > 0.12;
          float y0 = bajo ? 0.95 : 0.85, y1 = abs(fach - 1.0) < 0.5 ? 2.55 : (abs(fach - 2.0) < 0.5 ? 2.45 : 2.2);
          if (abs(fach - 2.0) < 0.5 && !bajo) { y0 = 0.7; y1 = 2.5; }
          float du = abs(u - cu) - anchoV*0.5;
          float enV = step(du, 0.0) * step(y0, fv) * step(fv, y1);
          float marco = step(du, 0.09) * step(y0 - 0.09, fv) * step(fv, y1 + 0.09) * (1.0 - enV);
          // puerta en planta baja (y portón de garaje al lado en casas con frente ancho)
          bool esPuerta = bajo && pu >= 0.0 && abs(u - pu) < 0.55;
          bool conPorton = abs(fach) < 0.5 && largo > 7.5 && sem > 0.3;
          float pc = pu + (sem > 0.65 ? -2.3 : 2.3);
          bool esPorton = bajo && pu >= 0.0 && conPorton && abs(u - pc) < 1.3 && pc > 1.4 && pc < largo - 1.4;
          if (bajo && pu >= 0.0 && abs(u - pu) < 1.6) hay = esPuerta;
          if (esPorton) {
            hay = false;
            float enG = step(abs(u - pc), 1.25) * step(fv, 2.3);
            vec3 colG = sem > 0.8 ? vec3(0.85,0.84,0.8) : (sem > 0.55 ? vec3(0.32,0.24,0.18) : vec3(0.36,0.38,0.4));
            colG *= 0.88 + 0.14*step(0.5, fract(fv/0.3));
            muro = mix(muro, colG, enG);
            marcoF = step(abs(u - pc), 1.33) * step(fv, 2.38) * (1.0 - enG);
          }
          if (esPuerta) {
            float enP = step(abs(u - pu), 0.5) * step(fv, 2.15);
            float mP = step(abs(u - pu), 0.6) * step(fv, 2.25) * (1.0 - enP);
            vec3 colP = sem > 0.5 ? vec3(0.28,0.17,0.1) : vec3(0.22,0.24,0.27);
            muro = mix(muro, colP * (0.85 + 0.15*step(0.5, fract(fv*2.0))), enP);
            marcoF = mP;
          } else if (hay) {
            vidrioF = enV; marcoF = marco;
            // rejas de hierro en las ventanas de abajo (casas y colonial)
            if (bajo && fach < 1.5) {
              float barra = step(fract((u - cu)/0.13 + 0.5), 0.16) + step(abs(fv - (y0 + y1)*0.5), 0.03);
              float rej = clamp(barra, 0.0, 1.0) * enV * finoB;
              vidrioF *= 1.0 - rej;
              muro = mix(muro, vec3(0.1,0.1,0.1), rej);
            }
            // repisa
            float rep = step(du, 0.14) * step(y0 - 0.16, fv) * step(fv, y0 - 0.04);
            muro = mix(muro, muro*1.12, rep);
            // balcón en concreto/edificios altos (sombra de losa)
            if (abs(fach - 5.0) < 0.5 && !bajo && h21(vec2(k, nivel + sem*7.0)) > 0.6) muro *= 1.0 - 0.25*step(fv, 0.18);
          }
          // comercio en planta baja de torres/concreto: cortina metálica o vitrina
          if (bajo && abs(fach - 5.0) < 0.5 && fv < 2.8 && fv > 0.3 && abs(u - cu) < paso*0.45 && k >= 0.0 && k < n) {
            float cort = h21(vec2(k, sem*13.0));
            if (cort > 0.5) { muro = mix(vec3(0.6,0.62,0.64), vec3(0.45,0.47,0.5), step(0.5, fract(fv*5.0))); vidrioF = 0.0; marcoF = 0.0; }
            else { vidrioF = 1.0; marcoF = 0.0; }
          }
        }
        vec3 cielo = mix(vec3(0.16,0.2,0.26), vec3(0.42,0.5,0.6), clamp(fv/nh + 0.2*h21(vec2(floor(u/2.9), nivel+sem)),0.0,1.0));
        vec3 vidrio = mix(vec3(0.08,0.1,0.13), cielo, 0.6) * (0.75 + 0.5*h21(vec2(floor(u/1.5), nivel + sem*3.0)));
        if (fach > 2.5 && fach < 3.5) {
          vec3 tinte = sem < 0.33 ? vec3(0.2,0.33,0.38) : (sem < 0.66 ? vec3(0.22,0.28,0.36) : vec3(0.3,0.27,0.22));
          vidrio = mix(tinte*0.55, tinte*1.6 + 0.12, clamp(v/max(alto,1.0)*0.9 + 0.25*n1 + 0.15*h21(vec2(floor(u/1.6), nivel)), 0.0, 1.0));
        }
        vec3 marcoC = abs(fach - 2.0) < 0.5 ? vec3(0.85,0.85,0.82) : (sem > 0.6 ? vec3(0.3,0.3,0.32) : vec3(0.78,0.77,0.74));
        muro = mix(muro, vidrio, vidrioF);
        muro = mix(muro, marcoC, marcoF);
        // humedad: muros oscurecen con lluvia
        muro *= 1.0 - uWet*0.12*(1.0 - vidrioF);
        diffuseColor.rgb = pow(max(muro, vec3(0.0)), vec3(2.2));
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.55, vidrioF);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.45, vidrioF);')
  })
}

/** Techos. aTecho = (tipo 0 losa/1 lámina/2 teja/3 pizarra, peso de la foto, semilla, 0); aDir = dirección de la cumbrera (xz). */
export function materialTechos(U: U | undefined, sat: THREE.Texture | null, L: number) {
  const uSat = { value: sat }, uL = { value: L }, uHaySat = { value: sat ? 1 : 0 }
  const m = base(U, 'techos', (sh) => {
    sh.uniforms.uSat = uSat; sh.uniforms.uL = uL; sh.uniforms.uHaySat = uHaySat
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aTecho; attribute vec2 aDir; varying vec4 vTecho; varying vec2 vDir; varying float vPend;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvTecho = aTecho; vDir = aDir; vPend = 1.0 - abs(normal.y);')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nuniform sampler2D uSat; uniform float uL, uHaySat; varying vec4 vTecho; varying vec2 vDir; varying float vPend;\nfloat brilloT;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float tipo = floor(vTecho.x + 0.5), foto = vTecho.y * uHaySat, sem = floor(vTecho.z*512.0 + 0.5)/512.0;
        vec2 p = vLocal.xz;
        vec2 d = normalize(vDir + vec2(1e-5));
        float a = dot(p, d), b = dot(p, vec2(-d.y, d.x));
        vec3 c0 = pow(diffuseColor.rgb, vec3(1.0/2.2));
        vec3 c = c0;
        brilloT = 0.0;
        if (tipo < 0.5) {
          // losa: concreto con impermeabilizante, manchas y juntas
          float n = fbm(p*0.9 + sem*30.0);
          c *= 0.86 + 0.24*n;
          c *= 1.0 - 0.12*smoothstep(0.55, 0.8, fbm(p*0.25 + 7.0));
          vec2 g = fract(p/3.0); c *= 1.0 - 0.07*(step(g.x,0.015)+step(g.y,0.015));
        } else if (tipo < 1.5) {
          // lámina acanalada: ondas a lo largo de la pendiente, traslapes y óxido
          float onda = 0.5 + 0.5*sin(b*2.0*3.14159/0.076);
          float traslape = step(fract(a/3.66), 0.02);
          c *= 0.82 + 0.3*onda - 0.1*traslape;
          float oxido = smoothstep(0.55, 0.8, fbm(p*0.6 + sem*17.0));
          c = mix(c, vec3(0.45,0.26,0.15), oxido*0.55*step(0.35, sem));
          brilloT = 0.5*(1.0 - oxido);
        } else if (tipo < 2.5) {
          // teja de barro: canales y cobijas en hileras
          float fila = floor(a/0.36);
          float t = fract(b/0.24 + 0.5*mod(fila,2.0));
          float canal = 0.55 + 0.45*sin(t*3.14159);
          float borde = smoothstep(0.0, 0.08, fract(a/0.36));
          c *= (0.72 + 0.34*canal) * (0.78 + 0.22*borde) * (0.88 + 0.24*h21(vec2(fila, floor(b/0.24))));
          c = mix(c, c*vec3(0.75,0.8,0.7), smoothstep(0.6, 0.85, fbm(p*0.5 + sem*9.0))*0.6);
        } else {
          // pizarra / teja plana oscura
          float fila = floor(a/0.22);
          float t = fract(b/0.32 + 0.5*mod(fila,2.0));
          c *= (0.85 + 0.2*h21(vec2(fila, floor(b/0.32 + 0.5*mod(fila,2.0))))) * (0.8 + 0.2*smoothstep(0.0,0.1,fract(a/0.22))) * (1.0 - 0.15*step(t,0.03));
        }
        if (foto > 0.01) {
          vec2 uv = vec2(p.x/uL + 0.5, 1.0 - (p.y/uL + 0.5));
          vec3 f = pow(texture2D(uSat, uv).rgb, vec3(1.0/2.2));
          f = mix(vec3(dot(f, vec3(0.3,0.59,0.11))), f, 0.55); // la foto satelital viene saturada y con árboles
          float lc = dot(c, vec3(0.3,0.59,0.11));
          // la foto aporta el color y las manchas reales; el patrón aporta el relieve fino
          vec3 mezcla = f * clamp(0.6 + 0.4 * lc / max(dot(c0, vec3(0.3,0.59,0.11)), 0.05), 0.5, 1.4);
          // en techos inclinados solo las manchas (luz) de la foto: el color lo pone el material
          vec3 soloLuz = c * clamp(dot(f, vec3(0.3,0.59,0.11)) / max(dot(c0, vec3(0.3,0.59,0.11)), 0.05), 0.6, 1.5);
          c = mix(c, tipo < 0.5 ? mezcla : soloLuz, foto * (tipo < 0.5 ? 1.0 : 0.6));
        }
        c *= 1.0 - uWet*0.18;
        diffuseColor.rgb = pow(max(c, vec3(0.0)), vec3(2.2));
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.38, brilloT);')
      .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.55, brilloT);')
  }, { side: THREE.DoubleSide, roughness: 0.85 })
  return Object.assign(m, { uSat, uHaySat })
}

/** Calles. aCalle = (u a lo ancho −1..1, v a lo largo m, tipo 0 asfalto/1 terracería/2 banqueta/3 peatonal/4 bordillo, marcas). */
export function materialCalles(U?: U) {
  return base(U, 'calles', (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aCalle; varying vec4 vCalle;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvCalle = aCalle;')
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec4 vCalle;\nfloat mojado;')
      .replace('#include <color_fragment>', `#include <color_fragment>
      {
        float u = vCalle.x, v = vCalle.y, tipo = floor(vCalle.z + 0.5), marcas = floor(vCalle.w + 0.5);
        vec2 p = vLocal.xz;
        vec3 c;
        mojado = uWet;
        if (tipo < 0.5) {
          float n = fbm(p*1.7), g = h21(floor(p*14.0)) * (1.0 - smoothstep(0.03, 0.08, max(fwidth(p.x), fwidth(p.y))));
          c = vec3(0.3,0.305,0.31) * (0.85 + 0.25*n + 0.08*g);
          c *= 1.0 - 0.12*smoothstep(0.62, 0.75, fbm(p*0.35 + 3.0)); // parches
          c = mix(c, c*0.82, smoothstep(0.75, 0.2, abs(abs(u)-0.45))*0.35);   // huella de llantas
          c = mix(c, vec3(0.32,0.31,0.3), smoothstep(0.86, 0.99, abs(u))*0.5); // orilla gastada
          if (marcas > 0.5 && marcas < 1.5) c = mix(c, vec3(0.88,0.86,0.8), step(abs(u), 0.03) * step(fract(v/6.0), 0.5) * 0.9);
          if (marcas > 1.5) c = mix(c, vec3(0.86,0.7,0.22), (step(abs(u - 0.02), 0.012) + step(abs(u + 0.02), 0.012)) * 0.9);
          if (marcas > 0.5) c = mix(c, vec3(0.85,0.84,0.8), step(0.93, abs(u)) * step(abs(u), 0.96) * 0.75);
        } else if (tipo < 1.5) {
          float n = fbm(p*1.3), piedras = step(0.86, h21(floor(p*6.0))) * (1.0 - smoothstep(0.05, 0.15, max(fwidth(p.x), fwidth(p.y))));
          c = vec3(0.47,0.38,0.29) * (0.8 + 0.35*n);
          c = mix(c, c*0.78, smoothstep(0.3, 0.0, abs(abs(u)-0.42))*0.6);  // rodadas
          c = mix(c, vec3(0.6,0.56,0.5), piedras*0.5);
          c = mix(c, vec3(0.36,0.42,0.22), smoothstep(0.8, 1.0, abs(u))*smoothstep(0.4,0.7,n)*(1.0-uDry)); // monte en la orilla
          c = mix(c, c*0.62, uWet*0.5);
          mojado = uWet*0.5;
        } else if (tipo < 2.5) {
          // banqueta: concreto con juntas cada 1.5 m
          float n = fbm(p*2.2);
          c = vec3(0.64,0.62,0.58) * (0.88 + 0.18*n);
          c *= 1.0 - 0.18*step(fract(v/1.5), 0.03);
          c *= 1.0 - 0.1*step(0.94, abs(u));
        } else if (tipo < 3.5) {
          float n = fbm(p*2.0);
          c = vec3(0.56,0.53,0.48) * (0.85 + 0.25*n);
        } else {
          c = vec3(0.7,0.69,0.66) * (0.9 + 0.1*fbm(p*3.0));
        }
        diffuseColor.rgb = pow(max(c, vec3(0.0)), vec3(2.2));
      }`)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.25, mojado*0.8);')
  }, { polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, roughness: 0.95 })
}

/** Detalles con color por vértice (tinacos, cuartos de azotea, varillas, árboles). */
export function materialDetalles(U?: U, hojas = false) {
  return base(U, hojas ? 'hojas' : 'detalles', (sh) => {
    if (!hojas) return
    sh.uniforms.uTime = U?.uTime ?? { value: 0 }
    sh.uniforms.uWind = U?.uWind ?? { value: 0.2 }
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime, uWind;')
      .replace('#include <begin_vertex>', `#include <begin_vertex>
        transformed.x += sin(uTime*1.4 + position.y*0.9 + position.z)*0.05*uWind*max(position.y-1.5,0.0);`)
    sh.fragmentShader = sh.fragmentShader.replace('#include <color_fragment>', `#include <color_fragment>
      { float l = dot(diffuseColor.rgb, vec3(0.3,0.59,0.11)); diffuseColor.rgb = mix(diffuseColor.rgb, vec3(l*1.3,l*1.05,l*0.55), uDry*0.5);
        diffuseColor.rgb *= 0.82 + 0.3*fbm(vLocal.xz*1.7 + vLocal.y); }`)
  }, { flatShading: !hojas })
}
