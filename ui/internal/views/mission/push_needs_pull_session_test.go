package mission_test

import (
	"strings"
	"testing"
)

// TestPushNeedsPullFetchEmitsFetch drives the real binary, where the emitted
// intent line is readable: Fetch is the first choice, as Desktop's OK button.
func TestPushNeedsPullFetchEmitsFetch(t *testing.T) {
	model := strings.Replace(fixtureModelJSON(t, "session-model-mission.json"), `"pushNeedsPullPrompt":null`, `"pushNeedsPullPrompt":{"seq":1}`, 1)
	s := openMission(t, model, "Newer Commits on Remote")
	s.Type("\r")
	waitIntent(t, s, "mission:fetch")
	s.Send(`{"t":"close"}`)
	s.Wait()
}
