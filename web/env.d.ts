/// <reference types="vite/client" />
declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const c: DefineComponent<object, object, any>
  export default c
}
declare module '*?worker&url' {
  const url: string
  export default url
}
