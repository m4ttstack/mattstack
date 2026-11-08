import {
  Anchor,
  Badge,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  VisuallyHidden,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { useWiringUrl } from '../graph/useWiringUrl';
import layerClasses from './blocks.module.css';
import classes from './history.module.css';
import type { BuiltFromRow, FileStatus } from './model/history';

const SECONDARY = 'var(--tk-text-2)';
const BODY = 'var(--tk-text-1)';
const OK_GLYPH = 'var(--tk-text-ok-vivid)';

const CELLS = { th: classes.cell, td: classes.cell };

const ROLE_COLOR: Record<BuiltFromRow['layer'], string> = {
  mattstack: 'gray',
  org: 'gold',
  team: 'purple',
};

function Status({ status }: { status: FileStatus }) {
  if (status === 'changed')
    return (
      <Badge color="warn" className={classes.changed} data-parity="st">
        changed
      </Badge>
    );
  const label = (
    <Text span fz={12} lh="normal" c={SECONDARY} data-parity="l">
      {status}
    </Text>
  );
  if (status !== 'unchanged' && status !== 'current') return label;
  return (
    <Group gap={5}>
      <Icon name="check" size={12} color={OK_GLYPH} data-parity="i" />
      {label}
    </Group>
  );
}

/** The skill a row's file is the whole of, when that skill is in this pack
    and so has a page here. */
const packSkillOf = (row: BuiltFromRow) =>
  row.kind === 'pack text'
    ? (/^([^/]+)\/SKILL\.md$/.exec(row.file)?.[1] ?? null)
    : null;

/** The files a compiled skill was built from: the version each was built
    with, the one installed now, and whether its content changed since. */
export function BuiltFromTable({ rows }: { rows: BuiltFromRow[] }) {
  const [, patch] = useWiringUrl();
  return (
    <Paper
      variant="soft-outline"
      radius={7}
      className={classes.sources}
      data-parity="sources"
    >
      <Table
        noPaper
        variant="soft"
        layout="fixed"
        horizontalSpacing={0}
        verticalSpacing={0}
        classNames={CELLS}
      >
        <Table.Thead className={classes.head} data-parity="thead">
          <Table.Tr>
            <Table.Th>
              <Text fz={12} fw={500} lh="normal" c={SECONDARY} data-parity="th">
                file
              </Text>
            </Table.Th>
            <Table.Th className={classes.builtColumn}>
              <Text fz={12} fw={500} lh="normal" c={SECONDARY} data-parity="th">
                built with
              </Text>
            </Table.Th>
            <Table.Th className={classes.installedColumn}>
              <Text fz={12} fw={500} lh="normal" c={SECONDARY} data-parity="th">
                installed
              </Text>
            </Table.Th>
            <Table.Th className={classes.statusColumn}>
              <VisuallyHidden>status</VisuallyHidden>
            </Table.Th>
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody className={classes.rows}>
          {rows.map(row => (
            <Table.Tr
              key={row.path}
              data-parity={`tr · ${row.name}`}
              data-status={row.status}
              data-testid="built-from-row"
            >
              <Table.Td>
                <Stack gap={4}>
                  <Group gap={8} wrap="nowrap">
                    {packSkillOf(row) ? (
                      <Anchor
                        component="button"
                        type="button"
                        ff="monospace"
                        fz={13}
                        lh="normal"
                        ta="left"
                        miw={0}
                        truncate
                        data-parity="f"
                        data-testid="built-from-open"
                        onClick={() =>
                          patch({
                            focus: packSkillOf(row),
                            block: null,
                            select: null,
                          })
                        }
                      >
                        {row.file}
                      </Anchor>
                    ) : (
                      <Text
                        ff="monospace"
                        fz={13}
                        lh="normal"
                        c={BODY}
                        miw={0}
                        truncate
                        data-parity="f"
                      >
                        {row.file}
                      </Text>
                    )}
                    {row.role && (
                      <Badge
                        size="sm"
                        color={ROLE_COLOR[row.layer]}
                        flex="none"
                        data-testid="built-from-role"
                      >
                        {row.role}
                      </Badge>
                    )}
                  </Group>
                  {!row.role && (
                    <Text fz={12} lh="normal" c={SECONDARY} data-parity="k">
                      {row.kind}
                    </Text>
                  )}
                </Stack>
              </Table.Td>
              <Table.Td>
                {row.builtWith && (
                  <Group gap={8} wrap="nowrap">
                    <span
                      className={layerClasses.swatch}
                      data-fill={row.layer}
                      aria-hidden
                    />
                    <Text
                      ff="monospace"
                      fz={12}
                      lh="normal"
                      c={SECONDARY}
                      data-parity="bw"
                    >
                      {row.builtWith}
                    </Text>
                  </Group>
                )}
              </Table.Td>
              <Table.Td>
                <Text
                  ff="monospace"
                  fz={12}
                  lh="normal"
                  c={SECONDARY}
                  data-parity="in"
                >
                  {row.installed}
                </Text>
              </Table.Td>
              <Table.Td>
                <Status status={row.status} />
              </Table.Td>
            </Table.Tr>
          ))}
        </Table.Tbody>
      </Table>
    </Paper>
  );
}
