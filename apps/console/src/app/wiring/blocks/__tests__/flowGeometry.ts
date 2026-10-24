import type { Box, LaidOut } from '../model/elkGraph';

type Point = [number, number];
type Segment = [Point, Point];

const segmentsOf = (points: Point[]): Segment[] =>
  points.slice(1).map((point, i) => [points[i]!, point]);

/** True when an axis-aligned segment passes through the box's inside. */
function crosses([a, b]: Segment, box: Box): boolean {
  const left = Math.min(a[0], b[0]);
  const right = Math.max(a[0], b[0]);
  const top = Math.min(a[1], b[1]);
  const bottom = Math.max(a[1], b[1]);
  return (
    left < box.x + box.width &&
    right > box.x &&
    top < box.y + box.height &&
    bottom > box.y
  );
}

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.width &&
  a.x + a.width > b.x &&
  a.y < b.y + b.height &&
  a.y + a.height > b.y;

/** Each label that sits on another edge's line, on a card or on another
    label, named `edge > what it hits`. */
export function labelClashes(laidOut: LaidOut): string[] {
  const clashes: string[] = [];
  const labelled = Object.entries(laidOut.edges).filter(
    (entry): entry is [string, { points: Point[]; label: Box }] =>
      entry[1].label !== null
  );
  for (const [id, { label }] of labelled) {
    for (const [other, { points }] of Object.entries(laidOut.edges)) {
      if (other === id) continue;
      if (segmentsOf(points).some(segment => crosses(segment, label))) {
        clashes.push(`${id} > line ${other}`);
      }
    }
    for (const [node, box] of Object.entries(laidOut.nodes)) {
      if (overlaps(label, box)) clashes.push(`${id} > card ${node}`);
    }
    for (const [other, { label: box }] of labelled) {
      if (other !== id && overlaps(label, box)) {
        clashes.push(`${id} > label ${other}`);
      }
    }
  }
  return clashes;
}

const distance = (box: Box, [x, y]: Point) =>
  Math.hypot(
    Math.max(box.x - x, 0, x - (box.x + box.width)),
    Math.max(box.y - y, 0, y - (box.y + box.height))
  );

/** Each label further than `limit` px from both its edge's start and its
    first bend, with that distance. */
export function strayLabels(laidOut: LaidOut, limit: number): string[] {
  return Object.entries(laidOut.edges).flatMap(([id, { points, label }]) => {
    if (!label || points.length < 2) return [];
    const near = Math.min(
      distance(label, points[0]!),
      points.length > 2 ? distance(label, points[1]!) : Infinity
    );
    return near > limit ? [`${id}: ${Math.round(near)}px`] : [];
  });
}
