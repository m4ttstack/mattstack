/** How long a running doctor may go without a status write before the board
    and the triage cron stop trusting it. The pane writes `watching` once and
    then nothing until CI's verdict, so this outlasts a long CI run's silent
    stretch. */
export const DOCTOR_QUIET_MS = 45 * 60_000;

/** The statuses only the doctor pane writes while it works. */
const PANE_WORKING = new Set(['diagnosing', 'rebasing', 'fixing', 'watching']);

export interface QuietFields {
  status: string;
  updatedAt?: number;
  gateId?: string;
  gateOpenedAt?: number;
}

/** A doctor waiting on its escalation gate writes nothing while a human
    decides. Opening the gate stamps `gateOpenedAt` with the same clock as
    that write's `updatedAt`, so any later write (a status, a resume) ends
    the hold. A gate a board older than the stamp opened has no
    `gateOpenedAt`, so it holds as it always did. */
export function doctorHeldAtGate(d: QuietFields): boolean {
  if (!d.gateId) return false;
  return d.gateOpenedAt === undefined || d.gateOpenedAt === d.updatedAt;
}

/** A running doctor that has written nothing for DOCTOR_QUIET_MS. */
export function doctorGoneQuiet(d: QuietFields, now: number): boolean {
  if (!PANE_WORKING.has(d.status) || d.updatedAt === undefined) return false;
  if (doctorHeldAtGate(d)) return false;
  return now - d.updatedAt > DOCTOR_QUIET_MS;
}
