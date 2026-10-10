import { fits, type Floor } from "../engine-floor.ts";

declare const admitted: unique symbol;
export type Admitted = { ok: true; readonly [admitted]: true };
export type Admission = Admitted | { ok: false; floor: string; engine: string | null };

/** The only way to obtain an Admitted: every install or update argv below requires one, so no call site can skip the floor check. */
export function admit(floor: Floor, engine: string | null): Admission {
  if (fits(floor, engine)) return { ok: true } as Admitted;
  return { ok: false, floor: floor!, engine };
}

/** For plugins that declare no engine floor (chat, herdr-chat, fast-browser, the official base plugins). */
export const ADMIT_UNFLOORED: Admitted = { ok: true } as Admitted;

export function installArgs(_a: Admitted, id: string, extra: string[] = []): string[] {
  return ["plugin", "install", id, ...extra];
}

export function updateArgs(_a: Admitted, id: string, extra: string[] = []): string[] {
  return ["plugin", "update", id, ...extra];
}
