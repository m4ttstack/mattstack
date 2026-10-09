// Newer Commits on Remote: GitHub Desktop's PushNeedsPullWarning
// (app/src/ui/push-needs-pull), opened when the remote rejects a push as not
// a fast-forward. Its Fetch runs a fetch, which turns the action segment into
// Pull.
package mission

import (
	tea "charm.land/bubbletea/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/views/picker"
)

const (
	pushNeedsPullTitle   = "Newer Commits on Remote"
	pushNeedsPullFetchID = "push-needs-pull-fetch"
)

// pushNeedsPullItems wraps Desktop's paragraph onto rows, as
// overwriteStashItems does, so the box stays narrower than most panes.
func pushNeedsPullItems() []picker.MenuItem {
	return []picker.MenuItem{
		questionBody("glitter is unable to push commits to this branch"),
		questionBody("because there are commits on the remote that are not"),
		questionBody("present on your local branch. Fetch these new commits"),
		questionBody("before pushing in order to reconcile them with your"),
		questionBody("local commits."),
		questionChoice(pushNeedsPullFetchID, "Fetch"),
		cancelChoice(),
	}
}

func (m *Mission) openPushNeedsPull() {
	m.openQuestion(pushNeedsPullTitle, pushNeedsPullItems(), menuTarget{})
}

func (m *Mission) emitFetch() tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:fetch"})
}
