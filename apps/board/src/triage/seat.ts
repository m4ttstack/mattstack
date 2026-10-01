import { isOwnMr, seatOf } from '../view.ts';

/** The board's one ownership rule as triage applies it: the seat
    (`defaultMember`) and the GitLab token's user both authored the MR. A
    seatless ("all") board owns nothing, so auto-doctor and respond asks
    never act there. */
export function triageOwns(
  mr: { author: { username: string } },
  defaultMember: string,
  identity: string
): boolean {
  return isOwnMr(mr, seatOf(defaultMember)) && isOwnMr(mr, identity);
}
