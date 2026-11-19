package picker

import "testing"

func TestKittyFacesSkipsTheQueryInsideHerdr(t *testing.T) {
	asked := false
	query := func() bool { asked = true; return true }
	env := map[string]string{"HERDR_PANE_ID": "w1:p1"}
	if kittyFaces(func(k string) string { return env[k] }, query) {
		t.Fatal("kitty faces chosen inside a herdr pane")
	}
	if asked {
		t.Fatal("asked the terminal inside a herdr pane")
	}
}

func TestKittyFacesAsksTheTerminalOutsideHerdr(t *testing.T) {
	none := func(string) string { return "" }
	if !kittyFaces(none, func() bool { return true }) {
		t.Fatal("kitty faces refused when the terminal said yes")
	}
	if kittyFaces(none, func() bool { return false }) {
		t.Fatal("kitty faces chosen when the terminal said no")
	}
}
