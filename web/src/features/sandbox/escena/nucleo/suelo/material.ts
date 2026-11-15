// Materiales procedurales del terreno (se encadenan al material de la superficie de la maqueta).
// Cada píxel es su material real, cerca y lejos (pasto, arena con ondas, roca con grietas, tierra con terrones,
// asfalto, humedal con charcos, hojarasca y, en ciudad y patios, grama cortada, tierra apisonada, grava y concreto),
// con relieve en las normales. La foto satelital solo tiñe (matiz y brillo muy borrosos). Triplanar en roca.
import * as THREE from 'three'

export function crearUniformsSueloMat(L: number, calidad: 'alta' | 'media' | 'baja') {
  const vacio = new THREE.DataTexture(new Uint8Array([255, 0, 0, 0]), 1, 1)
  vacio.needsUpdate = true
  const vacioC = new THREE.DataTexture(new Uint8Array([0, 0, 0, 0]), 1, 1)
  vacioC.needsUpdate = true
  const [near, far] = calidad === 'alta' ? [20, 220] : calidad === 'media' ? [16, 180] : [12, 110]
  return {
    uSplatA: { value: vacio as THREE.Texture },
    uSplatB: { value: vacio as THREE.Texture },
    uSplatC: { value: vacioC as THREE.Texture },
    uAguaMap: { value: vacio as THREE.Texture },
    uMaqL: { value: L },
    uSNear: { value: near },
    uSFar: { value: far },
    uArido: { value: 0 },
  }
}
export type UniformsSueloMat = ReturnType<typeof crearUniformsSueloMat>

export const GLSL_SUELO = /* glsl */ `
uniform sampler2D uSplatA, uSplatB, uSplatC, uAguaMap;
uniform float uMaqL, uSNear, uSFar, uArido;
varying vec3 vNormW;
vec2 gSG = vec2(0.0); float gSR = 0.92; float gSK = 0.0;
vec3 sLin(vec3 c){ return pow(c, vec3(2.2)); }
float sLum(vec3 c){ return dot(c, vec3(0.2126,0.7152,0.0722)); }
float sAf(float f, float fw){ return 1.0 - smoothstep(0.2, 0.5, f*fw); }
float sSeco(){ return clamp(uSeason*0.75 + uDry*0.85, 0.0, 1.0); }
// celdas (F1, F2−F1) en 3×3: grietas, terrones, piedras — barato de compilar
vec3 sCelda(vec2 p){
  vec2 n = floor(p), f = fract(p);
  float d1 = 8.0, d2 = 8.0; vec2 id = vec2(0.0);
  for (int j=-1;j<=1;j++) for (int i=-1;i<=1;i++){
    vec2 g = vec2(float(i),float(j)); vec2 r = g + h22(n+g) - f; float d = dot(r,r);
    if (d < d1){ d2 = d1; d1 = d; id = n+g; } else if (d < d2) d2 = d;
  }
  return vec3(sqrt(d1), sqrt(d2)-sqrt(d1), h21(id));
}

/** Color final (satélite + material). Deja normal (gradiente de altura) y rugosidad en gSG/gSR/gSK. */
vec3 sueloColor(vec3 sat, vec3 satB, vec3 P){
  vec2 uvS = P.xz/uMaqL + 0.5;
  vec4 a = texture2D(uSplatA, uvS), b = texture2D(uSplatB, uvS), cc = texture2D(uSplatC, uvS);
  float agua = texture2D(uAguaMap, uvS).r;
  vec2 p = P.xz;
  vec2 dpx = dFdx(p), dpy = dFdy(p);
  float fw = max(length(abs(dpx)+abs(dpy)), 1e-4);
  float near = 1.0 - smoothstep(uSNear, uSFar, distance(cameraPosition, P));
  vec3 nw = normalize(vNormW);
  // bordes nítidos e irregulares entre materiales (la cobertura llega suavizada a ~4 m: sin esto son manchas borrosas)
  {
    // 3 ruidos combinados dan 11 variaciones (barato)
    vec3 nq = vec3(vnoise(p*0.31), vnoise(p*0.27 + 5.1), vnoise(p*0.83 + 9.7));
    vec4 nA = vec4(nq.x, nq.y, 1.0 - nq.x, 1.0 - nq.y)*0.8 + nq.z*0.2;
    vec4 nC = vec4(0.5*(nq.x + nq.y), 1.0 - 0.5*(nq.x + nq.y), 0.5*(nq.x + 1.0 - nq.y), 0.5*(1.0 - nq.x + nq.y))*0.8 + (1.0 - nq.z)*0.2;
    vec3 nB = vec3(nq.y, nq.x, 0.5)*0.8 + nq.z*0.2;
    float k = 2.6;
    a = pow(a*(0.55 + 0.9*nA), vec4(k)); cc = pow(cc*(0.55 + 0.9*nC), vec4(k));
    b.rgb = pow(b.rgb*(0.55 + 0.9*nB), vec3(k));
  }
  float ws = a.r+a.g+a.b+a.a+b.r+b.g+b.b+cc.r+cc.g+cc.b+cc.a + 1e-4;
  vec3 col = vec3(0.0), cb = vec3(0.0); float H = 0.0; float rough = 0.0;
  float seco = sSeco();
  float n1 = vnoise(p*0.3), n2 = vnoise(p*2.2 + 3.7), n3 = vnoise(p*9.0 + 1.3);
  float m = fbm(p*0.07);
  if (a.r > 0.02) { // pasto (de lejos: textura; cerca: briznas aparte)
    vec3 verde = mix(sLin(vec3(0.24,0.37,0.11)), sLin(vec3(0.40,0.49,0.17)), m);
    vec3 sec = mix(sLin(vec3(0.50,0.43,0.22)), sLin(vec3(0.68,0.59,0.34)), m);
    vec3 c = mix(verde, sec, clamp(seco + (n2-0.5)*0.35*seco + (m-0.5)*0.5*seco, 0.0, 1.0));
    c *= (0.8 + 0.34*mix(0.5, n2, sAf(2.2,fw))) * (0.88 + 0.24*mix(0.5, n3, sAf(9.0,fw)));
    // de lejos: manchones (más verde donde junta agua, pajizo en lomas, matas oscuras)
    float mac = fbm(p*0.022 + 4.0);
    c *= 0.8 + 0.4*mac;
    c = mix(c, mix(sLin(vec3(0.46,0.44,0.22)), sLin(vec3(0.6,0.52,0.3)), seco), smoothstep(0.58, 0.78, fbm(p*0.05 + 1.0))*0.45);
    c = mix(c, c*vec3(0.7,0.8,0.65), smoothstep(0.6, 0.75, vnoise(p*0.35 + 2.0))*0.5*sAf(0.35, fw));
    cb += a.r*sLin(vec3(0.34,0.44,0.15)); col += a.r*c; H += a.r*(n1*0.45 + n2*0.06*sAf(2.2,fw) + n3*0.02*sAf(9.0,fw)); rough += a.r*0.95;
  }
  if (a.g > 0.02) { // arena: ondas asimétricas y dunas
    float ang = (vnoise(p*0.04)-0.5)*1.4; vec2 d = vec2(cos(ang)*0.8 - sin(ang)*0.6, sin(ang)*0.8 + cos(ang)*0.6);
    float sw = fract((dot(p,d)*5.6 + m*2.2 + n1*0.6)/6.2831);
    float r = smoothstep(0.0, 0.72, sw) * (1.0 - smoothstep(0.72, 1.0, sw));
    float duna = (fbm(p*0.016)*5.0 + n1*1.0) * (0.25 + uArido);
    vec3 c = mix(sLin(vec3(0.88,0.71,0.50)), sLin(vec3(0.80,0.60,0.40)), m) * (0.93 + 0.14*n2) * (0.95 + 0.1*r*sAf(3.5,fw));
    c += step(0.985, h21(floor(p*55.0))) * sAf(55.0,fw) * 0.35; // destellos de cuarzo
    cb += a.g*sLin(vec3(0.84,0.66,0.45)); col += a.g*c; H += a.g*(r*0.04*sAf(3.5,fw) + duna); rough += a.g*0.78;
  }
  if (a.b > 0.02) { // roca: triplanar, estratos, grietas, líquenes
    vec3 bw = pow(abs(nw), vec3(4.0)); bw /= (bw.x+bw.y+bw.z);
    float nr = bw.x*vnoise(P.zy*0.6) + bw.y*vnoise(P.xz*0.6) + bw.z*vnoise(P.xy*0.6);
    float fino = bw.x*vnoise(P.zy*4.0) + bw.y*vnoise(P.xz*4.0) + bw.z*vnoise(P.xy*4.0);
    vec3 ce = sCelda(p*0.42);
    float grieta = (1.0 - smoothstep(0.0, 0.06 + fw*0.1, ce.y)) * sAf(0.42,fw);
    vec3 c = mix(sLin(vec3(0.36,0.34,0.31)), sLin(vec3(0.58,0.55,0.50)), nr*0.7 + m*0.3);
    c *= mix(1.0, 0.82 + 0.3*(0.5+0.5*sin(P.y*2.4 + n1*4.0)), 1.0 - bw.y);
    c *= (0.85 + 0.3*mix(0.5, fino, sAf(4.0,fw))) * (0.9 + 0.2*ce.z);
    c = mix(c, sLin(vec3(0.48,0.50,0.32)), smoothstep(0.62, 0.75, n2)*bw.y*0.45);
    c = mix(c, c*0.35, grieta);
    cb += a.b*sLin(vec3(0.47,0.45,0.41)); col += a.b*c; H += a.b*(nr*0.9 + fino*0.05*sAf(4.0,fw) - grieta*0.1); rough += a.b*0.86;
  }
  if (a.a > 0.02) { // tierra: terrones, piedritas, surcos
    vec3 ce = sCelda(p*2.6 + vec2(n2, n1)*0.8);
    float terron = smoothstep(0.0, 0.4, ce.y) * sAf(2.6,fw);
    vec2 cp = floor(p*4.0), fp = fract(p*4.0) - 0.5 - (h22(cp)-0.5)*0.6;
    float pied = step(0.82, h21(cp+3.3)) * (1.0 - smoothstep(0.08, 0.16 + 0.05*h21(cp), length(fp*vec2(1.0,1.3)))) * sAf(4.0,fw);
    float ang = vnoise(p/70.0)*3.1416;
    float surco = (0.5+0.5*sin(dot(p, vec2(cos(ang), sin(ang)))*7.85)) * smoothstep(0.45, 0.6, vnoise(p/45.0 + 3.7)) * sAf(1.25,fw);
    vec3 c = mix(sLin(vec3(0.42,0.30,0.20)), sLin(vec3(0.30,0.21,0.14)), m);
    c = mix(c, c*0.62, clamp(uHum*0.8 + uWet*0.6, 0.0, 1.0));
    c *= mix(0.84, 1.04, terron) * (0.92 + 0.12*surco);
    c = mix(c, sLin(vec3(0.58,0.54,0.48))*(0.8+0.4*h21(cp+1.0)), pied*0.75);
    cb += a.a*sLin(vec3(0.36,0.26,0.17)); col += a.a*c; H += a.a*(terron*0.018 + surco*0.05 + n1*0.1); rough += a.a*mix(0.93, 0.6, uWet);
  }
  if (b.r > 0.02) { // urbano: concreto/asfalto gastado (el dibujo lo pone la foto)
    float asf = smoothstep(0.4, 0.6, vnoise(p*0.05+2.0));
    vec3 conc = sLin(vec3(0.58,0.57,0.54)) * (0.9 + 0.14*n1);
    vec3 asfal = sLin(vec3(0.24,0.24,0.25)) * (0.88 + 0.24*mix(0.5, h21(floor(p*40.0)), sAf(40.0,fw)));
    cb += b.r*sLin(vec3(0.42,0.42,0.41)); col += b.r*mix(conc, asfal, asf*0.7)*(0.85 + 0.25*m); H += b.r*(n1*0.02); rough += b.r*0.84;
  }
  if (b.g > 0.02) { // humedal: lodo, juncos y charcos
    float charco = smoothstep(0.56, 0.62, m*0.6 + n1*0.5);
    vec3 lodo = mix(sLin(vec3(0.24,0.22,0.15)), sLin(vec3(0.33,0.34,0.20)), n2);
    vec3 junco = sLin(vec3(0.30,0.40,0.16)) * (0.8 + 0.3*n3);
    vec3 c = mix(lodo, junco, smoothstep(0.4, 0.7, n1)*(1.0-charco));
    c = mix(c, mix(sLin(vec3(0.12,0.14,0.12)), uSkyCol*0.55, 0.5), charco);
    cb += b.g*sLin(vec3(0.27,0.29,0.17)); col += b.g*c; H += b.g*(n1*0.12 + n3*0.015*sAf(9.0,fw))*(1.0-charco); rough += b.g*mix(0.8, 0.07, charco);
  }
  if (b.b > 0.02) { // hojarasca bajo los árboles
    vec3 c = mix(sLin(vec3(0.30,0.22,0.13)), sLin(vec3(0.43,0.31,0.17)), n2);
    c = mix(c, sLin(vec3(0.22,0.29,0.12)), smoothstep(0.55, 0.75, n1)*0.7);
    float hoja = h21(floor(p*7.0));
    c = mix(c, mix(sLin(vec3(0.55,0.38,0.18)), sLin(vec3(0.36,0.24,0.12)), hoja), 0.45*sAf(7.0,fw));
    cb += b.b*sLin(vec3(0.37,0.27,0.15)); col += b.b*c; H += b.b*(n1*0.25 + n2*0.05*sAf(2.2,fw)); rough += b.b*0.92;
  }
  if (cc.r > 0.02) { // grama: césped cortado (franjas de la podadora, tréboles, calvas) y borde con tierra y maleza
    float ang = floor(vnoise(p*0.012)*4.0)*0.785;
    vec2 dd = vec2(cos(ang), sin(ang));
    float franja = step(0.5, fract(dot(p, dd)/1.6)) * sAf(0.6, fw) * smoothstep(0.35, 0.6, vnoise(p*0.02 + 9.1));
    vec3 c = mix(sLin(vec3(0.25,0.36,0.13)), sLin(vec3(0.38,0.45,0.19)), m);
    c = mix(c, sLin(vec3(0.44,0.45,0.24)), smoothstep(0.55, 0.8, fbm(p*0.09 + 3.0))*0.6); // zonas más pajizas
    float macro = fbm(p*0.025 + 1.3);
    c *= 0.82 + 0.36*macro;                                              // jardines más y menos cuidados
    c = mix(c, c*vec3(0.85,1.0,0.8), smoothstep(0.5, 0.7, vnoise(p*0.045 + 6.0))*0.5); // verdes más fríos
    c = mix(c, sLin(vec3(0.53,0.47,0.25)), clamp(seco*0.85 + (n1-0.5)*0.4*seco, 0.0, 1.0));
    c *= 1.0 + 0.07*(franja - 0.5);
    float trebol = smoothstep(0.62, 0.72, vnoise(p*0.7 + 4.0)) * sAf(0.7, fw);
    c = mix(c, c*vec3(0.78,0.9,0.78), trebol*0.6);
    c *= 0.86 + 0.24*mix(0.5, n3, sAf(9.0,fw));
    float calva = smoothstep(0.7, 0.8, fbm(p*0.18 + 2.0)) * (0.4 + seco);
    c = mix(c, sLin(vec3(0.45,0.36,0.24)), calva*0.6);
    float fg = cc.r/ws;
    float borde = smoothstep(0.12, 0.35, fg) * (1.0 - smoothstep(0.45, 0.85, fg));
    c = mix(c, mix(sLin(vec3(0.42,0.33,0.22)), sLin(vec3(0.30,0.40,0.14)), smoothstep(0.4, 0.6, n2)), borde*0.7);
    vec2 cf = floor(p*6.0); vec2 ff = fract(p*6.0) - 0.5;
    float flor = step(0.985 - borde*0.03, h21(cf + 7.7)) * (1.0 - smoothstep(0.08, 0.16, length(ff))) * sAf(6.0, fw) * (1.0 - seco);
    float hf = h21(cf + 2.1);
    c = mix(c, hf < 0.45 ? sLin(vec3(0.93,0.92,0.86)) : hf < 0.8 ? sLin(vec3(0.95,0.8,0.2)) : sLin(vec3(0.66,0.48,0.82)), flor*0.85);
    cb += cc.r*sLin(vec3(0.31,0.45,0.15)); col += cc.r*c; H += cc.r*(n2*0.03*sAf(2.2,fw) + n3*0.02*sAf(9.0,fw) + franja*0.01); rough += cc.r*0.9;
  }
  if (cc.g > 0.02) { // tierra apisonada: lisa, huellas de llanta y de pies, piedritas, grietas con sequía, charcos con lluvia
    vec3 ce = sCelda(p*0.9 + vec2(n1, n2)*0.3);
    float grieta = (1.0 - smoothstep(0.0, 0.035 + fw*0.08, ce.y)) * sAf(0.9, fw) * smoothstep(0.35, 0.8, seco);
    float ang = vnoise(p*0.01)*3.1416;
    vec2 dd = vec2(cos(ang), sin(ang)), dn = vec2(-dd.y, dd.x);
    float rod = (1.0 - smoothstep(0.08, 0.28, abs(fract(dot(p, dn)/2.4) - 0.5) - 0.18)) * smoothstep(0.55, 0.7, vnoise(p*0.03 + 1.7)) * sAf(0.4, fw);
    vec2 cp = floor(p*5.0), fp = fract(p*5.0) - 0.5 - (h22(cp)-0.5)*0.5;
    float pied = step(0.88, h21(cp+5.1)) * (1.0 - smoothstep(0.07, 0.13, length(fp))) * sAf(5.0, fw);
    vec3 c = mix(sLin(vec3(0.60,0.49,0.36)), sLin(vec3(0.50,0.40,0.29)), m*0.8 + n2*0.2);
    c *= 0.92 + 0.12*mix(0.5, n3, sAf(9.0,fw));
    c = mix(c, c*0.84, rod*0.5);
    c = mix(c, sLin(vec3(0.66,0.62,0.55))*(0.85+0.3*h21(cp)), pied*0.7);
    c = mix(c, c*0.55, grieta);
    // lote baldío: manchones de maleza y zacate seco
    float mal = smoothstep(0.58, 0.72, fbm(p*0.11 + 6.0) + n2*0.12) * (1.0 - rod);
    vec3 cm = mix(sLin(vec3(0.33,0.38,0.16)), sLin(vec3(0.55,0.49,0.28)), clamp(seco + (n1-0.5)*0.6, 0.0, 1.0)) * (0.8 + 0.35*mix(0.5, n3, sAf(9.0,fw)));
    c = mix(c, cm, mal*0.85);
    float moj = clamp(uHum*0.6 + uWet*0.8, 0.0, 1.0);
    c = mix(c, c*0.6, moj);
    float charco = smoothstep(0.62, 0.68, fbm(p*0.25 + 5.0) + rod*0.12) * uWet;
    c = mix(c, mix(sLin(vec3(0.18,0.16,0.13)), uSkyCol*0.6, 0.55), charco);
    cb += cc.g*sLin(vec3(0.55,0.45,0.33)); col += cc.g*c; H += cc.g*(n1*0.03 - rod*0.03 + pied*0.01 - grieta*0.01)*(1.0 - charco); rough += cc.g*mix(mix(0.9, 0.55, moj), 0.06, charco);
  }
  if (cc.b > 0.02) { // grava: piedritas sueltas de colores
    vec3 ce = sCelda(p*8.0);
    float piedra = smoothstep(0.0, 0.18, ce.y) * sAf(8.0, fw);
    vec3 cpie = mix(sLin(vec3(0.56,0.54,0.5)), sLin(vec3(0.68,0.62,0.52)), ce.z);
    cpie = mix(cpie, sLin(vec3(0.42,0.40,0.38)), step(0.8, ce.z));
    vec3 c = mix(sLin(vec3(0.52,0.49,0.44))*(0.9 + 0.15*n2), cpie*(0.75 + 0.35*piedra), sAf(8.0, fw));
    c *= 0.9 + 0.15*m;
    c = mix(c, c*0.7, clamp(uWet*0.6, 0.0, 1.0));
    cb += cc.b*sLin(vec3(0.54,0.51,0.46)); col += cc.b*c; H += cc.b*(piedra*0.025 + n1*0.02); rough += cc.b*0.88;
  }
  if (cc.a > 0.02) { // concreto: losas con juntas, manchas, grietas y algo de musgo
    vec2 lo = p/vec2(3.0, 2.5);
    vec2 fl = fract(lo), il = floor(lo);
    float junta = (1.0 - smoothstep(0.0, 0.02 + fw*0.3, min(min(fl.x, 1.0-fl.x)*3.0, min(fl.y, 1.0-fl.y)*2.5))) * sAf(0.4, fw);
    vec3 c = sLin(vec3(0.57,0.555,0.52)) * (0.88 + 0.14*h21(il)) * (0.88 + 0.14*n1);
    c *= 1.0 - 0.18*smoothstep(0.55, 0.8, fbm(p*0.3 + 8.0)); // manchas
    vec3 ce = sCelda(p*0.6);
    float grieta = (1.0 - smoothstep(0.0, 0.02 + fw*0.05, ce.y)) * step(0.7, h21(il + 3.0)) * sAf(0.6, fw);
    c = mix(c, c*0.55, max(junta*0.7, grieta*0.8));
    c = mix(c, sLin(vec3(0.36,0.40,0.24)), junta*smoothstep(0.5, 0.7, n2)*0.4*(1.0 - seco));
    c = mix(c, c*0.72, clamp(uWet*0.7, 0.0, 1.0));
    cb += cc.a*sLin(vec3(0.55,0.54,0.5)); col += cc.a*c; H += cc.a*(-junta*0.012 - grieta*0.006 + n1*0.004); rough += cc.a*mix(0.8, 0.35, uWet);
  }
  col /= ws; cb /= ws; H /= ws; rough /= ws;
  // normal por derivadas de pantalla (una sola evaluación de la altura)
  vec2 dh = vec2(dFdx(H), dFdy(H));
  float det = dpx.x*dpy.y - dpx.y*dpy.x;
  vec2 g = abs(det) > 1e-8 ? vec2(dh.x*dpy.y - dh.y*dpx.y, dh.y*dpx.x - dh.x*dpy.x)/det : vec2(0.0);
  g = clamp(g, vec2(-1.5), vec2(1.5));
  // orilla mojada (barro/arena oscura y brillante junto al agua)
  float wet = clamp(b.a*1.15, 0.0, 1.0) * (1.0 - smoothstep(0.4, 0.75, agua));
  col = mix(col, col*vec3(0.64,0.62,0.6), wet*0.75);
  rough = mix(rough, 0.35, wet*0.8);
  // la foto ya no dibuja el suelo: solo tiñe (matiz y brillo de una versión muy borrosa), algo más de lejos
  // para que la maqueta entera conserve los tonos del lugar; el dibujo y el detalle son del material
  float dC = distance(cameraPosition, P);
  float ls = sLum(satB) + 1e-3, lb = sLum(cb) + 1e-3;
  vec3 matiz = clamp((satB/ls) / max(cb/lb, vec3(0.05)), vec3(0.75), vec3(1.3));
  float brillo = clamp(ls/lb, 0.72, 1.3);
  float tinte = mix(0.1, 0.42, smoothstep(40.0, 700.0, dC));
  vec3 c = col * mix(vec3(1.0), matiz*brillo, tinte);
  gSG = g; gSR = rough; gSK = mix(0.55, 1.0, near);
  return c;
}
`

/**
 * Encadena los materiales del suelo al material de la superficie (no rompe lo de la parcela: escena4 sigue
 * pintando su suelo vivo encima, y dentro de la parcela no toco normales).
 */
export function parcharSuperficie(mat: THREE.MeshStandardMaterial, US2: UniformsSueloMat, calidad: 'alta' | 'media' | 'baja') {
  const previo = mat.onBeforeCompile
  mat.onBeforeCompile = (sh, r) => {
    previo.call(mat, sh, r)
    Object.assign(sh.uniforms, US2)
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vNormW;')
      .replace('#include <defaultnormal_vertex>', '#include <defaultnormal_vertex>\nvNormW = normalize(mat3(modelMatrix) * objectNormal);')
    let f = sh.fragmentShader
    // el material de escena4 declara vMundo, ruido y uniforms del suelo; si no estuvieran, los agrego
    const pre = (f.includes('varying vec3 vMundo') ? '' : 'varying vec3 vMundo;\n') + GLSL_SUELO
    f = f.replace('void main() {', pre + '\nvoid main() {')
    const ancla = 'vec3 c = diffuseColor.rgb;'
    if (f.includes(ancla)) {
      f = f.replace(ancla, `vec3 c = diffuseColor.rgb;
        c = sueloColor(c, texture2D(map, vMapUv, 4.5).rgb, vMundo);`)
    } else {
      f = f.replace('#include <map_fragment>', `#include <map_fragment>
        diffuseColor.rgb = sueloColor(diffuseColor.rgb, texture2D(map, vMapUv, 4.5).rgb, vMundo);`)
    }
    // dentro de la parcela manda el suelo vivo de escena4
    f = f.replace('c = mix(c, suelo, mP);', 'c = mix(c, suelo, mP);\n        gSK *= 1.0 - mP;')
    f = f.replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>
      if (gSK > 0.001) {
        vec3 nW = normalize(vNormW);
        vec3 nP = normalize(nW - vec3(gSG.x, 0.0, gSG.y) * gSK * 0.9);
        vec3 nV = normalize((viewMatrix * vec4(nP, 0.0)).xyz);
        normal = normalize(mix(normal, nV, ${calidad === 'baja' ? '0.6' : '1.0'}));
      }`)
    const gloss = f.includes('float gGloss') ? '*(1.0 - clamp(gGloss, 0.0, 1.0))' : ''
    f = f.replace('#include <metalnessmap_fragment>', `#include <metalnessmap_fragment>
      roughnessFactor = mix(roughnessFactor, gSR, clamp(gSK, 0.0, 1.0)${gloss});`)
    if (!f.includes('float vnoise(')) f = f.replace(pre, '' + GLSL_RUIDO_MIN + pre)
    sh.fragmentShader = f
  }
  const clave = mat.customProgramCacheKey?.bind(mat)
  mat.customProgramCacheKey = () => (clave ? clave() : '') + '|suelo2-' + calidad
  mat.needsUpdate = true
}

// Por si el material de base no trae el ruido compartido (preview sin escena4)
const GLSL_RUIDO_MIN = /* glsl */ `
uniform float uSeason, uDry, uHum, uWet; uniform vec3 uSkyCol;
float h21(vec2 p){ p = fract(p*vec2(123.34,456.21)); p += dot(p,p+45.32); return fract(p.x*p.y); }
vec2 h22(vec2 p){ float n = h21(p); return vec2(n, h21(p+n)); }
float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); vec2 u=f*f*(3.0-2.0*f);
  return mix(mix(h21(i),h21(i+vec2(1,0)),u.x), mix(h21(i+vec2(0,1)),h21(i+vec2(1,1)),u.x), u.y); }
float fbm(vec2 p){ float a=0.5, s=0.0; for(int i=0;i<4;i++){ s+=a*vnoise(p); p=p*2.03+vec2(17.1,9.2); a*=0.5; } return s; }
float voroBorde(vec2 p){ vec2 n=floor(p), f=fract(p); vec2 mg, mr; float md=8.0;
  for(int j=-1;j<=1;j++) for(int i=-1;i<=1;i++){ vec2 g=vec2(float(i),float(j)); vec2 o=h22(n+g); vec2 r=g+o-f; float d=dot(r,r); if(d<md){md=d; mr=r; mg=g;} }
  md=8.0;
  for(int j=-2;j<=2;j++) for(int i=-2;i<=2;i++){ vec2 g=mg+vec2(float(i),float(j)); vec2 o=h22(n+g); vec2 r=g+o-f; if(dot(mr-r,mr-r)>0.00001) md=min(md, dot(0.5*(mr+r), normalize(r-mr))); }
  return md; }
`
