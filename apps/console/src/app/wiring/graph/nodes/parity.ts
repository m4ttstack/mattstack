import type { Edge } from '@xyflow/react';

import { stepLabel } from '../model/focusModel';
import type {
  InputCard,
  LinkCard,
  OutputLink,
  TemplateRow,
  TemplateView,
} from '../model/templateModel';

/**
 * The `data-parity` names of the canvas pieces: the layer names the design
 * boards give them, so a parity run can pair each piece with its layer. A
 * step board names a file by its folder (`gate-protocol.md`), a pipeline
 * board by its path (`gate-protocol/SKILL.md`).
 */
const folderFile = (title: string) => `${title.split('/')[0]}.md`;

export const parityName = {
  template: (view: TemplateView) => `template · ${view.skill}`,
  row: (row: TemplateRow) => `${row.kind} · ${row.gutter}`,
  rowHandle: (row: TemplateRow) => `handle · ph ${row.gutter}`,
  input: (view: TemplateView, card: InputCard) =>
    view.output && card.icon === 'fileText'
      ? folderFile(card.title)
      : card.title,
  link: (card: LinkCard) => stepLabel(card.skill),
  outputLink: (link: OutputLink) =>
    link.path === null ? link.label : folderFile(link.label),
  edge: (view: TemplateView, edge: Edge) => {
    if (edge.sourceHandle === 'out') return 'render';
    const link = view.links.find(card => card.id === edge.target);
    if (link) return `link ${stepLabel(link.skill)}`;
    const row = view.rows.find(
      candidate => `row:${candidate.id}` === edge.targetHandle
    );
    return `in ${row?.kind === 'placeholder' ? row.code : edge.source}`;
  },
};
