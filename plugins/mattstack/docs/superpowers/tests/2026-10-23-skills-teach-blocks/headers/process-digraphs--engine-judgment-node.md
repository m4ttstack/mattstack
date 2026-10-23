# Scenario (describe only: run no tools; answer from the skill text below)

You are adding a judgment step, "Check the changelog", to the graph of the mattstack engine `stage-ship`, between the commit and the fast checks. `stage-ship` is a block tree: `plugins/mattstack/attachments/pipeline/stage-ship/index.block.md` plus child `*.block.md` files; its graph has the edge from the commit node `commit_named_files` to the fast-checks node `domain_fast_checks`.

Answer in exactly four numbered lines, nothing else:
1. The file you add the node to, the graph language that file's graph is written in, and the exact node line you add.
2. Where the step's guidance prose goes: the file path, and its frontmatter and title line.
3. The edges you add or change, written in the same graph language.
4. The command that checks the graph's structure, and the file it runs on.
