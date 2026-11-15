//go:build windows

package chat

import (
	"os/exec"
	"syscall"
)

// ocultar: claude sin ventana de consola y en prioridad baja (la PC del dueño primero).
func ocultar(cmd *exec.Cmd) {
	const createNoWindow, belowNormal = 0x08000000, 0x00004000
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: createNoWindow | belowNormal}
}
