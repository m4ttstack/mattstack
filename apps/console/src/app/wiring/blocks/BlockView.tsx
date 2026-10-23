import { Fragment, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ActionIcon,
  Anchor,
  Breadcrumbs,
  Code,
  Group,
  Menu,
  SegmentedControl,
  Skeleton,
  Text,
  Title,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import type {
  BlocksPayload,
  PayloadBlock,
} from '../../../server/blocksPayload';
import { useEditorHref } from '../../editorHref';
import { FocusHeader, type HeaderStatus } from '../graph/FocusHeader';
import type { FocusGroups, FocusItem } from '../graph/model/focusModel';
import type { WiringUrl } from '../graph/useWiringUrl';
import type { SkillsCheck, SkillsComposition } from '../outline';
import { useSkillSource, type SkillsAnatomy } from '../useWiring';
import { AroundGraph, WholeGraph } from './AroundGraph';
import classes from './blocks.module.css';
import { BlockText, GraphCard } from './BlockText';
import { CopyForClaude } from './CopyForClaude';
import { HistoryTab } from './HistoryTab';
import { LayersPanel } from './LayersPanel';
import { labelOf, rootOf, shownLabel } from './model/blockFacts';
import {
  bodyOf,
  graphOfBlock,
  includeNameOf,
  labelledGraph,
  leadOf,
  renderedRangeOf,
  scopeStats,
  sharedRootOf,
  withoutLead,
} from './model/blockView';
import { sectionsAt } from './model/sections';
import { usedBySites } from './model/usedBy';
import { crumbsOf, zoomOf, type Zoom } from './model/zoom';
import { SectionBand } from './SectionBand';
import { UsedBy } from './UsedBy';

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

const VIEWS = [
  { label: 'Blocks', value: 'template' },
  { label: 'Rendered', value: 'rendered' },
];

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

function FileMenu({ block }: { block: PayloadBlock }) {
  const editorHref = useEditorHref();
  return (
    <Menu position="bottom-start" withinPortal>
      <Menu.Target>
        <ActionIcon variant="default" size={24} aria-label="File">
          <Icon name="moreHorizontal" size={14} />
        </ActionIcon>
      </Menu.Target>
      <Menu.Dropdown>
        <Menu.Label>
          <Text span ff="monospace" fz={12}>
            {block.relPath}
          </Text>
        </Menu.Label>
        <Menu.Item
          component="a"
          href={editorHref(block.path)}
          leftSection={<Icon name="fileText" size={14} />}
        >
          Open file
        </Menu.Item>
      </Menu.Dropdown>
    </Menu>
  );
}

/** The block's file named from the skill's own folder, as the board does. */
function pathInSkill(payload: BlocksPayload, block: PayloadBlock): string {
  const dir = `${payload.dir}/`;
  return block.path.startsWith(dir)
    ? block.path.slice(dir.length)
    : block.relPath;
}

function Chip({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={classes.packChip} data-tone={tone}>
      {children}
    </span>
  );
}

/** The pack the skill is read in, the bases it extends and the counts of
    what is in view. */
function PackLine({
  payload,
  scope,
  version,
}: {
  payload: BlocksPayload;
  scope: PayloadBlock | null;
  version: string | null;
}) {
  const org = payload.layers.find(layer => layer.color === 'org');
  const engine = payload.engineRef.split(':').pop() ?? payload.skill;
  const stats = scopeStats(payload, scope);
  const counts = [
    plural(stats.blocks, 'block'),
    `${stats.withProps} with props`,
    ...(stats.values > 0 ? [plural(stats.values, 'prop value')] : []),
    ...(stats.graphs > 0 ? [plural(stats.graphs, 'graph')] : []),
    ...(stats.shared > 0 ? [`${stats.shared} shared`] : []),
  ].join(', ');
  return (
    <div className={classes.packLine} data-testid="pack-line">
      <Chip tone="team">{payload.pack}</Chip>{' '}
      <span className={classes.packWord}>extends</span>{' '}
      {org && (
        <>
          <Chip tone="org">{org.name}</Chip>{' '}
          <span className={classes.packWord}>extends</span>{' '}
        </>
      )}
      <Chip tone="mattstack">
        {['mattstack', engine, ...(version ? [version] : [])].join(' ')}
      </Chip>{' '}
      <span className={classes.packCounts}>{`· ${counts}`}</span>
    </div>
  );
}

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
    <Code block className={classes.rendered} data-testid="block-rendered">
      {shown.join('\n')}
    </Code>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={classes.extra} aria-label={title}>
      <Title order={4} fz={15} lh="normal">
        {title}
      </Title>
      {children}
    </section>
  );
}

function ParentBody({ children }: { children: ReactNode }) {
  return <div className={classes.parentBody}>{children}</div>;
}

/** The block's text, then its graph (whole, small or as a card) and the
    folded blocks under it, by zoom level. */
function ZoomBody({
  payload,
  zoom,
  patch,
  wholeGraph,
  lead,
  expanded,
  usedByCount,
}: {
  payload: BlocksPayload;
  zoom: Zoom;
  patch: Patch;
  wholeGraph: boolean;
  /** Every folded row shows its text. */
  expanded: boolean;
  /** The line the header shows under the title. */
  lead: string | null;
  /** How many skills paste a shared tree in; null when that is unknown. */
  usedByCount: (name: string) => number | null;
}) {
  const open = (id: string) => patch({ block: id, select: null });
  const viewGraph = () => patch({ select: 'graph' });
  const closeGraph = () => patch({ select: null });
  const glyphOf = (blockId: string) =>
    payload.blocks.find(candidate => candidate.id === blockId)?.kind ?? null;
  if (zoom.level === 'block') {
    const { block } = zoom;
    const at = graphOfBlock(payload, block);
    const graph = at ? labelledGraph(payload, at.graph) : null;
    return (
      <>
        <BlockText
          block={bodyOf(block)}
          payload={payload}
          level="block"
          size="lg"
        />
        {graph &&
          at &&
          (wholeGraph ? (
            <WholeGraph
              graph={graph}
              highlight={at.node}
              glyphOf={glyphOf}
              onSelect={open}
              onClose={closeGraph}
            />
          ) : (
            <AroundGraph
              graph={graph}
              focus={at.node}
              glyphOf={glyphOf}
              onSelect={open}
              onViewWholeGraph={viewGraph}
            />
          ))}
      </>
    );
  }

  const textOf = (id: string) => {
    const found = payload.blocks.find(candidate => candidate.id === id);
    const body = found ? bodyOf(found) : null;
    return body && body.segments.length > 0 ? (
      <BlockText block={body} payload={payload} level="block" />
    ) : null;
  };
  const owner = zoom.level === 'parent' ? zoom.block : rootOf(payload);
  const own = owner
    ? payload.graphs.find(graph => graph.blockId === owner.id)
    : undefined;
  const ownText = owner ? withoutLead(bodyOf(owner), lead) : null;
  // A parent's graph card sits close over its children's list, as the
  // board sets it; the skill's bands keep the column's wider gap.
  const Wrap = zoom.level === 'parent' ? ParentBody : Fragment;
  return (
    <Wrap>
      {ownText && ownText.segments.length > 0 && (
        <BlockText
          block={ownText}
          payload={payload}
          level="parent"
          onViewGraph={viewGraph}
        />
      )}
      {wholeGraph && own && (
        <WholeGraph
          graph={labelledGraph(payload, own)}
          highlight={null}
          glyphOf={glyphOf}
          onSelect={open}
          onClose={closeGraph}
        />
      )}
      {sectionsAt(payload, zoom).map(band => (
        <SectionBand
          key={band.id}
          band={band}
          bare={zoom.level === 'parent' && band.id === zoom.block.id}
          onOpen={open}
          opensBlock={payload.blocks.some(b => b.id === band.id)}
          graph={
            zoom.level === 'skill' ? (
              <GraphCard
                payload={payload}
                blockId={band.id}
                onViewGraph={id => patch({ block: id, select: 'graph' })}
              />
            ) : null
          }
          introText={zoom.level === 'skill' ? textOf(band.id) : null}
          bodyOf={expanded ? textOf : undefined}
          usedByCount={usedByCount}
        />
      ))}
    </Wrap>
  );
}

/**
 * One skill as a tree of blocks, at the zoom level the URL's `block` sets:
 * the skill, a parent block or a single block. The header spans the page;
 * the text sits under it beside the Layers panel.
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

  const shared = block ? sharedRootOf(payload, block) : null;
  const sharedName = shared ? includeNameOf(payload, shared) : null;

  const title = block
    ? shownLabel(payload, block)
    : (skill?.title ?? payload.skill);
  const titled =
    block?.title && block.title !== labelOf(block) ? block.title : null;
  const description =
    zoom.level === 'block'
      ? titled
      : zoom.level === 'parent'
        ? (titled ?? leadOf(bodyOf(zoom.block)))
        : ((root ? leadOf(bodyOf(root)) : null) ??
          skill?.description ??
          root?.summary ??
          null);

  const zoomKey = url.block ?? '';
  const [expandedAt, setExpandedAt] = useState<string | null>(null);
  const expanded = expandedAt === zoomKey;
  const canExpand = zoom.level !== 'block' && !rendered;

  const views = (
    <SegmentedControl
      size="sm"
      data={VIEWS}
      value={rendered ? 'rendered' : 'template'}
      onChange={value =>
        patch({ view: value === 'rendered' ? 'rendered' : null })
      }
    />
  );
  const actions = (
    <Group gap={10}>
      {canExpand && (
        <UnstyledButton
          className={classes.graphLink}
          onClick={() => setExpandedAt(expanded ? null : zoomKey)}
        >
          {expanded ? 'Collapse all' : 'Expand all'}
        </UnstyledButton>
      )}
      {zoom.level === 'block' && !readOnly ? (
        <CopyForClaude payload={payload} block={zoom.block} trailing={views} />
      ) : (
        views
      )}
    </Group>
  );

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
  const status =
    block || skill?.status?.tone === 'ok' ? null : (skill?.status ?? null);

  return (
    <div
      className={classes.layout}
      data-rail={readOnly ? 'none' : undefined}
      data-testid="block-view"
    >
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
              ? { kind: block.kind, hasProps: block.props.length > 0 }
              : null
          }
          actions={actions}
          meta={
            zoom.level !== 'block' && !readOnly ? (
              <PackLine
                payload={payload}
                scope={block}
                version={skill?.version ?? null}
              />
            ) : null
          }
        />
        {zoom.level === 'block' && block?.path && (
          <Group gap={8} className={classes.pathRow}>
            <Text span className={classes.blockPath} data-testid="block-path">
              {pathInSkill(payload, block)}
            </Text>
            <FileMenu block={block} />
          </Group>
        )}
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
        {rendered ? (
          <RenderedText
            pack={pack}
            path={renderedPath}
            range={block ? renderedRangeOf(payload, block) : null}
          />
        ) : (
          <ZoomBody
            payload={payload}
            zoom={zoom}
            patch={patch}
            wholeGraph={url.select === 'graph'}
            lead={description}
            expanded={expanded && canExpand}
            usedByCount={usedByCount}
          />
        )}

        {context && sharedName && (
          <Section title="Used by">
            <UsedBy
              skill={payload.skill}
              name={sharedName}
              composition={context.composition}
              groups={context.groups}
              pipeline={context.pipeline}
              onFocus={context.onFocus}
            />
          </Section>
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
                onOpenSkill={() => patch({ block: null, select: null })}
                file={block ? block.path : null}
              />
            ) : (
              <Text fz={13} c="dimmed" data-testid="history-unavailable">
                {`History unavailable: ${context.anatomyError}`}
              </Text>
            )}
          </Section>
        )}
      </div>

      {!readOnly && (
        <aside className={classes.rail}>
          <Text fz={15} fw={700} lh="normal" c="var(--tk-text-1)">
            Layers
          </Text>
          <LayersPanel payload={payload} zoom={zoom} />
        </aside>
      )}
    </div>
  );
}
