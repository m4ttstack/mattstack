import { describe, expect, test } from "bun:test";
import { addTickets, parseTickets, serializeTickets, ticketShots } from "../tickets-field.ts";

const A = { path: "/w/r/evidence/t/a.png", size: 3, sha256: "a".repeat(64) };
const B = { path: "/w/r/evidence/u/b.png", size: 4, sha256: "b".repeat(64) };

describe("evidence-tickets field", () => {
  test("round-trips, and reads anything malformed as no tickets", () => {
    expect(parseTickets(serializeTickets([A, B]))).toEqual([A, B]);
    for (const bad of [null, "", "nope", "{}", '{"v":2,"tickets":[]}', '{"v":1,"tickets":{}}']) expect(parseTickets(bad)).toEqual([]);
  });

  test("drops an entry without a path, a whole size or a 64-hex sha256", () => {
    const value = JSON.stringify({ v: 1, tickets: [A, { ...B, sha256: "B".repeat(64) }, { ...B, size: -1 }, { size: 1, sha256: B.sha256 }, "x"] });
    expect(parseTickets(value)).toEqual([A]);
  });

  test("addTickets keeps every known entry once, by path and bytes, and says whether anything was new", () => {
    expect(addTickets([A], [A])).toEqual({ tickets: [A], changed: false });
    expect(addTickets([A], [B, A])).toEqual({ tickets: [A, B], changed: true });
    const moved = { ...A, path: "/w/r/evidence/t/abc123def456/a.png" };
    expect(addTickets([A], [moved]).tickets).toEqual([A, moved]);
  });

  test("ticketShots reads each entry as a ticket shot", () => {
    expect(ticketShots([A])).toEqual([{ path: A.path, source: "ticket", size: 3, sha256: A.sha256 }]);
  });
});
