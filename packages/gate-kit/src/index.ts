export type { GateAnswer } from '@mattstack/rt-client/gate';
// GateOrigin/GateRow are not yet on /gate (RT-180); migrate this line once
// they land.
// eslint-disable-next-line no-restricted-imports
export type { GateOrigin, GateRow } from '@mattstack/rt-client';
// GateOption.description / GateQuestion.context are not yet on rt-client
// (RT-180); these local shapes carry them until then.
export type { GateOption, GateQuestion } from './types';
export {
  displayForValue,
  formatGateOption,
  optionDescription,
  optionDisplayFor,
  optionLabel,
  optionValue,
  stripRecommended,
} from './options';
export type { GateOptionDisplay } from './options';
export { gateAnswerPayload, unwrapGateAnswer, writeIns } from './payload';
export type {
  GateAnswers,
  GateAnswerValue,
  GateSelections,
  UnwrappedGateAnswer,
} from './payload';
export {
  NEXT_QUESTION_ID,
  NO_PRESET_KINDS,
  presetSelections,
  PROCEED_VALUE,
  recommendedPick,
  withoutPreset,
} from './preset';
export {
  CODE_CHANGES_QUESTION_ID,
  CODE_CHANGES_SENTINEL,
  codeChangesHidden,
  effectiveSelections,
  RESPOND_PLAN_KIND,
} from './collapse';
export { resolveAnswerOutcome } from './conflict';
export type { AnswerOutcome } from './conflict';
export { domainForKind, GATE_KINDS } from './kinds';
export type { GateDomain } from './kinds';
export { answeredGateSummary, joinSummary } from './summary';
export type {
  GateSummary,
  GateSummaryDetailRow,
  GateSummaryInput,
} from './summary';
export { chunkGroupKey, collapseChunks, splitChunkSelections } from './chunks';
