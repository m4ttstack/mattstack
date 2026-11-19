import { useMemo, useState } from 'react';

import type { WiringUrl } from '../graph/useWiringUrl';
import { BlockView } from './BlockView';
import { headingTree } from './model/headingTree';

const SKILL_FILE = 'SKILL.md';

/** A skill's text as it was at one moment (a run's pinned version), drawn
    by the Packs page's block view: its headings as read-only blocks, and the
    Rendered view of the same text. Its zoom and view live in local state,
    not the URL, so it can sit in a modal over any page. */
export function PinnedSkill({
  text,
  skill,
  pack,
}: {
  text: string;
  skill: string;
  pack: string;
}) {
  const payload = useMemo(
    () => headingTree(text, skill, SKILL_FILE),
    [text, skill]
  );
  const [url, setUrl] = useState<WiringUrl>({
    tab: 'graph',
    pack,
    focus: skill,
    select: null,
    view: null,
    attention: false,
    block: null,
  });
  return (
    <BlockView
      pack={pack}
      payload={payload}
      url={url}
      patch={change => setUrl(prev => ({ ...prev, ...change }))}
      readOnly
      renderedPath={SKILL_FILE}
      renderedText={text}
    />
  );
}
