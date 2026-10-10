// GitHub Desktop's LocalChangesOverwrittenDialog
// (app/src/ui/local-changes-overwritten/local-changes-overwritten-dialog.tsx,
// opened by localChangesOverwrittenHandler in
// app/src/ui/dispatcher/error-handlers.ts), opened when uncommitted changes
// block a pull. Stash Changes and Continue stashes them for the branch and
// reruns the pull; with a stash already on the branch, Close is the only
// choice, as in Desktop.
package mission

import (
	tea "charm.land/bubbletea/v2"

	"rt-ui/internal/protocol"
	"rt-ui/internal/views/picker"
)

const (
	localChangesTitle   = "Error"
	localChangesStashID = "local-changes-stash"
)

// localChangesItems wraps Desktop's paragraphs onto rows, as
// pushNeedsPullItems does, and sets the file list apart from the stash
// paragraph with a blank row, as Desktop's list box does.
func localChangesItems(p LocalChangesPrompt, canStash bool) []picker.MenuItem {
	items := []picker.MenuItem{questionBody("Unable to " + p.Action + " when changes are present on your")}
	if len(p.Files) > 0 {
		items = append(items, questionBody("branch. The following files would be overwritten:"))
		for _, f := range p.Files {
			items = append(items, questionBody("  "+f))
		}
		if canStash {
			items = append(items, questionBody(""))
		}
	} else {
		items = append(items, questionBody("branch."))
	}
	if !canStash {
		return append(items, questionChoice("cancel", "Close"))
	}
	return append(items,
		questionBody("You can stash your changes now and recover them"),
		questionBody("afterwards."),
		questionChoice(localChangesStashID, "Stash Changes and Continue"),
		questionChoice("cancel", "Close"),
	)
}

func (m *Mission) openLocalChanges(p LocalChangesPrompt) {
	m.openQuestion(localChangesTitle, localChangesItems(p, m.model.Stash == nil), menuTarget{})
}

func (m *Mission) emitStashAndRetry() tea.Cmd {
	return m.em.Emit(protocol.Intent{Name: "mission:stash-and-retry"})
}
