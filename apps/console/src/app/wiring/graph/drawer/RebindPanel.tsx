import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Code,
  Combobox,
  Group,
  Input,
  InputBase,
  Paper,
  Stack,
  Text,
  useCombobox,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';

import { suffixOf, type SkillsComposition } from '../../outline';
import { useSkillsApply } from '../../useWiring';
import { ButtonLabel } from '../ButtonLabel';
import { stepLabel } from '../model/focusModel';
import classes from './drawer.module.css';
import { rebindChoices } from './rebind';

const MUTED = 'var(--tk-text-3)';
const BODY = 'var(--tk-text-1)';

const BUTTON = { root: classes.panelButton };

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <Stack gap={2} data-testid="rebind-fact">
      <Text fz={10} lh="normal" c={MUTED} data-parity="k">
        {label}
      </Text>
      <Text ff="monospace" fz={11} lh="normal" c={BODY} data-parity="v">
        {value}
      </Text>
    </Stack>
  );
}

/**
 * Picks a different fill for one of a skill's slots and binds it after a
 * confirm. Picking writes nothing; only Apply does.
 */
export function RebindPanel({
  pack,
  skill,
  skillRef,
  slot,
  composition,
  onDone,
}: {
  pack: string;
  skill: string;
  /** The ref the pack's bindings key the skill by. */
  skillRef: string;
  slot: string;
  composition: SkillsComposition;
  onDone: () => void;
}) {
  const { bind, writing } = useSkillsApply(pack);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const choices = useMemo(
    () => rebindChoices(composition, skill, skillRef, slot),
    [composition, skill, skillRef, slot]
  );
  const [picked, setPicked] = useState<string | null>(null);
  const combobox = useCombobox();
  const labelId = useId();

  const step = stepLabel(skill);
  const changed = picked !== null && picked !== choices.current;
  const command = `rt skills bind ${skill} ${slot} ${picked} --pack ${pack}`;

  const pick = (binding: string) => {
    setPicked(binding);
    combobox.closeDropdown();
  };

  // Reported from the promise, which settles whether or not this panel is
  // still mounted; a `mutate` callback is dropped once it unmounts.
  const apply = () => {
    if (!changed || writing) return;
    const fill = picked;
    const was = choices.current
      ? `instead of ${suffixOf(choices.current)}`
      : `in its ${slot} slot`;
    modals.confirm({
      title: `Rebind the ${slot} slot?`,
      message: `${step} will use ${suffixOf(fill)} ${was}. Nothing is shared until you sync.`,
      labels: { confirm: 'Apply' },
      onConfirm: () => {
        bind
          .mutateAsync({ verb: skill, slot, fill })
          .then(result => {
            if (!result.ok) {
              notifications.error(result.error ?? 'rt skills bind failed');
              return;
            }
            notifications.success(`Rebound ${slot} to ${suffixOf(fill)}`);
            if (mounted.current) onDone();
          })
          .catch((error: Error) => notifications.error(error.message));
      },
    });
  };

  return (
    <Box
      className={classes.rebind}
      data-own-keys
      data-parity="Rebind"
      data-testid="rebind-panel"
    >
      <div className={classes.row}>
        <Icon name="replace" size={15} color={MUTED} data-parity="i" />
        <Text
          fz={13}
          fw={700}
          lh="normal"
          c={BODY}
          className={classes.sentence}
          data-parity="t"
        >
          Change what fills the {slot} slot
        </Text>
      </div>
      <Group gap={16} align="flex-start">
        <Fact label="contract" value={choices.contract ?? 'unknown'} />
        <Fact label="set by" value={choices.setBy} />
        <Fact label="required" value={choices.required} />
      </Group>
      <Combobox store={combobox} onOptionSubmit={pick}>
        <div className={classes.fromTo}>
          <Paper
            variant="panel-outline"
            radius={6}
            className={classes.field}
            data-parity="current"
            data-testid="rebind-current"
          >
            <Icon name="fileText" size={13} color={MUTED} data-parity="i" />
            <Text
              ff="monospace"
              fz={12}
              lh="normal"
              c={MUTED}
              truncate
              className={classes.sentence}
              data-parity="v"
            >
              {choices.current ? suffixOf(choices.current) : 'nothing bound'}
            </Text>
            <Text fz={10} lh="normal" c={MUTED} data-parity="tag">
              now
            </Text>
          </Paper>
          <Icon name="arrowRight" size={16} color={MUTED} data-parity="arrow" />
          <Combobox.EventsTarget targetType="button" withExpandedAttribute>
            <InputBase
              component="button"
              type="button"
              pointer
              radius={6}
              classNames={{ input: `${classes.field} ${classes.picker}` }}
              onClick={() => combobox.toggleDropdown()}
              aria-label={`What fills the ${slot} slot`}
              data-parity="Select"
            >
              <Icon name="fileText" size={13} color={MUTED} data-parity="i" />
              <Text
                span
                ff="monospace"
                fz={12}
                lh="normal"
                c={BODY}
                truncate
                className={classes.sentence}
                data-parity="v"
              >
                {picked ? (
                  suffixOf(picked)
                ) : (
                  <Input.Placeholder>Pick a file</Input.Placeholder>
                )}
              </Text>
              <Combobox.Chevron size="13px" color={MUTED} data-parity="c" />
            </InputBase>
          </Combobox.EventsTarget>
        </div>
        {combobox.dropdownOpened && (
          <Paper
            variant="ground"
            withBorder
            radius={7}
            className={classes.options}
            data-parity="options"
          >
            <div className={classes.optionsLabel}>
              <Text
                id={labelId}
                fz={11}
                fw={500}
                lh="normal"
                c={MUTED}
                data-parity="h"
              >
                Files with the {choices.contract} contract
              </Text>
            </div>
            <Combobox.Options
              labelledBy={labelId}
              className={classes.optionList}
            >
              {choices.options.map(option => {
                const active = option.binding === picked;
                return (
                  <Combobox.Option
                    key={option.binding}
                    value={option.binding}
                    variant="wash"
                    active={active}
                    className={classes.option}
                    // An option is a board layer only where it paints, the
                    // picked one; until a pick each keeps its name so a run
                    // can pick it.
                    data-parity={
                      active || picked === null
                        ? `option · ${option.name}`
                        : undefined
                    }
                  >
                    <Text
                      span
                      ff="monospace"
                      fz={12}
                      lh="normal"
                      className={classes.sentence}
                      data-parity="n"
                    >
                      {option.name}
                    </Text>
                    <Text span fz={11} lh="normal" c={MUTED} data-parity="s">
                      {option.plugin} · {option.where}
                    </Text>
                    {active && (
                      <Icon
                        name="check"
                        size={13}
                        color="var(--tk-text-accent)"
                        data-parity="c"
                      />
                    )}
                  </Combobox.Option>
                );
              })}
            </Combobox.Options>
          </Paper>
        )}
      </Combobox>
      {changed && (
        <Code
          block
          color="bg-level-1"
          className={classes.bindCommand}
          data-parity="command"
          data-testid="rebind-command"
        >
          <Text
            span
            ff="monospace"
            fz={11}
            lh="normal"
            c={BODY}
            data-parity="c"
          >
            {command}
          </Text>
          <Text span ff="text" fz={11} lh="normal" c={MUTED} data-parity="n">
            Writes the binding in this pack, then rebuilds {step}. Nothing is
            shared until you sync.
          </Text>
        </Code>
      )}
      <Group gap={8} justify="flex-end">
        <Button
          variant="card-outline"
          size="xs"
          radius={6}
          classNames={BUTTON}
          disabled={writing}
          onClick={onDone}
          data-parity="button · Cancel"
        >
          <ButtonLabel>Cancel</ButtonLabel>
        </Button>
        <Button
          color="accent"
          size="xs"
          radius={6}
          classNames={BUTTON}
          disabled={!changed || writing}
          loading={bind.isPending}
          onClick={apply}
          data-parity="button · Apply"
        >
          <ButtonLabel>Apply</ButtonLabel>
        </Button>
      </Group>
    </Box>
  );
}
