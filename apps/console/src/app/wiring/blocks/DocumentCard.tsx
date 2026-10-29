import { useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Collapse,
  SegmentedControl,
  Tooltip,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../server/blocksPayload';
import { useEditorHref } from '../../editorHref';
import classes from './blocks.module.css';
import { documentLayers } from './model/layers';

const VIEWS = [
  { label: 'Blocks', value: 'template' },
  { label: 'Rendered', value: 'rendered' },
];

const lines = (n: number) => `${n} ${n === 1 ? 'line' : 'lines'}`;

/** The block's file named from the skill's own folder, or from the plugin's
    attachments for a block another folder holds. */
export function fileNameOf(payload: BlocksPayload, block: PayloadBlock) {
  const dir = `${payload.dir}/`;
  if (block.path.startsWith(dir)) return block.path.slice(dir.length);
  return block.relPath.replace(/^attachments\//, '');
}

/** One line under the file bar: the share of the text each layer wrote. */
function LayerStrip({
  payload,
  block,
}: {
  payload: BlocksPayload;
  block: PayloadBlock;
}) {
  const { layers, quiet } = documentLayers(payload, block);
  if (layers.length === 0) return null;
  const summary = layers
    .map(entry => `${entry.name} ${lines(entry.lines)}`)
    .join(', ');
  return (
    <div className={classes.docStrip} data-testid="layer-strip">
      <span className={classes.docStripTitle}>Layers</span>
      <span
        className={classes.docStripBar}
        role="img"
        aria-label={`Layers: ${summary}`}
      >
        {layers.map(entry => (
          <span
            key={entry.layer}
            className={classes.segment}
            style={{ flexGrow: Math.max(entry.lines, 1) }}
            data-layer={entry.layer}
          />
        ))}
      </span>
      {layers.map(entry => (
        <span
          key={entry.layer}
          className={classes.docStripLayer}
          data-testid="layer-strip-entry"
        >
          <span className={classes.dot} data-layer={entry.layer} aria-hidden />
          <span className={classes.docStripName}>{entry.name}</span>
          <span>
            {entry.what
              ? `${lines(entry.lines)}, ${entry.what}`
              : lines(entry.lines)}
          </span>
        </span>
      ))}
      {quiet.length > 0 && (
        <span className={classes.docStripQuiet}>
          {`${quiet.join(', ')} ${quiet.length === 1 ? 'adds' : 'add'} nothing here`}
        </span>
      )}
    </div>
  );
}

/**
 * A block's text as a document: its file and the Blocks | Rendered switch in
 * a bar on top, at a single block the layers' share of it, then the text,
 * which the bar's chevron folds away.
 */
export function DocumentCard({
  payload,
  block,
  rendered,
  onRendered,
  strip = false,
  note = null,
  children,
}: {
  payload: BlocksPayload;
  /** The block whose file the bar names; null for a skill with no root. */
  block: PayloadBlock | null;
  rendered: boolean;
  onRendered: (rendered: boolean) => void;
  /** Show the layers' strip under the bar. */
  strip?: boolean;
  /** A word after the file's name, as when it holds a heading alone. */
  note?: string | null;
  /** The text; null for a file with nothing to read but its heading. */
  children: ReactNode;
}) {
  const editorHref = useEditorHref();
  const name = block ? fileNameOf(payload, block) : null;
  const [open, setOpen] = useState(true);
  const foldable = children !== null || (strip && block !== null);
  return (
    <section
      className={classes.doc}
      data-folded={!open || undefined}
      data-testid="block-document"
    >
      <header className={classes.docBar}>
        {foldable && (
          <ActionIcon
            variant="subtle"
            color="gray"
            size="sm"
            aria-label={open ? 'Fold the document' : 'Unfold the document'}
            aria-expanded={open}
            onClick={() => setOpen(value => !value)}
            data-testid="block-document-fold"
          >
            <Icon
              name="chevronRight"
              size={14}
              className={classes.docChevron}
              data-open={open || undefined}
            />
          </ActionIcon>
        )}
        {name !== null && block && (
          <span className={classes.docFile}>
            <Icon name="fileText" size={13} className={classes.glyph} />
            <span className={classes.docName} data-testid="block-file">
              {name}
            </span>
            <Tooltip label="Open the file" withArrow>
              <ActionIcon
                component="a"
                href={editorHref(block.path)}
                variant="subtle"
                color="gray"
                size="sm"
                aria-label={`Open ${name}`}
                data-testid="block-open-file"
              >
                <Icon name="externalLink" size={13} />
              </ActionIcon>
            </Tooltip>
            {note && <span className={classes.docNote}>{note}</span>}
          </span>
        )}
        <SegmentedControl
          size="xs"
          className={classes.docViews}
          data={VIEWS}
          value={rendered ? 'rendered' : 'template'}
          onChange={value => onRendered(value === 'rendered')}
        />
      </header>
      <Collapse expanded={open}>
        {strip && block && <LayerStrip payload={payload} block={block} />}
        {children !== null && <div className={classes.docBody}>{children}</div>}
      </Collapse>
    </section>
  );
}
