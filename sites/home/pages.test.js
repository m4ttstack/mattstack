const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { join } = require("node:path");

// mattstack.app and Flock both ship universal builds.
for (const page of ["index.html", "join/index.html"]) {
  test(`${page}: every Apple silicon mention names Intel too`, () => {
    const mentions = readFileSync(join(__dirname, page), "utf8").match(/Apple silicon[^<.]*/g);
    assert.ok(mentions);
    for (const mention of mentions) assert.match(mention, /Intel/);
  });
}
