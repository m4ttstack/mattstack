/**
 * The zod schema of each registered migration step's source version, with
 * values saved from real stores (invented data only, per repo purity).
 * Authoring only, like registry-schemas.ts: buildLock writes each schema
 * into the lock's migrateFrom as JSON Schema, which is what CI and release
 * preflight compare with the previous lock, and the proof test samples it.
 * One entry per MIGRATION_STEPS entry. `rt settings schema diff --draft`
 * inserts entries directly above the @draft marker; keep it.
 */

import { z } from "zod";

export interface MigrationSchema {
  key: string;
  version: number;
  schema: z.ZodType;
  examples: unknown[];
}

export const MIGRATION_SCHEMAS: MigrationSchema[] = [
  {
    key: "board.tabs",
    version: 1,
    schema: z.array(z.looseObject({ id: z.string(), label: z.string(), source: z.union([z.looseObject({ kind: z.literal("authors") }), z.looseObject({ kind: z.literal("codeowners"), section: z.string(), excludeMembers: z.boolean().optional() })]), slackChannel: z.string().optional(), reviewSkill: z.string().optional() })),
    examples: [
      [
        { id: "team", label: "Team", source: { kind: "authors" } },
        { id: "web", label: "Web", source: { kind: "codeowners", section: "Web", excludeMembers: true }, slackChannel: "web-reviews" },
      ],
      [
        { id: "team", label: "Team", source: { kind: "authors" } },
        { id: "team", label: "Team again", source: { kind: "authors" } },
        { id: "", label: "No id", source: { kind: "authors" } },
        { id: "api", label: "API", source: { kind: "codeowners", section: "" } },
        { id: "docs", label: "Docs", source: { kind: "authors" }, pack: 5 },
      ],
      [],
    ],
  },
  // @draft-schemas
];
