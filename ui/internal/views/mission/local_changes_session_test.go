package mission_test

import (
	"encoding/json"
	"testing"
)

// TestLocalChangesStashEmitsStashAndRetry drives the real binary, where the
// emitted intent line is readable: Stash Changes and Continue is the first
// choice, as Desktop's OK button. The fixture's branch stash is cleared,
// since Desktop offers only Close over one.
func TestLocalChangesStashEmitsStashAndRetry(t *testing.T) {
	var model map[string]any
	if err := json.Unmarshal([]byte(fixtureModelJSON(t, "session-model-mission.json")), &model); err != nil {
		t.Fatal(err)
	}
	model["stash"] = nil
	model["localChangesPrompt"] = map[string]any{"seq": 1, "action": "pull", "files": []string{"a.txt"}}
	b, err := json.Marshal(model)
	if err != nil {
		t.Fatal(err)
	}
	s := openMission(t, string(b), "Stash Changes and Continue")
	s.Type("\r")
	waitIntent(t, s, "mission:stash-and-retry")
	s.Send(`{"t":"close"}`)
	s.Wait()
}
