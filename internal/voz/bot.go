package voz

import (
	"bytes"
	"context"
	"encoding/binary"
	"errors"
)

// MimeNota: tipo que WhatsApp espera para una nota de voz (PTT).
const MimeNota = "audio/ogg; codecs=opus"

// EntradaDeAudio es lo único que necesita el canal cuando llega una nota de voz:
// si se entendió, devuelve el texto para pasarle al bot como si lo hubieran escrito
// (y el idioma oído); si no, aviso trae el mensaje para contestar en texto.
//
//	texto, idioma, aviso := voz.EntradaDeAudio(ctx, audio, se.Idioma)
//	if aviso != "" { enviar texto aviso; return }
//	e.Tipo, e.Texto = "text", texto
func EntradaDeAudio(ctx context.Context, audio []byte, idiomaSesion string) (texto, idioma, aviso string) {
	return Predeterminado.EntradaDeAudio(ctx, audio, idiomaSesion)
}

// EntradaDeAudio: ver la función del paquete.
func (c *Cliente) EntradaDeAudio(ctx context.Context, audio []byte, idiomaSesion string) (texto, idioma, aviso string) {
	if idiomaSesion != "en" {
		idiomaSesion = "es"
	}
	texto, idioma, err := c.Transcribir(ctx, audio)
	switch {
	case errors.Is(err, ErrSinServicio):
		return "", idiomaSesion, TextoSinVoz(idiomaSesion)
	case err != nil || texto == "":
		return "", idiomaSesion, TextoNoEntendi(idiomaSesion)
	}
	return texto, idioma, ""
}

// Duracion de un OGG/Opus en segundos (último granule − pre-skip, a 48 kHz).
// whatsmeow la pide en AudioMessage.Seconds. Devuelve 0 si no es OGG/Opus.
func Duracion(ogg []byte) float64 {
	h := bytes.Index(ogg, []byte("OpusHead"))
	u := bytes.LastIndex(ogg, []byte("OggS"))
	if h < 0 || u < 0 || h+12 > len(ogg) || u+14 > len(ogg) {
		return 0
	}
	preskip := int64(binary.LittleEndian.Uint16(ogg[h+10:]))
	gran := int64(binary.LittleEndian.Uint64(ogg[u+6:]))
	if gran <= preskip {
		return 0
	}
	return float64(gran-preskip) / 48000
}
