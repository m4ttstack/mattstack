package protocol

import (
	"encoding/json"
	"fmt"
)

type Segment struct {
	Text string `json:"text"`
	Role string `json:"role,omitempty"`
	URL  string `json:"url,omitempty"`
}

type Cell []Segment

// TableRow is a row of cells or a group label; exactly one is set.
type TableRow struct {
	Cells []Cell `json:"cells,omitempty"`
	Group string `json:"group,omitempty"`
}

type ChangeRow struct {
	Op   string `json:"op"`
	Name string `json:"name"`
	Hint string `json:"hint,omitempty"`
}

type DiffLine struct {
	Kind string `json:"kind"`
	Text string `json:"text"`
}

type DiffHunk struct {
	Header string     `json:"header"`
	Lines  []DiffLine `json:"lines"`
}

// Block is the union of every render block; unused fields stay zero and are
// omitted on re-encode so the fixture round-trips.
type Block struct {
	T string `json:"t"`

	Status   string      `json:"status,omitempty"`
	Title    string      `json:"title,omitempty"`
	Subtitle string      `json:"subtitle,omitempty"`
	Hint     string      `json:"hint,omitempty"`
	Label    string      `json:"label,omitempty"`
	Body     []Cell      `json:"body,omitempty"`
	Key      string      `json:"key,omitempty"`
	Value    string      `json:"value,omitempty"`
	Source   string      `json:"source,omitempty"`
	Headers  []string    `json:"headers,omitempty"`
	Rows     []TableRow  `json:"rows,omitempty"`
	Root     Cell        `json:"root,omitempty"`
	Children [][]Cell    `json:"children,omitempty"`
	Blocks   []Block     `json:"blocks,omitempty"`
	Counts   []string    `json:"counts,omitempty"`
	Text     string      `json:"text,omitempty"`
	Caption  string      `json:"caption,omitempty"`
	Lines    []string    `json:"lines,omitempty"`
	Changes  []ChangeRow `json:"changes,omitempty"`
	Hunks    []DiffHunk  `json:"hunks,omitempty"`
	Subject  string      `json:"subject,omitempty"`
	Why      string      `json:"why,omitempty"`
	Next     Cell        `json:"next,omitempty"`
	Details  string      `json:"details,omitempty"`
}

var blockTypes = map[string]bool{
	"line": true, "callout": true, "kv": true, "table": true, "tree": true,
	"section": true, "summary": true, "paragraph": true, "copy": true,
	"verbatim": true, "changes": true, "diff": true, "banner": true, "failure": true,
}

func DecodeBlock(line []byte) (Block, error) {
	var b Block
	if err := json.Unmarshal(line, &b); err != nil {
		return b, fmt.Errorf("%w: %v", ErrBadSpec, err)
	}
	if err := checkBlock(b); err != nil {
		return b, err
	}
	return b, nil
}

func checkBlock(b Block) error {
	if !blockTypes[b.T] {
		return fmt.Errorf("%w: block t=%q", ErrBadSpec, b.T)
	}
	for _, child := range b.Blocks {
		if err := checkBlock(child); err != nil {
			return err
		}
	}
	return nil
}
