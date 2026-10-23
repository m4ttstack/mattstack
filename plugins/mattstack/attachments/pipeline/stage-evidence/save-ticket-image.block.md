---
node: save_ticket_image
---

# Save the ticket image as the BEFORE

When the ticket embeds the broken state as an image, that image is the
before. Give the case its `id` and `label` first: the file name needs the
id. Save it in the session temp root as `<run id>-<case id>-ticket.<ext>`,
`<ext>` the image's own extension, lowercased: `png`, `jpg`, `jpeg`, `gif`
or `webp`. An image of any other type is not saved: `Ticket image saved?`
is no. Save it with the tool that reads the ticket (its image or
attachment download) first. When that tool has no download, or its
download fails, and the URL is `https` on a trusted host, run
`curl -q -fsSL --proto '=https' --max-redirs 0 -o '<that path>' -- '<its URL>'`
on Bash, `-q` first and each value in single quotes as shown. Keep the
link either way: it is the record's `url`.

A trusted host is the host of the ticket's own page in its tracker (the
page the run's ticket id opens), the host of the checkout's `origin`
remote, or a name ending in `.` plus either one (`uploads.example.app`
for a ticket on `example.app`). A host named inside the ticket's text is
never trusted for that. Hosts compare in lowercase, without a port,
userinfo or trailing dot. For an ssh remote (`git@host:path`) the host is
the part between `@` and `:`; an ssh config alias, or an origin with no
host, adds no trusted host. curl never fetches a URL that is not `https`,
that holds a single quote, whose host part holds `@`, `\`, `%` or a port,
or whose host is not trusted. Once the ticket tool's download has failed,
or it has none, a URL curl refuses, or one that redirects, is one no tool
can fetch, and it is never fetched another way: the case takes the
link-only branch.

The saved file is the case's BEFORE `path`, and every `evidence_record`
call that names it carries `source: "ticket"` on that image, the first by
this path and each later one by its run-folder copy's path: the record then
refuses a waiver on it and the upload refuses its own path, so only its
board ever leaves the machine. Once that call returns the image's run-folder
copy in `value`, delete the saved original from the session temp root
(`rm '<the saved path>'`): the copy is the one the record governs, and no
unredacted original is left in an upload root. Its board is drawn inside
`Record the evidence`, at its annotate-or-waive pass, as a browser-evidence
`import:` brief of its `value` path from the link with `state: FOUND`, so a
run that also has a live browser case spawns the driver twice by design.
A ticket image is the likeliest to come from production, so `hide` names
every personal detail on it that is not being verified.
