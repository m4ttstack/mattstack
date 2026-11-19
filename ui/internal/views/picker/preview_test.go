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

func TestKittyFacesAsksTheTerminalInAHerdrThatDrawsImages(t *testing.T) {
	env := map[string]string{"HERDR_PANE_ID": "w1:p1", "HERDR_SESSION_CONTROL_IMAGES": "1"}
	get := func(k string) string { return env[k] }
	if !kittyFaces(get, func() bool { return true }) {
		t.Fatal("kitty faces refused in a herdr that draws images")
	}
	if kittyFaces(get, func() bool { return false }) {
		t.Fatal("kitty faces chosen when the terminal said no")
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
