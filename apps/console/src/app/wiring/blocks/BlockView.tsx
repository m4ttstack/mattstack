import { useMemo } from 'react';
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
import { BlockText } from './BlockText';
import { CopyForClaude } from './CopyForClaude';
import { HistoryTab } from './HistoryTab';
import { LayersPanel } from './LayersPanel';
import { labelOf, rootOf } from './model/blockFacts';
import {
  bodyOf,
  graphOfBlock,
  includeNameOf,
  labelledGraph,
  renderedRangeOf,
  sharedRootOf,
} from './model/blockView';
import { sectionsAt } from './model/sections';
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
        <ActionIcon variant="default" size="sm" aria-label="File">
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

/** The block's text, then its graph (whole, small or as a card) and the
    folded blocks under it, by zoom level. */
function ZoomBody({
  payload,
  zoom,
  patch,
  wholeGraph,
}: {
  payload: BlocksPayload;
  zoom: Zoom;
  patch: Patch;
  wholeGraph: boolean;
}) {
  const open = (id: string) => patch({ block: id, select: null });
  const viewGraph = () => patch({ select: 'graph' });
  const closeGraph = () => patch({ select: null });
  if (zoom.level === 'block') {
    const { block } = zoom;
    const at = graphOfBlock(payload, block);
    const graph = at ? labelledGraph(payload, at.graph) : null;
    return (
      <>
        <BlockText block={bodyOf(block)} payload={payload} level="block" />
        {graph &&
          at &&
          (wholeGraph ? (
            <WholeGraph
              graph={graph}
              highlight={at.node}
              onSelect={open}
              onClose={closeGraph}
            />
          ) : (
            <AroundGraph
              graph={graph}
              focus={at.node}
              onSelect={open}
              onViewWholeGraph={viewGraph}
            />
          ))}
      </>
    );
  }

  const owner = zoom.level === 'parent' ? zoom.block : rootOf(payload);
  const own = owner
    ? payload.graphs.find(graph => graph.blockId === owner.id)
    : undefined;
  return (
    <>
      {owner && (
        <BlockText
          block={bodyOf(owner)}
          payload={payload}
          level="parent"
          onViewGraph={viewGraph}
        />
      )}
      {wholeGraph && own && (
        <WholeGraph
          graph={labelledGraph(payload, own)}
          highlight={null}
          onSelect={open}
          onClose={closeGraph}
        />
      )}
      {sectionsAt(payload, zoom).map(band => (
        <SectionBand
          key={band.id}
          band={band}
          onOpen={open}
          opensBlock={payload.blocks.some(b => b.id === band.id)}
        />
      ))}
    </>
  );
}

/**
 * One skill as a tree of blocks, at the zoom level the URL's `block` sets:
 * the skill, a parent block or a single block. The header and the Blocks |
 * Rendered toggle sit over the text; the Layers panel sits to the right.
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

  const title = block ? labelOf(block) : (skill?.title ?? payload.skill);
  const description = block
    ? block.title && block.title !== labelOf(block)
      ? block.title
      : null
    : (skill?.description ?? root?.summary ?? null);

  const actions = (
    <Group gap={10}>
      {block && !readOnly && <CopyForClaude payload={payload} block={block} />}
      <SegmentedControl
        size="sm"
        data={VIEWS}
        value={rendered ? 'rendered' : 'template'}
        onChange={value =>
          patch({ view: value === 'rendered' ? 'rendered' : null })
        }
      />
    </Group>
  );

  return (
    <div
      className={classes.layout}
      data-rail={readOnly ? 'none' : undefined}
      data-testid="block-view"
    >
      <div className={classes.main}>
        <div className={classes.head}>
          {block && <Crumbs payload={payload} block={block} patch={patch} />}
          <FocusHeader
            inline
            title={title}
            kind={block ? null : (skill?.kind ?? null)}
            description={description}
            loading={!block && (skill?.loading ?? false)}
            status={block ? null : (skill?.status ?? null)}
            checkError={block ? null : (skill?.checkError ?? null)}
            block={
              block
                ? { kind: block.kind, hasProps: block.props.length > 0 }
                : null
            }
            actions={actions}
          />
          {block?.path && <FileMenu block={block} />}
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
          <Text fz={14} fw={700} lh="normal" c="var(--tk-text-1)">
            Layers
          </Text>
          <LayersPanel payload={payload} zoom={zoom} />
        </aside>
      )}
    </div>
  );
}
