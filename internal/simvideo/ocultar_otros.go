//go:build !windows

package simvideo

import "os/exec"

func ocultar(*exec.Cmd) {}
