# Review: WEB-420 export the usage table as CSV

Read this against the table component's existing export conventions and
the download helper's tests. A contained change with a useful result...
one finding worth fixing, two small suggestions.

## Findings

- The export button stays enabled while the request is in flight, so a
  fast double click starts two downloads. Disabling it until the response
  settles closes that.
- The empty state repeats the page title; one line saying there is
  nothing to export reads better.
- `usage-table.test.tsx` asserts on a CSS class; a role query survives a
  restyle.

## Suggested guard

```ts
const [exporting, setExporting] = useState(false);
```

Nothing here blocks the change once the double submit is closed.
