import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  Anchor,
  Breadcrumbs,
  Button,
  Skeleton,
  Text,
  Title,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../server/blocksPayload';
import { FocusHeader, type HeaderStatus } from '../graph/FocusHeader';
import type { FocusGroups, FocusItem } from '../graph/model/focusModel';
import type { BlockGraphSelect, WiringUrl } from '../graph/useWiringUrl';
import type { SkillsCheck, SkillsComposition } from '../outline';
import { useSkillSource, type SkillsAnatomy } from '../useWiring';
import { AroundGraph } from './AroundGraph';
import { BlockMap } from './BlockMap';
import classes from './blocks.module.css';
import { BlockText, FlowRow, mermaidOf } from './BlockText';
import { CopyForClaude } from './CopyForClaude';
import { DocumentCard } from './DocumentCard';
import { EveryStep } from './FlowGraph';
import { HistoryTab } from './HistoryTab';
import { MarkdownText } from './MarkdownText';
import { glyphOf, labelOf, rootOf, shownLabel } from './model/blockFacts';
import {
  bodyOf,
  graphOfBlock,
  includeNameOf,
  labelledGraph,
  leadOf,
  mapGraphOf,
  renderedRangeOf,
  scopeStats,
  sharedRootOf,
  type MapGraph,
} from './model/blockView';
import { sectionsAt } from './model/sections';
import { usedBySites } from './model/usedBy';
import { crumbsOf, zoomOf } from './model/zoom';
import { SectionBand } from './SectionBand';
import { UsedBy, useUsedBySites } from './UsedBy';

/** The skill's own facts for the header at the skill level. */
export type SkillHeader = {
  title: string;
  kind: string | null;
  description: string | null;
  status: HeaderStatus | null;
  checkError: string | null;
  loading: boolean;
  /** The installed engine's version, when rt's anatomy names it. */
  version?: string | null;
};

/** What Used by and History read beyond the payload. */
export type BlockContext = {
  composition: SkillsComposition;
  check: SkillsCheck | undefined;
  groups: FocusGroups;
  pipeline: FocusItem | null;
  anatomy: SkillsAnatomy | undefined;
  anatomyError: string | null;
  onFocus: (focus: string) => void;
};

export interface BlockViewProps {
  pack: string;
  payload: BlocksPayload;
  url: WiringUrl;
  patch: (change: Partial<WiringUrl>) => void;
  /** A hand-written skill read from its headings. */
  readOnly?: boolean;
  /** The file the Rendered view reads. */
  renderedPath?: string | null;
  skill?: SkillHeader;
  context?: BlockContext | null;
}

type Patch = BlockViewProps['patch'];

/** Rows a parent lists before Show all. */
const INSIDE_SHOWN = 7;

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

function Crumbs({
  payload,
  block,
  patch,
}: {
  payload: BlocksPayload;
  block: PayloadBlock;
  patch: Patch;
}) {
  const crumbs = crumbsOf(payload, block);
  return (
    <Breadcrumbs
      separator={<Icon name="chevronRight" size={12} />}
      className={classes.crumbs}
      data-testid="block-crumbs"
    >
      {crumbs.map((crumb, index) =>
        index === crumbs.length - 1 ? (
          <Text key={crumb.id ?? 'skill'} span fz={13} c="dimmed">
            {crumb.label}
          </Text>
        ) : (
          <Anchor
            key={crumb.id ?? 'skill'}
            component="button"
            type="button"
            fz={13}
            onClick={() => patch({ block: crumb.id, select: null })}
          >
            {crumb.label}
          </Anchor>
        )
      )}
    </Breadcrumbs>
  );
}

function StackNode({
  tone,
  name,
  sub = null,
}: {
  tone: 'team' | 'org' | 'mattstack';
  name: string;
  sub?: string | null;
}) {
  return (
    <span className={classes.stackNode} data-testid="pack-line-layer">
      <span className={classes.stackDot} data-tone={tone} aria-hidden />
      <span className={classes.stackName}>{name}</span>
      {sub && <span className={classes.stackSub}>{sub}</span>}
    </span>
  );
}

/** The packs the skill is read through, as a path from the team's down to
    mattstack's engine, then the counts of what is in it. */
function PackLine({
  payload,
  version,
}: {
  payload: BlocksPayload;
  version: string | null;
}) {
  const org = payload.layers.find(layer => layer.color === 'org');
  const engine = payload.engineRef.split(':').pop() ?? payload.skill;
  const stats = scopeStats(payload, null);
  const facts: [number, string][] = [
    [stats.blocks, stats.blocks === 1 ? 'block' : 'blocks'],
    [stats.withProps, 'with props'],
    ...(stats.values > 0
      ? [[stats.values, stats.values === 1 ? 'prop value' : 'prop values'] as [number, string]]
      : []),
    ...(stats.graphs > 0
      ? [[stats.graphs, stats.graphs === 1 ? 'graph' : 'graphs'] as [number, string]]
      : []),
    ...(stats.shared > 0 ? [[stats.shared, 'shared'] as [number, string]] : []),
  ];
  const sep = (
    <Icon name="chevronRight" size={12} className={classes.stackSep} />
  );
  return (
    <div className={classes.packLine} data-testid="pack-line">
      <div className={classes.stack} aria-label="Packs">
        <StackNode tone="team" name={payload.pack} />
        {sep}
        {org && (
          <>
            <StackNode tone="org" name={org.name} />
            {sep}
          </>
        )}
        <StackNode
          tone="mattstack"
          name="mattstack"
          sub={[engine, ...(version ? [version] : [])].join(' ')}
        />
      </div>
      <div className={classes.facts}>
        {facts.map(([count, word]) => (
          <span key={word} className={classes.fact}>
            <span className={classes.factCount}>{count}</span> {word}
          </span>
        ))}
      </div>
    </div>
  );
}

const HEADING_OR_GRAPH = /^#{1,6}\s.*$|```mermaid\n[\s\S]*?\n```/gm;

/** The compiled file, cut to the lines a block renders to. */
function RenderedText({
  pack,
  path,
  range,
}: {
  pack: string;
  path: string | null;
  range: [number, number] | null;
}) {
  const source = useSkillSource(pack, path);
  if (!path) {
    return (
      <Text fz={13} c="dimmed" data-testid="block-rendered-none">
        rt names no compiled file for this skill.
      </Text>
    );
  }
  if (source.isError) {
    return (
      <Text fz={13} c="dimmed" data-testid="block-rendered-none">
        {`The compiled file could not be read: ${(source.error as Error).message}`}
      </Text>
    );
  }
  if (!source.data) return <Skeleton height={160} />;
  const lines = source.data.content.split('\n');
  const shown = range ? lines.slice(range[0] - 1, range[1]) : lines;
  return (
    <div data-testid="block-rendered">
      <MarkdownText text={shown.join('\n')} />
    </div>
  );
}

/** A list's heading: its name and, muted beside it, a count or a note. */
function ListHead({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className={classes.listHead}>
      <Title order={4} fz={15} lh="normal" c="var(--tk-text-1)">
        {title}
      </Title>
      {meta && <span className={classes.listMeta}>{meta}</span>}
    </div>
  );
}

function Section({
  title,
  meta,
  children,
}: {
  title: string;
  meta?: string;
  children: ReactNode;
}) {
  return (
    <section className={classes.extra} aria-label={title}>
      <ListHead title={title} meta={meta} />
      {children}
    </section>
  );
}

/** The graph the URL opens, on a page of its own: the block map or Every
    step, framed to the page's height, with a way back to the block. */
function FlowPage({
  payload,
  map,
  backLabel,
  patch,
}: {
  payload: BlocksPayload;
  map: MapGraph;
  backLabel: string;
  patch: Patch;
}) {
  const shared = {
    payload,
    graph: map.graph,
    highlight: map.highlight,
    onSelect: (id: string) => patch({ block: id, select: null }),
    onView: (view: BlockGraphSelect) => patch({ select: view }),
    onClose: () => patch({ select: null }),
    backLabel,
    source: mermaidOf(
      payload.blocks.find(block => block.id === map.graph.blockId)?.text ?? ''
    ),
    fill: true,
  };
  return (
    <div className={classes.flowPage} data-testid="block-view">
      {map.view === 'graph-steps' ? (
        <EveryStep {...shared} />
      ) : (
        <BlockMap {...shared} />
      )}
    </div>
  );
}

/**
 * One skill as a tree of blocks, at the zoom level the URL's `block` sets:
 * the skill, a parent block or a single block. The block's own text reads as
 * a document; what sits inside it, what pastes it in and its history follow.
 */
export function BlockView({
  pack,
  payload,
  url,
  patch,
  readOnly = false,
  renderedPath = null,
  skill,
  context = null,
}: BlockViewProps) {
  const { zoom, missing } = useMemo(
    () => zoomOf(payload, url.block),
    [payload, url.block]
  );
  const block = zoom.level === 'skill' ? null : zoom.block;
  const root = rootOf(payload);
  const rendered = url.view === 'rendered';
  const map = useMemo(
    () => (rendered ? null : mapGraphOf(payload, zoom, url.select)),
    [url.select, rendered, payload, zoom]
  );

  const shared = block ? sharedRootOf(payload, block) : null;
  const sharedName = shared ? includeNameOf(payload, shared) : null;

  const title = block
    ? shownLabel(payload, block)
    : (skill?.title ?? payload.skill);
  // A block or a parent reads its whole text in the document, lead and all;
  // the skill leads with its first paragraph under the title.
  // The skill's own description; its file's first paragraph stays in the
  // document, which reads as the file is written.
  const description =
    zoom.level !== 'skill'
      ? null
      : (skill?.description ??
        (root ? leadOf(bodyOf(root)) : null) ??
        root?.summary ??
        null);

  const zoomKey = url.block ?? '';
  const [expandedAt, setExpandedAt] = useState<string | null>(null);
  const expanded = expandedAt === zoomKey;
  const canExpand = zoom.level === 'skill' && !rendered;

  // rt names only a verb's direct includes, so the skill in view, which
  // pastes the tree, counts even where its own entry does not list it.
  const usedByCount = (name: string) =>
    context
      ? new Set([
          payload.skill,
          ...usedBySites(
            context.composition,
            context.groups,
            name,
            context.pipeline
          ).map(site => site.skill),
        ]).size
      : null;

  if (map) {
    return (
      <FlowPage
        payload={payload}
        map={map}
        backLabel={block ? labelOf(block) : title}
        patch={patch}
      />
    );
  }

  const open = (id: string) => patch({ block: id, select: null });
  const openFlow = (id: string) => patch({ block: id, select: 'graph' });
  const owner = block ?? root;
  // The document reads as the file is written, its own heading included:
  // the page title is the block's short label, which can say less.
  const docBlock = owner ?? null;
  const docText = docBlock;
  const status =
    block || skill?.status?.tone === 'ok' ? null : (skill?.status ?? null);

  const actions =
    block && !readOnly ? (
      <CopyForClaude payload={payload} block={block} />
    ) : null;

  const textOf = (id: string) => {
    const found = payload.blocks.find(candidate => candidate.id === id);
    const body = found ? bodyOf(found) : null;
    return body && body.segments.length > 0 ? (
      <BlockText block={body} payload={payload} />
    ) : null;
  };

  // A file holding only its heading (and its graph, which the flow row
  // opens) has nothing to read, so its card is the file's bar alone.
  // A block rt sent no text for is not one with a heading alone: the bar
  // says which, and points below only when there are blocks there.
  const noText = !docText || docText.segments.length === 0;
  const headingOnly =
    !rendered &&
    (docText?.props.length ?? 0) === 0 &&
    (docText?.segments ?? []).every(
      segment => segment.text.replace(HEADING_OR_GRAPH, '').trim() === ''
    );
  const hasChildren =
    owner !== undefined &&
    payload.blocks.some(candidate => candidate.parentId === owner.id);
  const docNote = !headingOnly
    ? null
    : noText
      ? 'rt sent no text for this block'
      : hasChildren
        ? 'a heading only: its blocks are below'
        : 'a heading only';
  const document = (
    <DocumentCard
      payload={payload}
      block={docBlock}
      rendered={rendered}
      onRendered={next => patch({ view: next ? 'rendered' : null })}
      strip={zoom.level === 'block' && !headingOnly}
      note={docNote}
    >
      {headingOnly ? null : rendered ? (
        <RenderedText
          pack={pack}
          path={renderedPath}
          range={block ? renderedRangeOf(payload, block) : null}
        />
      ) : (
        docText && (
          <BlockText
            block={docText}
            payload={payload}
            size={zoom.level === 'block' ? 'lg' : 'md'}
          />
        )
      )}
    </DocumentCard>
  );

  const aroundAt = zoom.level === 'block' ? graphOfBlock(payload, zoom.block) : null;
  const inside =
    zoom.level === 'parent' ? sectionsAt(payload, zoom)[0] : undefined;

  return (
    <div className={classes.layout} data-testid="block-view">
      <div className={classes.head}>
        {block && <Crumbs payload={payload} block={block} patch={patch} />}
        <FocusHeader
          inline
          title={title}
          kind={block ? null : (skill?.kind ?? null)}
          description={description}
          loading={!block && (skill?.loading ?? false)}
          status={status}
          checkError={block ? null : (skill?.checkError ?? null)}
          block={
            block
              ? {
                  kind: glyphOf(payload, block),
                  hasProps: block.props.length > 0,
                  blocks:
                    zoom.level === 'parent'
                      ? scopeStats(payload, block).blocks
                      : undefined,
                }
              : null
          }
          actions={actions}
          meta={
            zoom.level === 'skill' && !readOnly ? (
              <PackLine payload={payload} version={skill?.version ?? null} />
            ) : null
          }
        />
        {missing !== null && (
          <Text fz={13} c="dimmed" data-testid="block-missing">
            {`${payload.skill} has no block ${missing}, so this is the whole skill.`}
          </Text>
        )}
        {readOnly && (
          <Text fz={13} c="dimmed" data-testid="read-only-note">
            Hand-written: read from its headings, not built from blocks.
          </Text>
        )}
      </div>

      <div className={classes.main}>
        {document}

        {!rendered && owner && zoom.level !== 'block' && (
          <FlowRow payload={payload} blockId={owner.id} onOpen={openFlow} />
        )}

        {!rendered && aroundAt && (
          <AroundGraph
            graph={labelledGraph(payload, aroundAt.graph)}
            payload={payload}
            skill={payload.skill}
            focus={aroundAt.node}
            onSelect={open}
            onViewWholeGraph={() => patch({ select: 'graph' })}
          />
        )}

        {!rendered && inside && inside.rows.length > 0 && (
          <section className={classes.extra} aria-label="Inside this block">
            <ListHead
              title="Inside this block"
              meta={String(inside.rows.length)}
            />
            <SectionBand
              band={inside}
              bare
              onOpen={open}
              opensBlock
              limit={INSIDE_SHOWN}
              bodyOf={textOf}
              usedByCount={usedByCount}
            />
          </section>
        )}

        {!rendered &&
          zoom.level === 'skill' &&
          sectionsAt(payload, zoom).map((band, index) => (
            <SectionBand
              key={band.id}
              band={band}
              action={
                index === 0 && canExpand ? (
                  <Button
                    size="xs"
                    variant="default"
                    leftSection={
                      <Icon
                        name={expanded ? 'chevronUp' : 'chevronsUpDown'}
                        size={13}
                      />
                    }
                    onClick={() => setExpandedAt(expanded ? null : zoomKey)}
                    data-testid="expand-all"
                  >
                    {expanded ? 'Collapse all' : 'Expand all'}
                  </Button>
                ) : null
              }
              onOpen={open}
              opensBlock={payload.blocks.some(b => b.id === band.id)}
              graph={
                <FlowRow
                  payload={payload}
                  blockId={band.id}
                  onOpen={openFlow}
                />
              }
              introText={textOf(band.id)}
              bodyOf={textOf}
              allOpen={expanded}
              usedByCount={usedByCount}
            />
          ))}

        {context && sharedName && (
          <UsedBySection
            skill={payload.skill}
            name={sharedName}
            context={context}
          />
        )}
        {context && (context.anatomy || context.anatomyError) && (
          <Section title="History">
            {context.anatomy ? (
              <HistoryTab
                pack={pack}
                anatomy={context.anatomy}
                composition={context.composition}
                check={context.check}
                pipeline={context.pipeline}
                onOpen={context.onFocus}
                block={block}
              />
            ) : (
              <Text fz={13} c="dimmed" data-testid="history-unavailable">
                {`History unavailable: ${context.anatomyError}`}
              </Text>
            )}
          </Section>
        )}
      </div>
    </div>
  );
}

function UsedBySection({
  skill,
  name,
  context,
}: {
  skill: string;
  name: string;
  context: BlockContext;
}) {
  const sites = useUsedBySites(
    context.composition,
    context.groups,
    name,
    context.pipeline
  );
  return (
    <Section
      title="Used by"
      meta={`${plural(sites.length, 'skill')} ${sites.length === 1 ? 'includes' : 'include'} this block`}
    >
      <UsedBy
        skill={skill}
        sites={sites}
        name={name}
        onFocus={context.onFocus}
      />
    </Section>
  );
}
