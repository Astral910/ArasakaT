// Post-proceso cinematográfico en pocas pasadas: tilt-shift (desenfoque por banda, a media resolución),
// bloom barato, ondas de calor, destello, tonemapping ACES, grading cálido, viñeta y grano fino.
import * as THREE from 'three'

const VERT = `varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }`

export class Post {
  rt: THREE.WebGLRenderTarget
  private a: THREE.WebGLRenderTarget
  private b: THREE.WebGLRenderTarget
  private escena = new THREE.Scene()
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1)
  private quad: THREE.Mesh
  private blur: THREE.ShaderMaterial
  private comp: THREE.ShaderMaterial
  tiltShift = true
  u: {
    uFoco: { value: number }; uBanda: { value: number }; uTilt: { value: number }; uExp: { value: number }; uCalor: { value: number }
    uFlash: { value: number }; uGrano: { value: number }; uTime: { value: number }; uSat: { value: number }; uFrio: { value: number }; uBloom: { value: number }; uTransp: { value: number }
  }

  constructor(private renderer: THREE.WebGLRenderer, w: number, h: number, private msaa: number) {
    const tipo = THREE.HalfFloatType
    this.rt = new THREE.WebGLRenderTarget(w, h, { type: tipo, samples: msaa, depthBuffer: true })
    this.a = new THREE.WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), { type: tipo })
    this.b = new THREE.WebGLRenderTarget(Math.max(1, w >> 1), Math.max(1, h >> 1), { type: tipo })
    this.u = {
      uFoco: { value: 0.5 }, uBanda: { value: 0.22 }, uTilt: { value: 1 }, uExp: { value: 1 }, uCalor: { value: 0 }, uFlash: { value: 0 },
      uGrano: { value: 0.035 }, uTime: { value: 0 }, uSat: { value: 1.08 }, uFrio: { value: 0 }, uBloom: { value: 0.22 }, uTransp: { value: 0 },
    }
    this.blur = new THREE.ShaderMaterial({
      uniforms: { tSrc: { value: null }, uDir: { value: new THREE.Vector2() }, uFoco: this.u.uFoco, uBanda: this.u.uBanda, uTilt: this.u.uTilt },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D tSrc; uniform vec2 uDir; uniform float uFoco, uBanda, uTilt; varying vec2 vUv;
        void main(){ float d = max(abs(vUv.y - uFoco) - uBanda, 0.0); float r = clamp(d*4.0, 0.0, 1.0)*uTilt;
          vec4 s = vec4(0.0); float w = 0.0;
          for (int i = -4; i <= 4; i++) { float fi = float(i); float k = exp(-fi*fi/8.0); s += texture2D(tSrc, vUv + uDir*fi*(0.6 + r*1.7))*k; w += k; }
          gl_FragColor = s/w; }`,
      depthTest: false, depthWrite: false,
    })
    this.comp = new THREE.ShaderMaterial({
      uniforms: { tEsc: { value: this.rt.texture }, tBlur: { value: this.b.texture }, uRes: { value: new THREE.Vector2(w, h) }, ...this.u },
      vertexShader: VERT,
      fragmentShader: `uniform sampler2D tEsc, tBlur; uniform vec2 uRes; uniform float uFoco, uBanda, uTilt, uExp, uCalor, uFlash, uGrano, uTime, uSat, uFrio, uBloom, uTransp; varying vec2 vUv;
        float h21(vec2 p){ p=fract(p*vec2(123.34,456.21)); p+=dot(p,p+45.32); return fract(p.x*p.y); }
        vec3 aces(vec3 x){ const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14; return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0); }
        void main(){
          vec2 uv = vUv;
          // ondas de calor (más fuertes cerca del suelo = mitad inferior)
          float hz = uCalor * (0.4 + 0.6*smoothstep(0.75, 0.2, uv.y));
          uv += vec2(sin(uv.y*90.0 + uTime*6.0)*0.0011, cos(uv.x*70.0 + uTime*5.0)*0.0008) * hz;
          vec3 c = texture2D(tEsc, uv).rgb;
          vec3 bl = texture2D(tBlur, uv).rgb;
          float d = max(abs(uv.y - uFoco) - uBanda, 0.0);
          float m = clamp(d*3.2, 0.0, 1.0) * uTilt;
          c = mix(c, bl, m);
          // bloom barato a partir del buffer desenfocado
          c += max(bl - 0.9, 0.0) * uBloom * 2.0 + bl*uBloom*0.06;
          c += vec3(0.8,0.85,1.0) * uFlash * 0.35;
          c *= uExp;
          c = aces(c*1.05);
          // grading: sombras frías, luces cálidas
          float l = dot(c, vec3(0.2126,0.7152,0.0722));
          vec3 tinte = mix(vec3(0.95,0.98,1.05), vec3(1.06,1.0,0.9), smoothstep(0.15, 0.85, l));
          tinte = mix(tinte, vec3(0.95,1.0,1.08), uFrio);
          c *= tinte;
          c = mix(vec3(l), c, uSat);
          c = pow(c, vec3(0.97));
          // viñeta
          vec2 q = vUv - 0.5; c *= 1.0 - dot(q, q)*0.55;
          // sRGB
          c = mix(c*12.92, 1.055*pow(c, vec3(1.0/2.4)) - 0.055, step(0.0031308, c));
          // grano
          c += (h21(vUv*uRes + fract(uTime)*100.0) - 0.5) * uGrano;
          gl_FragColor = vec4(c, mix(1.0, texture2D(tEsc, vUv).a, uTransp)); }`,
      depthTest: false, depthWrite: false,
    })
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.comp)
    this.quad.frustumCulled = false
    this.escena.add(this.quad)
  }

  setSize(w: number, h: number) {
    this.rt.setSize(w, h)
    this.a.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1))
    this.b.setSize(Math.max(1, w >> 1), Math.max(1, h >> 1))
    ;(this.comp.uniforms.uRes.value as THREE.Vector2).set(w, h)
  }

  render(escena: THREE.Scene, camara: THREE.Camera) {
    const r = this.renderer
    r.setRenderTarget(this.rt)
    r.render(escena, camara)
    if (!this.tiltShift) {
      this.u.uTilt.value = 0; this.u.uBloom.value = 0
      this.quad.material = this.comp
      r.setRenderTarget(null)
      r.render(this.escena, this.cam)
      return
    }
    const w = this.a.width, h = this.a.height
    // blur a media resolución: horizontal → a, vertical → b
    this.quad.material = this.blur
    this.blur.uniforms.tSrc.value = this.rt.texture
    ;(this.blur.uniforms.uDir.value as THREE.Vector2).set(1 / w, 0)
    r.setRenderTarget(this.a); r.render(this.escena, this.cam)
    this.blur.uniforms.tSrc.value = this.a.texture
    ;(this.blur.uniforms.uDir.value as THREE.Vector2).set(0, 1 / h)
    r.setRenderTarget(this.b); r.render(this.escena, this.cam)
    this.quad.material = this.comp
    r.setRenderTarget(null)
    r.render(this.escena, this.cam)
  }

  dispose() {
    this.rt.dispose(); this.a.dispose(); this.b.dispose()
    this.blur.dispose(); this.comp.dispose(); this.quad.geometry.dispose()
  }
}
