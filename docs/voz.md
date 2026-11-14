# Notas de voz en WhatsApp (para quien no lee bien)

El bot entiende notas de voz y puede contestar con notas de voz.

- **Entender**: nota de voz de WhatsApp (OGG/Opus) → `tools/stt` (faster-whisper en la GPU, 127.0.0.1:8211) → texto → `voz.Normalizar` lo lleva a lo que el bot entiende (`"Siembro maíz y frijol"` → `milpa`, `"Tengo dos manzanas"` → `2 manzanas`, `"No riego, solo lluvia"` → `nada`, `"Soy de Jocotan"` → `Jocotán`, `"Quiero audios"` → `AUDIOS`).
- **Responder**: `voz.Hablar(ctx, texto, idioma)` → edge-tts (`es-GT-MartaNeural` / `en-US-JennyNeural`) → ffmpeg → OGG/Opus mono 48 kHz, el formato de nota de voz de WhatsApp. Sin emojis, sin `*negritas*`, sin enlaces (esos quedan en el texto). Caché en disco por voz + texto.
- **Sin GPU o sin el servicio**: el bot sigue en texto y lo dice (`voz.TextoSinVoz`).

## Arrancar el servicio de voz a texto

```powershell
powershell -File tools\stt\arrancar.ps1                 # oculto, modelo small, log en %TEMP%\fieldshift-stt.log
powershell -File tools\stt\arrancar.ps1 -Modelo medium  # más preciso, más lento
Invoke-RestMethod http://127.0.0.1:8211/salud           # {ok, modelo, dispositivo: cuda|cpu}
```

Requisitos (ya instalados en la PC del equipo): Python 3.13, `faster-whisper`, `nvidia-cublas-cu12`, `nvidia-cudnn-cu12` (el servicio registra sus DLL con `os.add_dll_directory`), `ffmpeg` en el PATH. Sin CUDA cae a CPU (`int8`) y lo informa en `/salud`.

API: `POST /transcribir[?idioma=es|en]` con el audio crudo en el cuerpo → `{texto, idioma, prob_idioma, duracion, segundos, modelo, dispositivo}`. Sin `idioma`, elige entre español e inglés (el bot no habla otros).

Variables del lado Go (todas opcionales): `VOZ_STT_URL` (http://127.0.0.1:8211), `VOZ_CACHE` (carpeta de caché de audios), `VOZ_EDGE_TTS`, `VOZ_FFMPEG`, `VOZ_VOZ_ES`, `VOZ_VOZ_EN`.

## API Go (`internal/voz`)

| Función | Qué hace |
|---|---|
| `voz.EntradaDeAudio(ctx, audio, idiomaSesion) (texto, idioma, aviso)` | Lo único que necesita el canal: si `aviso != ""`, mandarlo en texto y no llamar al bot; si no, pasar `texto` al bot como si lo hubieran escrito. |
| `voz.Transcribir(ctx, audio) (texto, idioma, err)` | Transcribe y normaliza. `errors.Is(err, voz.ErrSinServicio)` = servicio caído. |
| `voz.Hablar(ctx, texto, idioma) (ogg, err)` | Nota de voz OGG/Opus. `voz.ErrSinTTS` = falta edge-tts/ffmpeg o sin internet. |
| `voz.Duracion(ogg) float64` | Segundos de la nota (whatsmeow lo pide en `AudioMessage.Seconds`). |
| `voz.MimeNota` | `"audio/ogg; codecs=opus"`. |
| `voz.Vocabulario(nombres)` | Nombres de municipios para corregir lo que Whisper oye mal. Una vez al arrancar. |
| `voz.Disponible(ctx)`, `voz.HablarDisponible()` | Salud del STT (caché 30 s) y de edge-tts + ffmpeg. |
| `voz.PedidoAudios(texto) (activar, ok)` | "quiero audios" / "solo texto". |
| `voz.TextoSinVoz`, `voz.TextoNoEntendi`, `voz.TextoAudios(idioma, activar)`, `voz.TextoOfrecerAudios` | Mensajes ES/EN. |

## Cableado en el bot (lo hace el integrador)

1. **`internal/bot/bot.go`**: `Entrada` += `Audio []byte`; `Sesion` += `Audios bool`. En `paso`, comandos `AUDIOS` → `se.Audios = true`, respuesta `voz.TextoAudios(L, true)`; `TEXTO` → `false`, `voz.TextoAudios(L, false)`. El texto `"voz"` de `textos.go` pasa a `voz.TextoSinVoz(L)`. Exponer `IdiomaDe(tel)` y `AudiosDe(tel) bool`.
2. **`internal/channels/whatsmeow/whatsmeow.go`** `recibir`: si `ev.Message.GetAudioMessage() != nil`, `e.Audio, _ = cli.Download(ctx, ev.Message.GetAudioMessage())`.
   Transporte += `EnviarNota(tel string, ogg []byte) error`:
   ```go
   up, err := c.subir(ogg, wm.MediaAudio)
   // …
   return c.mandar(tel, &waE2E.Message{AudioMessage: &waE2E.AudioMessage{
       PTT: proto.Bool(true), Mimetype: proto.String(voz.MimeNota), Seconds: proto.Uint32(uint32(voz.Duracion(ogg) + 0.5)),
       URL: &up.URL, DirectPath: &up.DirectPath, MediaKey: up.MediaKey, FileEncSHA256: up.FileEncSHA256, FileSHA256: up.FileSHA256, FileLength: &up.FileLength,
   }})
   ```
3. **`internal/channels/vinculado.go`** `Recibir`, antes de `v.Bot.Responder(e)`:
   ```go
   if e.Tipo == "audio" && len(e.Audio) > 0 {
       texto, _, aviso := voz.EntradaDeAudio(ctx, e.Audio, v.Bot.IdiomaDe(e.Tel))
       if aviso != "" { _ = v.T.EnviarTexto(e.Tel, aviso); return }
       e.Tipo, e.Texto = "text", texto
   }
   ```
   Después de entregar cada salida de texto/botones/lista, si `v.Bot.AudiosDe(e.Tel)`: `if ogg, err := voz.Hablar(ctx, s.Texto, idioma); err == nil { v.T.EnviarNota(e.Tel, ogg) }`. El texto se manda igual (enlaces y botones). Si falla `Hablar`, solo texto.
   Primera nota de voz entendida y audios apagados → mandar una vez `voz.TextoOfrecerAudios(idioma)`.
4. **`cmd/server`**: `voz.Vocabulario(nombres de data/municipios.json)` al arrancar. En la PC del equipo, arrancar `tools/stt/arrancar.ps1` junto al servidor. En la nube (sin GPU) no hace falta nada: el bot contesta en texto y lo dice.

Twilio y Cloud API: el audio llega como URL/ID de media; bajarlo y usar el mismo paso 3.

## Verificación (14-nov-2026)

`VOZ_E2E=1 VOZ_MUESTRAS=<carpeta> go test -p 1 -run PuntaAPunta -v ./internal/voz`: 6 notas sintetizadas con edge-tts (voces Marta y Andrés de Guatemala, Jenny en inglés), pasadas a OGG/Opus, validadas con ffprobe y transcritas en la RTX 5070 con el modelo small: **6/6 correctas**, idioma bien detectado. Transcripción: 0,5–1,2 s por nota de ~2 s (la mayor parte es CPU: mel y VAD, que corren a prioridad baja). Las mismas notas con ruido rosa y banda telefónica (300–3400 Hz, Opus 16 kbps) también salieron exactas.

Límite honesto: probado con voz sintetizada y ruido artificial, no con notas reales de agricultores (acentos, ruido de campo). Para eso, `-Modelo medium` o `large-v3-turbo` (ya en caché) mejoran la precisión.
