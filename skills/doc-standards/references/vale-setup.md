# Vale setup — the strong machine gate

Vale (https://vale.sh) is the standard prose linter for docs-as-code: it runs the
Google and Microsoft style guides as executable rule packages over Markdown/MDX/rST/
AsciiDoc, locally and in CI. The bundled `check_docs.py` is the zero-dependency
fallback; Vale is the stronger gate — set it up once per serious docs project.

## Install (single Go binary, no runtime deps)

```bash
# to ~/.local/bin without root:
VALE_VERSION=$(curl -sL https://api.github.com/repos/errata-ai/vale/releases/latest | grep -oP '"tag_name": "v\K[^"]+')
curl -sL "https://github.com/errata-ai/vale/releases/download/v${VALE_VERSION}/vale_${VALE_VERSION}_Linux_64-bit.tar.gz" \
  | tar xz -C ~/.local/bin vale
vale --version
```

## Per-project bootstrap

Create `.vale.ini` at the repo root:

```ini
StylesPath = .vale/styles
MinAlertLevel = suggestion

Packages = Google, proselint, write-good

[*.{md,mdx}]
BasedOnStyles = Vale, Google, proselint, write-good

# Code blocks and URLs are not prose:
BlockIgnores = (?s)```.*?```
TokenIgnores = (\x60[^\n\x60]+\x60), (https?://[^\s]+)
```

Then:

```bash
vale sync        # downloads the packages into .vale/styles
vale docs/       # lint
```

Swap `Google` for `Microsoft` if the project follows the Microsoft guide. `alex` (add to
Packages) covers inclusive language if you want it separate from the main guide.

## Project vocabulary (the terminology table, executable)

Vale turns the project terminology table into an enforced rule:

```
.vale/styles/config/vocabularies/Project/accept.txt   # approved terms, one per line
.vale/styles/config/vocabularies/Project/reject.txt   # banned synonyms
```

Add to `.vale.ini`: `Vocab = Project`. Now "token" (when the approved term is "API key")
fails the lint, project-wide, forever. This is the executable form of STE100's
"one word, one meaning".

A custom substitution rule enforces approved-term pairs:

```yaml
# .vale/styles/Project/Terms.yml
extends: substitution
message: "Use '%s' instead of '%s'."
level: error
ignorecase: true
swap:
  utilize: use
  leverage: use
  in order to: to
  prior to: before
```

## CI

```yaml
# .github/workflows/docs-lint.yml
- uses: errata-ai/vale-action@v2
  with:
    files: docs/
    fail_on_error: true
```

Pair with `lychee` (link checker) and `markdownlint-cli2` (Markdown structure) for the
full docs-as-code gate: prose (Vale) + links (lychee) + markup (markdownlint).

## Precedence

When Vale runs, `check_docs.py` skips its own style checks and keeps only the checks
Vale does not do (heading hierarchy, self-containment markers, relative-link integrity,
llms.txt presence). No double-reporting.
