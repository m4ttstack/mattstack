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
  SegmentedControl,
  Stack,
  Text,
  useCombobox,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import { notifications } from '@mattstack/app-kit/notifications';
import { useQueryClient } from '@tanstack/react-query';

import { suffixOf, type SkillsComposition } from '../../outline';
import { guardedWrite, useSkillsApply } from '../../useWiring';
import { ButtonLabel } from '../ButtonLabel';
import { stepLabel } from '../model/focusModel';
import classes from './drawer.module.css';
import { listed, pipelineChoices, rebindChoices } from './rebind';

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
  workType,
  composition,
  onDone,
}: {
  pack: string;
  skill: string;
  /** The ref the pack's bindings key the skill by. */
  skillRef: string;
  slot: string;
  /** The pipeline the graph is showing; null for a skill outside one. */
  workType: string | null;
  composition: SkillsComposition;
  onDone: () => void;
}) {
  const { bind, writing } = useSkillsApply(pack);
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const targets = useMemo(
    () => pipelineChoices(composition, skill, skillRef, slot, workType),
    [composition, skill, skillRef, slot, workType]
  );
  const [chosen, setChosen] = useState<string | null>(targets.preselected);
  const choosing = targets.choices.length > 0;
  const choices = useMemo(
    () =>
      rebindChoices(
        composition,
        skill,
        skillRef,
        slot,
        workType,
        choosing ? chosen : undefined
      ),
    [composition, skill, skillRef, slot, workType, choosing, chosen]
  );
  const [picked, setPicked] = useState<string | null>(null);
  const combobox = useCombobox();
  const labelId = useId();

  const { verb, pipeline } = choices;
  const step = stepLabel(verb);
  const changed = picked !== null && picked !== choices.current;
  const command = `rt skills bind ${verb} ${slot} ${picked}${pipeline ? ` --pipeline ${pipeline}` : ''} --pack ${pack}`;
  const inPipeline = pipeline ? ` in the ${pipeline} pipeline` : '';
  const unsetting =
    bind.isPending && bind.variables !== undefined && 'unset' in bind.variables;

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
    const kept = choices.keptOverride
      ? ` by default. The ${choices.keptOverride} pipeline keeps its own override`
      : '';
    modals.confirm({
      title: `Rebind the ${slot} slot?`,
      message: `${step} will use ${suffixOf(fill)} ${was}${inPipeline}${kept}. Nothing is shared until you sync.`,
      labels: { confirm: 'Apply' },
      onConfirm: () =>
        guardedWrite(queryClient, pack, () => {
          bind
            .mutateAsync({
              verb,
              slot,
              fill,
              ...(pipeline ? { pipeline } : {}),
            })
            .then(result => {
              if (!result.ok) {
                notifications.error(result.error ?? 'rt skills bind failed');
                return;
              }
              notifications.success(`Rebound ${slot} to ${suffixOf(fill)}`);
              if (mounted.current) onDone();
            })
            .catch((error: Error) => notifications.error(error.message));
        }),
    });
  };

  const clearOverride = () => {
    if (!pipeline || !choices.removable || writing) return;
    const override = choices.current ? suffixOf(choices.current) : 'unbound';
    const then = choices.fallback
      ? `uses the default fill, ${suffixOf(choices.fallback)},`
      : 'has nothing bound';
    modals.confirm({
      title: `Use the default for the ${slot} slot?`,
      message: `Removes this pack's ${pipeline} override, ${override}. The ${step} step then ${then} if no other layer overrides it. Nothing is shared until you sync.`,
      labels: { confirm: 'Use default' },
      onConfirm: () =>
        guardedWrite(queryClient, pack, () => {
          bind
            .mutateAsync({ verb, slot, pipeline, unset: true })
            .then(result => {
              if (!result.ok) {
                notifications.error(result.error ?? 'rt skills bind failed');
                return;
              }
              notifications.success(
                `Removed the ${pipeline} override on ${slot}`
              );
              if (mounted.current) onDone();
            })
            .catch((error: Error) => notifications.error(error.message));
        }),
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
          {choices.current ? 'Change' : 'Choose'} what fills the {slot} slot
        </Text>
      </div>
      <Group gap={16} align="flex-start">
        <Fact label="contract" value={choices.contract ?? 'unknown'} />
        <Fact label="set by" value={choices.setBy} />
        <Fact label="required" value={choices.required} />
        {choosing ? (
          <Stack gap={2}>
            <Text fz={10} lh="normal" c={MUTED}>
              pipeline
            </Text>
            <SegmentedControl
              variant="quiet"
              radius={7}
              aria-label="Pick the pipeline to change"
              value={String(
                targets.choices.findIndex(choice => choice.pipeline === chosen)
              )}
              onChange={index => {
                setChosen(targets.choices[Number(index)]?.pipeline ?? null);
                setPicked(null);
              }}
              data={targets.choices.map((choice, index) => ({
                value: String(index),
                label: choice.label,
              }))}
              classNames={{
                root: classes.segmented,
                control: classes.segment,
                label: classes.segmentLabel,
              }}
            />
          </Stack>
        ) : (
          pipeline && <Fact label="pipeline" value={pipeline} />
        )}
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
              {choices.currentOwner?.kind === 'base'
                ? `${choices.currentOwner.name} · org base · now`
                : 'now'}
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
                      {`${option.owner.kind === 'base' ? `${option.owner.name} · org base` : option.plugin} · ${option.where}`}
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
            {pipeline
              ? `Writes the ${pipeline} pipeline's own binding in this pack`
              : 'Writes the binding in this pack'}
            {choices.rebuildsPack
              ? ', then rebuilds every skill in the pack.'
              : `, then rebuilds ${listed(choices.rebuilds.map(stepLabel))}.`}{' '}
            Nothing is shared until you sync.
          </Text>
        </Code>
      )}
      <Group gap={8} justify="flex-end">
        {pipeline && choices.overrideSetBy && (
          <Text
            fz={11}
            lh="normal"
            c={MUTED}
            className={classes.useDefault}
            data-testid="rebind-override-layer"
          >
            This override comes from {choices.overrideSetBy}; remove it there.
          </Text>
        )}
        {pipeline && choices.removable && (
          <Button
            variant="card-outline"
            size="xs"
            radius={6}
            classNames={{
              root: `${classes.panelButton} ${classes.useDefault}`,
            }}
            disabled={writing}
            loading={unsetting}
            onClick={clearOverride}
          >
            <ButtonLabel>Use default</ButtonLabel>
          </Button>
        )}
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
          loading={bind.isPending && !unsetting}
          onClick={apply}
          data-parity="button · Apply"
        >
          <ButtonLabel>Apply</ButtonLabel>
        </Button>
      </Group>
    </Box>
  );
}
