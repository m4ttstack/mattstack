import { useEffect, useState } from 'react';
import {
  Autocomplete,
  Button,
  Group,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mattstack/app-kit/core';

import type {
  HarnessState,
  PaneAccount,
  PaneDirectory,
  PaneHarness,
} from './types';

/** Always rendered inside `PanePickerModal`, outside
    `ThemeOverrideWrapper theme={chatFontTheme}`, so `size="xs"` here is
    small band under the base tokyo theme. */
const MUTED = 'var(--tk-text-4)';
const BORDER = 'var(--tk-border)';
const BAD = 'var(--mantine-color-bad-text)';

const MODELS = ['claude-fable-5', 'claude-opus-5', 'claude-sonnet-5'];
const EFFORTS = [
  { value: '', label: '' },
  { value: 'low', label: 'low' },
  { value: 'medium', label: 'medium' },
  { value: 'high', label: 'high' },
  { value: 'max', label: 'max' },
];

export interface NewPaneArgs {
  cwd: string;
  provider?: string;
  account?: string;
  model?: string;
  effort?: string;
  prompt?: string;
  workspace?: string;
}

export interface NewPaneFormProps {
  /** `enabled: false`: the Claude-only form, as before the switch. Null
      while the list is loading and an error when it could not be read: the
      form cannot know what Start would run, so Start stays off. */
  harnesses: HarnessState;
  onBack: () => void;
  onStart: (args: NewPaneArgs) => void;
}

/** A harness option as a form control: a choice is a Select of its
    choices, text is free entry with the harness's catalog as suggestions
    when it has one, and an option it does not offer is absent. */
function OptionField({
  harness,
  name,
  label,
  value,
  onChange,
}: {
  harness: PaneHarness;
  name: 'model' | 'effort';
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const option = harness.options.find(o => o.name === name);
  if (!option) return null;
  if (option.kind === 'choice')
    return (
      <Select
        label={label}
        data={option.choices ?? []}
        value={value || null}
        onChange={v => onChange(v ?? '')}
        placeholder="default"
        clearable
      />
    );
  const suggested = harness.suggestions?.[name] ?? [];
  if (suggested.length > 0)
    return (
      <Autocomplete
        label={label}
        placeholder="default"
        data={suggested}
        value={value}
        onChange={onChange}
      />
    );
  return (
    <TextInput
      label={label}
      placeholder="default"
      value={value}
      onChange={e => onChange(e.currentTarget.value)}
    />
  );
}

function notReadyText(harness: PaneHarness): string {
  return (
    harness.reason ??
    `${harness.label} is not ready, so starting it may be refused.`
  );
}

export function NewPaneForm({ harnesses, onBack, onStart }: NewPaneFormProps) {
  const on =
    harnesses && 'enabled' in harnesses && harnesses.enabled ? harnesses : null;
  const blocked =
    harnesses === null
      ? ''
      : 'error' in harnesses
        ? harnesses.error
        : (on?.notice ?? null);
  const [cwd, setCwd] = useState('');
  const [suggestions, setSuggestions] = useState<PaneDirectory[]>([]);
  const [accounts, setAccounts] = useState<PaneAccount[]>([]);
  const [account, setAccount] = useState<string | null>(null);
  const [model, setModel] = useState('claude-fable-5');
  const [effort, setEffort] = useState('');
  const [workspace, setWorkspace] = useState('chat');
  const [prompt, setPrompt] = useState('');
  const [picked, setPicked] = useState<string | null>(null);
  const [option, setOption] = useState({ model: '', effort: '' });
  const harness = on
    ? (on.harnesses.find(h => h.id === picked) ??
      on.harnesses.find(h => h.id === on.defaultHarness) ??
      on.harnesses[0])
    : undefined;
  const takesAccount =
    !on || harness?.options.some(o => o.name === 'account') === true;

  useEffect(() => {
    let cancelled = false;
    fetch('/api/panes/accounts')
      .then(res => res.json())
      .then((data: { accounts?: PaneAccount[] }) => {
        if (cancelled) return;
        const list = data.accounts ?? [];
        setAccounts(list);
        if (list.length > 0) setAccount(list[0]!.alias ?? list[0]!.email);
      })
      .catch(() => {
        if (!cancelled) setAccounts([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/panes/directories?q=${encodeURIComponent(cwd)}`)
      .then(res => res.json())
      .then((data: { directories?: PaneDirectory[] }) => {
        if (!cancelled) setSuggestions(data.directories ?? []);
      })
      .catch(() => {
        if (!cancelled) setSuggestions([]);
      });
    return () => {
      cancelled = true;
    };
  }, [cwd]);

  const command = on
    ? [harness?.label, option.model, option.effort].filter(Boolean).join(' · ')
    : account
      ? `cswap run ${account} --share-history -- claude --model ${model}${effort ? ` --effort ${effort}` : ''}`
      : `claude --model ${model}${effort ? ` --effort ${effort}` : ''}`;

  function submit() {
    if (on) {
      onStart({
        cwd,
        provider: harness?.id,
        ...(takesAccount && account ? { account } : {}),
        model: option.model || undefined,
        effort: option.effort || undefined,
        prompt: prompt || undefined,
        workspace,
      });
      return;
    }
    onStart({
      cwd,
      account: account ?? undefined,
      model,
      effort: effort || undefined,
      prompt: prompt || undefined,
      workspace,
    });
  }

  return (
    <Stack gap="sm">
      <Stack gap="xs">
        <TextInput
          label="Directory"
          placeholder="/path/to/a/repo"
          value={cwd}
          onChange={e => setCwd(e.currentTarget.value)}
        />
        {suggestions.length > 0 && (
          <Stack gap={2}>
            {suggestions.map(dir => (
              <UnstyledButton
                key={dir.path}
                onClick={() => {
                  setCwd(dir.path);
                  setSuggestions([]);
                }}
                style={{
                  height: 34,
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--mantine-spacing-sm)',
                  padding: '0 var(--mantine-spacing-sm)',
                  borderRadius: 'var(--mantine-radius-sm)',
                  border: `1px solid ${BORDER}`,
                  textAlign: 'left',
                }}
              >
                <Text component="span" size="sm">
                  {dir.path}
                </Text>
                <Text component="span" size="xs" style={{ color: MUTED }}>
                  {[dir.repo, dir.branch].filter(Boolean).join(' · ')}
                </Text>
              </UnstyledButton>
            ))}
          </Stack>
        )}
      </Stack>
      {on && on.harnesses.length > 0 && (
        <Select
          label="Agent"
          data={on.harnesses.map(h => ({ value: h.id, label: h.label }))}
          value={harness?.id ?? null}
          onChange={v => {
            setPicked(v);
            setOption({ model: '', effort: '' });
          }}
          description={
            harness && !harness.ready ? notReadyText(harness) : undefined
          }
          renderOption={({ option: item }) => (
            <Group gap="xs" wrap="nowrap">
              <span>{item.label}</span>
              {on.harnesses.find(h => h.id === item.value)?.ready === false && (
                <Text component="span" size="xs" style={{ color: MUTED }}>
                  not ready
                </Text>
              )}
            </Group>
          )}
        />
      )}
      {takesAccount && accounts.length > 0 && (
        <Select
          label="Account"
          data={accounts.map(a => ({
            value: a.alias ?? a.email,
            label: `${a.alias ?? a.email} · ${a.headroom ?? ''}`,
          }))}
          value={account}
          onChange={setAccount}
          allowDeselect={false}
        />
      )}
      {on ? (
        harness &&
        harness.options.some(
          o => o.name === 'model' || o.name === 'effort'
        ) && (
          <Group grow>
            <OptionField
              harness={harness}
              name="model"
              label="Model"
              value={option.model}
              onChange={v => setOption(o => ({ ...o, model: v }))}
            />
            <OptionField
              harness={harness}
              name="effort"
              label="Effort"
              value={option.effort}
              onChange={v => setOption(o => ({ ...o, effort: v }))}
            />
          </Group>
        )
      ) : (
        <Group grow>
          <Select
            label="Model"
            data={MODELS}
            value={model}
            onChange={v => setModel(v ?? MODELS[0]!)}
            allowDeselect={false}
          />
          <Select
            label="Effort"
            data={EFFORTS}
            value={effort}
            onChange={v => setEffort(v ?? '')}
            allowDeselect={false}
          />
        </Group>
      )}
      <TextInput
        label="Workspace"
        value={workspace}
        onChange={e => setWorkspace(e.currentTarget.value)}
      />
      <Textarea
        label="Opening prompt"
        value={prompt}
        onChange={e => setPrompt(e.currentTarget.value)}
        rows={2}
      />
      <Text
        size="xs"
        style={{
          color: MUTED,
          fontFamily: 'var(--mantine-font-family-monospace)',
        }}
      >
        {command}
      </Text>
      {blocked && (
        <Text
          size="xs"
          style={{
            color: harnesses && 'error' in harnesses ? BAD : MUTED,
          }}
        >
          {blocked}
        </Text>
      )}
      <Group
        justify="flex-end"
        gap="xs"
        style={{
          borderTop: '1px solid var(--tk-border-soft)',
          paddingTop: 'var(--mantine-spacing-xs)',
        }}
      >
        <Button
          variant="default"
          size="sm"
          onClick={onBack}
          data-testid="pane-back"
        >
          Back
        </Button>
        <Button
          size="sm"
          disabled={
            !cwd.startsWith('/') ||
            blocked !== null ||
            (on !== null && !harness)
          }
          onClick={submit}
          data-testid="pane-start"
        >
          Start pane
        </Button>
      </Group>
    </Stack>
  );
}
