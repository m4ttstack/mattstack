import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../../server/blocksPayload';

const FIXED_LINES = [
  '',
  "Change a prop's value: mattstack:extending-a-pack",
  "Change mattstack's text: mattstack:editing-skills",
  'Write it with: superpowers:writing-skills',
  '',
  'What I want:',
];

const UNDER = /\/(?:attachments|skills)\/(.+)$/;

/** The spec's brief names a file by the part under its plugin or pack's
    attachments (or skills) folder, after `…/`. */
function shortPath(path: string): string {
  const under = UNDER.exec(path)?.[1];
  return under ? `…/${under}` : path;
}

export function buildBlockContext(input: {
  payload: BlocksPayload;
  block: PayloadBlock;
}): string {
  const { payload, block } = input;
  const layers = payload.layers.filter(layer => layer.color !== 'mattstack');
  const org = payload.layers.find(layer => layer.color === 'org');

  const propLines = block.props.flatMap(prop => [
    `Props: ${prop.name} (${prop.merge}, ${prop.default === null ? 'required' : 'optional'})`,
    ...layers.map(layer => {
      const value = prop.values.find(v => v.layer === layer.label);
      return `  ${layer.name}: ${value ? shortPath(value.path) : 'nothing passed'}`;
    }),
  ]);

  return [
    `Block: ${block.id}`,
    `  "${block.title ?? block.label}"`,
    `File: ${shortPath(block.path)}`,
    ...propLines,
    org
      ? `Pack: ${payload.pack}, extends ${org.name}`
      : `Pack: ${payload.pack}`,
    ...FIXED_LINES,
  ].join('\n');
}
