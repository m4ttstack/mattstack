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
      return `  ${layer.name}: ${value ? value.path : 'nothing passed'}`;
    }),
  ]);

  return [
    `Block: ${block.id}`,
    `  "${block.title ?? block.label}"`,
    `File: ${block.path}`,
    ...propLines,
    org
      ? `Pack: ${payload.pack}, extends ${org.name}`
      : `Pack: ${payload.pack}`,
    ...FIXED_LINES,
  ].join('\n');
}
