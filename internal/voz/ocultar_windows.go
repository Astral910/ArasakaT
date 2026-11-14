//go:build windows

package voz

import (
	"os/exec"
	"syscall"
)

// ocultar: edge-tts y ffmpeg sin ventana de consola.
func ocultar(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
}
