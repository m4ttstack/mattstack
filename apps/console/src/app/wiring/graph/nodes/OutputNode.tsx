import { memo } from 'react';
import {
  Badge,
  Box,
  Paper,
  Progress,
  Text,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { Handle, Position, type Node, type NodeProps } from '@xyflow/react';

import { LAYOUT, type OutputNodeData } from '../layout/templateLayout';
import { selectedPartId } from '../model/templateModel';
import { ACCENT, BODY, ICON_STROKE, MUTED, useCanvas } from './canvasContext';
import { STATUS_TONE } from './LinkCardNode';
import classes from './nodes.module.css';
import { parityName } from './parity';

function OutputNodeComponent({
  data: { output },
}: NodeProps<Node<OutputNodeData, 'output'>>) {
  const { view, select, onSelect } = useCanvas();
  const selected = select === 'output' || select?.startsWith('output:');
  const activePart = selectedPartId(view, select);

  return (
    <div className={classes.shell}>
      <Paper
        withBorder
        variant="ground"
        radius={8}
        w={LAYOUT.outputW}
        data-selected={selected || undefined}
        data-parity={`output · ${output.title}`}
        data-testid="output-node"
      >
        <UnstyledButton
          className={classes.header}
          h={LAYOUT.headerH}
          data-parity="header"
          data-testid="output-header"
          onClick={() => onSelect('output')}
        >
          {output.step !== null && (
            <span className={classes.step} data-parity="step">
              <Text
                ff="monospace"
                fz={10}
                lh="normal"
                c={MUTED}
                data-parity="n"
              >
                {output.step}
              </Text>
            </span>
          )}
          <Text
            fz={14}
            fw={500}
            lh="normal"
            c={BODY}
            truncate
            className={classes.grow}
            data-parity="name"
          >
            {output.title}
          </Text>
          <Text
            ff="monospace"
            fz={10}
            lh="normal"
            c={MUTED}
            data-parity="lines"
          >
            {output.lines} lines
          </Text>
          <span
            className={classes.dot}
            data-tone={STATUS_TONE[output.status]}
            data-parity="status"
          />
        </UnstyledButton>
        {output.parts.length > 0 && (
          <div className={classes.outputBody}>
            <Text fz={11} fw={500} lh="normal" c={MUTED} data-parity="h">
              What&apos;s in the {output.lines} lines
            </Text>
            <Progress.Root variant="segmented" size={8} radius={4}>
              {output.parts.map(part => (
                <Progress.Section
                  key={part.id}
                  value={(part.lines / output.lines) * 100}
                  color={part.own ? 'accent' : 'gray'}
                  data-active={part.id === activePart || undefined}
                  data-parity={`seg · ${part.label}`}
                />
              ))}
            </Progress.Root>
            {output.parts.map(part => (
              <UnstyledButton
                key={part.id}
                className={classes.part}
                data-selected={select === `output:${part.id}` || undefined}
                data-testid="output-part"
                onClick={() => onSelect(`output:${part.id}`)}
              >
                <Text
                  ff="monospace"
                  fz={11}
                  lh="normal"
                  c={part.own ? ACCENT : BODY}
                  truncate
                  className={classes.grow}
                  data-parity="n"
                >
                  {part.label}
                </Text>
                <Text
                  ff="monospace"
                  fz={10}
                  lh="normal"
                  c={MUTED}
                  data-parity="v"
                >
                  {part.lines} · {part.share}%
                </Text>
              </UnstyledButton>
            ))}
            {output.links.length > 0 && (
              <div className={classes.links} data-parity="links">
                <Text fz={11} fw={500} lh="normal" c={MUTED} data-parity="h">
                  Its text links to
                </Text>
                <div className={classes.chips}>
                  {output.links.map(link => (
                    <Badge
                      key={link.path}
                      component="button"
                      variant="panel-outline"
                      classNames={{
                        root: classes.chip,
                        section: classes.chipIcon,
                      }}
                      leftSection={
                        <Icon
                          strokeWidth={ICON_STROKE}
                          name="arrowUpRight"
                          size={10}
                          color={MUTED}
                          data-parity="i"
                        />
                      }
                      data-parity={`link · ${parityName.outputLink(link)}`}
                      attributes={{ label: { 'data-parity': 'l' } }}
                      data-testid="output-link"
                      onClick={() => onSelect(`link:${link.path}`)}
                    >
                      {link.label}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </Paper>
      <div className={classes.handles}>
        <Box className={classes.slot} h={LAYOUT.headerH}>
          <Handle
            type="target"
            position={Position.Left}
            isConnectable={false}
            className={classes.handle}
            data-parity="handle · output in"
          />
        </Box>
      </div>
    </div>
  );
}

export const OutputNode = memo(OutputNodeComponent);
