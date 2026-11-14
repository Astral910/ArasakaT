//go:build !windows

package voz

import "os/exec"

func ocultar(*exec.Cmd) {}
