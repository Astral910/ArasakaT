//go:build !windows

package chat

import (
	"os/exec"
	"syscall"
)

// ocultar: en Linux/mac, en su propio grupo de procesos (no hay consola que ocultar).
func ocultar(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
}
