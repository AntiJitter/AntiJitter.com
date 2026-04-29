//go:build !windows

package winexec

import "os/exec"

func CombinedOutput(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).CombinedOutput()
}

func Output(name string, args ...string) ([]byte, error) {
	return exec.Command(name, args...).Output()
}
