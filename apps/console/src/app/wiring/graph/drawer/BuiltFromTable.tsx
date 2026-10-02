import {
  Badge,
  Group,
  Paper,
  Stack,
  Table,
  Text,
  VisuallyHidden,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import classes from './drawer.module.css';
import type { BuiltFromRow, FileStatus } from './history';

const MUTED = 'var(--tk-text-3)';
const BODY = 'var(--tk-text-1)';
const OK_GLYPH = 'var(--tk-text-ok-vivid)';

const CELLS = { th: classes.cell, td: classes.cell };

function Status({ status }: { status: FileStatus }) {
  if (status === 'changed')
    return (
      <Badge color="warn" className={classes.changed} data-parity="st">
        changed
      </Badge>
    );
  const label = (
    <Text span fz={11} lh="normal" c={MUTED} data-parity="l">
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

/** The files a compiled skill was built from: the version each was built
    with, the one installed now, and whether its content changed since. */
export function BuiltFromTable({ rows }: { rows: BuiltFromRow[] }) {
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
            <Table.Th className={classes.fileColumn}>
              <Text fz={10} fw={500} lh="normal" c={MUTED} data-parity="th">
                file
              </Text>
            </Table.Th>
            <Table.Th className={classes.builtColumn}>
              <Text fz={10} fw={500} lh="normal" c={MUTED} data-parity="th">
                built with
              </Text>
            </Table.Th>
            <Table.Th className={classes.installedColumn}>
              <Text fz={10} fw={500} lh="normal" c={MUTED} data-parity="th">
                installed
              </Text>
            </Table.Th>
            <Table.Th>
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
                <Stack gap={1}>
                  <Text
                    ff="monospace"
                    fz={11}
                    lh="normal"
                    c={BODY}
                    truncate
                    data-parity="f"
                  >
                    {row.file}
                  </Text>
                  <Text fz={10} lh="normal" c={MUTED} data-parity="k">
                    {row.kind}
                  </Text>
                </Stack>
              </Table.Td>
              <Table.Td>
                {row.builtWith && (
                  <Text
                    ff="monospace"
                    fz={10}
                    lh="normal"
                    c={MUTED}
                    data-parity="bw"
                  >
                    {row.builtWith}
                  </Text>
                )}
              </Table.Td>
              <Table.Td>
                <Text
                  ff="monospace"
                  fz={10}
                  lh="normal"
                  c={MUTED}
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
