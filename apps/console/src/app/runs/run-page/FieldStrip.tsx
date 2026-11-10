import { useState } from 'react';
import {
  Anchor,
  Button,
  CodeLines,
  Collapse,
  CopyActionIcon,
  Group,
  Paper,
  SegmentedControl,
  Text,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import type { RunFieldRow } from '@mattstack/rt-client';

import { formatClock } from '../derive/clock';
import { fieldLabel } from '../derive/fields';
import { fieldKind } from '../derive/run';
import classes from './FieldStrip.module.css';
import { prettyJson } from './FieldValue';

const STRIP_TEXT_MAX = 48;
/** CodeLines' row height, so a short value's viewer fits it exactly. */
const CODE_ROW = 19;
const CODE_MAX = 240;

const isJson = (f: RunFieldRow) => fieldKind(f.key, f.value) === 'json';

/** A field short enough for the strip: JSON, which opens below it, or one
    line of plain text. Anything longer keeps a row of its own. */
export const isStripField = (f: RunFieldRow) =>
  isJson(f) ||
  (fieldKind(f.key, f.value) === 'text' &&
    f.value.length <= STRIP_TEXT_MAX &&
    !f.value.includes('\n'));

interface Upload {
  name: string;
  url: string | null;
  sha: string | null;
  at: number | null;
}

type Shape =
  | { kind: 'uploads'; uploads: Upload[] }
  | { kind: 'values'; rows: [string, string][] }
  | { kind: 'raw' };

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** `priorPipelineId` as "Prior pipeline id". */
function words(key: string): string {
  const spaced = key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[-_]/g, ' ')
    .toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

/** The JSON shapes the panel can draw as rows: an evidence upload map, or a
    flat object of plain values. Anything else is raw. */
function shapeOf(value: string): Shape {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { kind: 'raw' };
  }
  if (!isRecord(parsed)) return { kind: 'raw' };
  if (isRecord(parsed.uploads)) {
    const uploads = Object.entries(parsed.uploads).map(([path, entry]) => {
      const e = isRecord(entry) ? entry : {};
      return {
        name: path.split('/').at(-1) ?? path,
        url: typeof e.url === 'string' ? e.url : null,
        sha: typeof e.sha256 === 'string' ? e.sha256.slice(0, 7) : null,
        at: typeof e.at === 'number' ? e.at : null,
      };
    });
    return { kind: 'uploads', uploads };
  }
  const entries = Object.entries(parsed);
  if (entries.every(([, v]) => v === null || typeof v !== 'object'))
    return {
      kind: 'values',
      rows: entries.map(([k, v]) => [
        words(k),
        v === null ? 'none' : String(v),
      ]),
    };
  return { kind: 'raw' };
}

/** What a closed JSON field says about itself, when its shape is known. */
function jsonPreview(value: string): string | null {
  const shape = shapeOf(value);
  if (shape.kind === 'uploads') {
    const count = shape.uploads.length;
    return `${count} ${count === 1 ? 'upload' : 'uploads'}`;
  }
  try {
    const parsed = JSON.parse(value) as { sha?: unknown };
    if (typeof parsed.sha === 'string') return parsed.sha.slice(0, 7);
  } catch {
    return null;
  }
  return null;
}

function UploadRows({ uploads }: { uploads: Upload[] }) {
  return uploads.map(u => (
    <div key={u.name} className={classes.row}>
      <Icon name="image" size={15} className={classes.muted} />
      <div className={classes.grow}>
        <Text fz="md" fw={500} lh="normal" truncate>
          {u.name}
        </Text>
        <Group gap={12} wrap="nowrap">
          {u.at !== null ? (
            <Text fz="xs" lh="normal" c="dimmed">
              uploaded {formatClock(u.at)}
            </Text>
          ) : null}
          {u.sha ? (
            <Text fz="xs" lh="normal" c="dimmed" ff="monospace">
              sha {u.sha}
            </Text>
          ) : null}
        </Group>
      </div>
      {u.url ? (
        <>
          <Anchor
            href={u.url}
            target="_blank"
            rel="noopener noreferrer"
            fz="sm"
            fw={500}
          >
            <Group gap={4} wrap="nowrap" component="span">
              Open
              <Icon name="externalLink" size={12} />
            </Group>
          </Anchor>
          <CopyActionIcon
            value={u.url}
            size="sm"
            label="Copy link"
            icon={<Icon name="copy" size={13} />}
            iconSize={13}
          />
        </>
      ) : null}
    </div>
  ));
}

function ValueRows({ rows }: { rows: [string, string][] }) {
  return rows.map(([k, v]) => (
    <div key={k} className={classes.row}>
      <Text fz="sm" lh="normal" c="dimmed" className={classes.key}>
        {k}
      </Text>
      <Text fz="sm" lh="normal" ff="monospace" className={classes.grow}>
        {v}
      </Text>
    </div>
  ));
}

/** One opened JSON field: readable rows for a shape the panel knows, the
    raw JSON a toggle away, and copy for the JSON. */
function JsonPanel({ field }: { field: RunFieldRow }) {
  const shape = shapeOf(field.value);
  const hasRows = shape.kind !== 'raw';
  const [view, setView] = useState<'rows' | 'json'>(hasRows ? 'rows' : 'json');
  const json = prettyJson(field.value.trim());
  const lines = json.split('\n');
  return (
    <Paper withBorder radius="md" className={classes.frame}>
      <div className={classes.head}>
        <Text
          fz="xs"
          lh="normal"
          c="dimmed"
          ff="monospace"
          className={classes.grow}
        >
          {field.key}.json
        </Text>
        {hasRows ? (
          <SegmentedControl
            size="xs"
            value={view}
            onChange={v => setView(v as 'rows' | 'json')}
            data={[
              { value: 'rows', label: 'Rows' },
              { value: 'json', label: 'JSON' },
            ]}
          />
        ) : null}
        <CopyActionIcon
          value={json}
          size="sm"
          label="Copy JSON"
          icon={<Icon name="copy" size={13} />}
          iconSize={13}
        />
      </div>
      {view === 'rows' && shape.kind === 'uploads' ? (
        <UploadRows uploads={shape.uploads} />
      ) : view === 'rows' && shape.kind === 'values' ? (
        <ValueRows rows={shape.rows} />
      ) : (
        <div data-kind="json">
          <CodeLines
            lines={lines}
            height={Math.min(lines.length * CODE_ROW + 8, CODE_MAX)}
          />
          <div className={classes.foot}>
            <Text fz="xs" lh="normal" c="dimmed">
              {lines.length} lines
            </Text>
          </div>
        </div>
      )}
    </Paper>
  );
}

/** A stage's short fields on one line; its JSON fields there too, one at a
    time opening full width below the line. */
export function FieldStrip({ fields }: { fields: RunFieldRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  // The field last opened stays drawn while the panel closes, and switching
  // fields swaps it in place: one panel, so two height animations never race.
  const [shown, setShown] = useState<string | null>(null);
  if (fields.length === 0) return null;
  const shownField = fields.find(f => f.key === shown && isJson(f));
  return (
    <div>
      <Group gap={32} wrap="wrap">
        {fields.map(f => {
          if (!isJson(f))
            return (
              <Group key={f.key} gap={8} wrap="nowrap" data-row={f.key}>
                <Text fz="sm" lh="normal" c="dimmed">
                  {fieldLabel(f.key)}
                </Text>
                <Text fz="md" fw={500} lh="normal">
                  {f.value}
                </Text>
              </Group>
            );
          const expanded = open === f.key;
          const preview = jsonPreview(f.value);
          return (
            <Button
              key={f.key}
              variant={expanded ? 'light' : 'subtle'}
              color="gray"
              size="compact-sm"
              aria-expanded={expanded}
              data-row={f.key}
              data-open={expanded || undefined}
              className={classes.toggle}
              rightSection={<Icon name="chevronDown" size={13} />}
              onClick={() => {
                setOpen(expanded ? null : f.key);
                if (!expanded) setShown(f.key);
              }}
            >
              <Group gap={8} wrap="nowrap">
                <Text span fz="sm" lh="normal" c="dimmed">
                  {fieldLabel(f.key)}
                </Text>
                {preview ? (
                  <Text span fz="sm" fw={500} lh="normal">
                    {preview}
                  </Text>
                ) : null}
              </Group>
            </Button>
          );
        })}
      </Group>
      <Collapse expanded={open !== null} keepMounted={false}>
        {shownField ? (
          <div className={classes.panel}>
            <JsonPanel key={shownField.key} field={shownField} />
          </div>
        ) : null}
      </Collapse>
    </div>
  );
}
