---
order: 1
---

# The browser target

The four blocks come from the Browser target section (at any heading level) in this verb's
domain rules, or from the file those rules point at for it. A missing block
takes its default:

| Block | Feeds | Default when the block is missing |
|---|---|---|
| Reach the view | Get ready, the brief's `page:` | the URL the plan or intake gives; the developer signs in |
| What proves a change | `show`, `point at`, intake | the plan's words for the case |
| Captions | the claim and every label's wording | plain words |
| Personal data | `hide` | every personal detail on screen that is not being verified |

The pack's block wins over this page only on facts about its app, never on a
STOP below.

A board is a mock-data board only when all three hold:

- Personal data says the page's source holds only mock data (seeded test
  records, no real person), read from where the page is served from, never
  from how the names on screen look;
- its brief has `page:`, never `import:`: an imported image (a ticket
  screenshot) can come from anywhere;
- a pair's `before:` names a board that was itself a mock-data board (its
  `evidence-cleared:<before stem>` field reads `<sha> no redact marks:
  mock data from ...`, `<sha>` matching `shasum -a 256` of the before
  bundle's `<stem>.png`), never an import board or one a human approved.

Its brief's `hide:` line reads `no redact marks: mock data from <source>`,
`<source>` being the source as Personal data names it (a database class, a
site), written before the driver spawns, and its empty record is confirmed
without a question (Confirm a mock-data board).
