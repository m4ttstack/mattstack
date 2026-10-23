import { useState } from 'react';
import type { CSSProperties } from 'react';
import {
  Menu,
  NavLink,
  Skeleton,
  Stack,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { kindOf } from '../graph/FocusHeader';
import type { FocusGroups, FocusItem } from '../graph/model/focusModel';
import { useGraphFocus } from '../graph/useGraphFocus';
import { BlockGlyph, LayerDots } from './BlockRow';
import classes from './blocks.module.css';
import { blockCount } from './model/blockView';
import { sidebarRows, type SidebarRow } from './model/sidebar';
import { useSkillBlocks } from './useSkillBlocks';

const blocks = (n: number) => `${n} ${n === 1 ? 'block' : 'blocks'}`;

/** Every skill the switcher can open, in the focus list's groups. */
function switcherGroups(groups: FocusGroups): [string, FocusItem[]][] {
  const list: [string, FocusItem[]][] = [
    ...groups.pipelines.map((pipeline): [string, FocusItem[]] => [
      pipeline.label,
      pipeline.children,
    ]),
    ['Standalone', groups.standalone],
    ['Board', groups.board],
  ];
  return list.filter(([, items]) => items.length > 0);
}

function TreeRow({
  row,
  onPick,
}: {
  row: SidebarRow;
  onPick: (row: SidebarRow) => void;
}) {
  const folder = row.count !== null;
  return (
    <NavLink
      component="button"
      type="button"
      color="accent"
      active={row.selected}
      label={
        <Text span fz={13} fw={row.selected ? 500 : 400}>
          {row.label}
        </Text>
      }
      leftSection={
        <>
          {folder && (
            <Icon
              name="chevronRight"
              size={12}
              className={classes.treeChevron}
              data-open={row.open || undefined}
            />
          )}
          {!folder && row.glyph !== 'shared' && (
            <BlockGlyph glyph={row.glyph} size={13} />
          )}
        </>
      }
      rightSection={
        row.dots.length > 0 ? (
          <LayerDots dots={row.dots} />
        ) : folder ? (
          <span className={classes.treeCount}>{row.count}</span>
        ) : undefined
      }
      classNames={{ root: classes.treeRow }}
      style={{ '--depth': row.depth } as CSSProperties}
      data-testid={`block-tree-${row.id}`}
      onClick={() => onPick(row)}
    />
  );
}

/**
 * The block view's sidebar: back to all skills, a switcher for the skill in
 * view, and its block tree. Sections fold, and only the one holding the
 * selection starts open; the Shared row folds by hand.
 */
export function BlockSidebar({ pack }: { pack: string }) {
  const { url, patch, compositionQuery, groups, focused, pipeline } =
    useGraphFocus(pack);
  const skill = useSkillBlocks(pack, focused, compositionQuery.data);
  const [unfolded, setUnfolded] = useState<ReadonlySet<string>>(new Set());

  const pick = (row: SidebarRow) => {
    if (row.id === 'shared') {
      setUnfolded(open => {
        const next = new Set(open);
        if (next.has('shared')) next.delete('shared');
        else next.add('shared');
        return next;
      });
      return;
    }
    patch({ block: row.id, select: null });
  };

  const payload = skill.state === 'ready' ? skill.payload : null;
  const rows = payload ? sidebarRows(payload, url.block, unfolded) : [];

  return (
    <Stack gap={2} className={classes.sidebar} data-testid="block-sidebar">
      <UnstyledButton
        className={classes.back}
        onClick={() => patch({ focus: null, block: null })}
      >
        <Icon name="chevronLeft" size={14} />
        All skills
      </UnstyledButton>
      {focused && (
        <Menu position="bottom-start" withinPortal>
          <Menu.Target>
            <UnstyledButton
              className={classes.switcher}
              data-selected={url.block === null || undefined}
              aria-label={`Switch skill: ${focused.label}`}
              data-testid="skill-switcher"
            >
              <span>
                <Text span display="block" className={classes.switcherName}>
                  {focused.step !== null ? focused.label : focused.skill}
                </Text>
                <Text span display="block" className={classes.switcherMeta}>
                  {payload
                    ? `${kindOf(focused, pipeline)} · ${blocks(blockCount(payload))}`
                    : kindOf(focused, pipeline)}
                </Text>
              </span>
              <Icon name="chevronsUpDown" size={14} />
            </UnstyledButton>
          </Menu.Target>
          <Menu.Dropdown>
            <Menu.Item onClick={() => patch({ block: null, select: null })}>
              {`The whole of ${focused.step !== null ? focused.label : focused.skill}`}
            </Menu.Item>
            {groups &&
              switcherGroups(groups).map(([label, items]) => [
                <Menu.Label key={`label-${label}`}>{label}</Menu.Label>,
                ...items.map(item => (
                  <Menu.Item
                    key={item.key}
                    disabled={item.key === focused.key}
                    onClick={() => patch({ focus: item.key })}
                  >
                    {item.label}
                  </Menu.Item>
                )),
              ])}
          </Menu.Dropdown>
        </Menu>
      )}
      <Text span className={classes.groupLabel}>
        Blocks
      </Text>
      {skill.state === 'loading' && (
        <Stack gap={2} data-testid="block-tree-loading">
          {[0, 1, 2, 3].map(i => (
            <Skeleton key={i} height={28} />
          ))}
        </Stack>
      )}
      {(skill.state === 'error' || skill.state === 'note') && (
        <Text fz={12} c="dimmed" px={6}>
          {skill.message}
        </Text>
      )}
      {rows.map(row => (
        <TreeRow key={row.id} row={row} onPick={pick} />
      ))}
      {payload && (
        <ul className={classes.glyphKey} aria-label="Glyphs">
          <li>
            <BlockGlyph glyph="step" size={11} /> step
          </li>
          <li>
            <BlockGlyph glyph="question" size={11} /> question
          </li>
          <li>
            <BlockGlyph glyph="gate" size={11} /> gate
          </li>
        </ul>
      )}
    </Stack>
  );
}
