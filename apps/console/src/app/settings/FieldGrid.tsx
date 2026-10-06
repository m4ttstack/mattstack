import { useRef, useState, type ReactNode } from 'react';
import {
  ActionIcon,
  Autocomplete,
  Box,
  Button,
  Group,
  Menu,
  NumberInput,
  Select,
  Stack,
  Switch,
  Text,
  TextInput,
} from '@mattstack/app-kit/core';
import { useSchemeColors } from '@mattstack/app-kit/hooks';
import { Icons } from '@mattstack/app-kit/icons';
import type { SchemaIssue } from '@mattstack/settings-kit/shapes';

import {
  enumWidth,
  INPUT_TYPE,
  numberWidth,
  SWITCH_SIZE,
} from './controlStyles';
import {
  addableFields,
  branchSeed,
  extraKeys,
  slugOf,
  visibleFields,
  type FieldSpec,
  type FormShape,
  type UnionSpec,
} from './formShape';
import { shortIssue } from './issues';
import { BLOCK_STYLE } from './JsonBlock';
import { useSuggestions } from './suggestions';
import { useInheritedValue } from './useConsoleSettings';

type Entry = Record<string, unknown>;

const NAME_W = 168;
const MESSAGE_W = 176;
const REMOVE_W = 24;
const ROW_H = 38;

/** Controlled; the number input keeps its raw text so a half-typed "-"
    survives until it parses. */
function FieldInput({
  label,
  spec,
  value,
  disabled,
  error,
  options,
  onChange,
  onTouch,
}: {
  label: string;
  spec: FieldSpec;
  value: unknown;
  disabled: boolean;
  error: boolean;
  /** Labels for an enum's values, where the values alone read poorly. */
  options?: { value: string; label: string }[];
  onChange: (v: unknown) => void;
  onTouch: () => void;
}) {
  const [raw, setRaw] = useState<string | number>(
    typeof value === 'number' ? value : ''
  );
  const inherited = useInheritedValue(spec.inherits);
  const suggested = useSuggestions(spec.suggest);
  const placeholder = spec.inherits
    ? `inherits ${inherited ?? spec.inherits}`
    : spec.placeholder;
  const suggestions = spec.suggestions ?? suggested ?? undefined;
  if (spec.type === 'boolean') {
    const checked = value === true;
    return (
      <Switch
        aria-label={label}
        size="sm"
        style={SWITCH_SIZE}
        // Mantine's own off-track colour (dark-5) is the same hex as
        // --tk-raised in dark scheme, so an off switch on a card reads as a
        // bare thumb with no visible track. Overridden only off/enabled --
        // checked keeps Mantine's own filled colour, disabled keeps
        // Mantine's own disabled styling (see CardAction for the same
        // reasoning).
        styles={
          !checked && !disabled
            ? { track: { '--switch-bg': 'var(--tk-border)' } }
            : undefined
        }
        disabled={disabled}
        error={error}
        checked={checked}
        onChange={e => {
          onTouch();
          onChange(e.currentTarget.checked);
        }}
      />
    );
  }
  if (typeof spec.type === 'object')
    return (
      <Select
        aria-label={label}
        size="xs"
        w={enumWidth(options?.map(o => o.label) ?? spec.type.enum)}
        styles={INPUT_TYPE.label}
        disabled={disabled}
        error={error}
        data={options ?? [...spec.type.enum]}
        value={typeof value === 'string' ? value : null}
        allowDeselect={false}
        onChange={v => {
          if (v !== null) {
            onTouch();
            onChange(v);
          }
        }}
        onBlur={onTouch}
      />
    );
  if (spec.type === 'number')
    return (
      <NumberInput
        aria-label={label}
        size="xs"
        w={numberWidth(value)}
        styles={INPUT_TYPE.number}
        placeholder={placeholder}
        hideControls
        disabled={disabled}
        error={error}
        value={raw}
        onChange={v => {
          onTouch();
          setRaw(v);
          if (typeof v === 'number') onChange(v);
          else if (v === '') onChange(undefined);
        }}
        onBlur={onTouch}
      />
    );
  const text = typeof value === 'string' ? value : '';
  const change = (v: string) => {
    onTouch();
    onChange(v === '' ? undefined : v);
  };
  return suggestions ? (
    <Autocomplete
      aria-label={label}
      size="xs"
      w="100%"
      styles={INPUT_TYPE.code}
      placeholder={placeholder}
      disabled={disabled}
      error={error}
      data={suggestions}
      value={text}
      onChange={change}
      onBlur={onTouch}
    />
  ) : (
    <TextInput
      aria-label={label}
      size="xs"
      w="100%"
      styles={INPUT_TYPE.code}
      placeholder={placeholder}
      disabled={disabled}
      error={error}
      value={text}
      onTextChange={change}
      onBlur={onTouch}
    />
  );
}

/** One row of the shared grid: a fixed name column, an input column that
    fills the rest, a fixed message column and a fixed remove slot, all at
    one height so a message or a missing remove control never shifts a
    neighbouring row. */
function Row({
  name,
  message,
  remove,
  children,
  testId,
}: {
  name: ReactNode;
  message?: ReactNode;
  remove?: ReactNode;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <Group gap={12} wrap="nowrap" h={ROW_H} align="center" data-testid={testId}>
      <Box style={{ flex: `0 0 ${NAME_W}px`, minWidth: 0 }}>{name}</Box>
      <Box style={{ flex: 1, minWidth: 0 }}>{children}</Box>
      <Box style={{ flex: `0 0 ${MESSAGE_W}px`, minWidth: 0 }}>{message}</Box>
      <Box style={{ flex: `0 0 ${REMOVE_W}px` }}>{remove}</Box>
    </Group>
  );
}

function FieldName({ label, hint }: { label: string; hint?: string }) {
  return (
    <Text fz={12} ff="monospace" c="var(--tk-text-1)" truncate title={hint}>
      {label}
    </Text>
  );
}

/** A field's message slot: its issue, else a note when its value is not in
    the server's suggestion list (a CODEOWNERS section rt has not seen). */
function FieldMessage({
  issue,
  spec,
  name,
  value,
}: {
  issue: SchemaIssue | undefined;
  spec?: FieldSpec;
  name: string;
  value: unknown;
}) {
  const known = useSuggestions(spec?.suggest);
  if (issue)
    return (
      <Text fz={12} c="var(--tk-text-bad-small)" truncate title={issue.message}>
        {shortIssue(issue)}
      </Text>
    );
  if (
    known &&
    typeof value === 'string' &&
    value !== '' &&
    !known.includes(value)
  ) {
    const what = (spec?.title ?? name).toLowerCase();
    return (
      <Text
        fz={12}
        c="var(--tk-text-3)"
        truncate
        title={`rt has not seen this ${what} yet`}
      >
        {`not a known ${what}`}
      </Text>
    );
  }
  return null;
}

/** A tagged union property: its tag as a picker, then the chosen branch's
    fields indented under it. Picking another tag starts that branch fresh,
    since one branch's fields mean nothing in another. */
function UnionRows({
  name,
  spec,
  value,
  disabled,
  issues,
  showIssues,
  remove,
  onChange,
  onTouch,
}: {
  name: string;
  spec: UnionSpec;
  value: unknown;
  disabled: boolean;
  issues: SchemaIssue[];
  showIssues: boolean;
  remove?: ReactNode;
  onChange: (next: Entry) => void;
  onTouch: () => void;
}) {
  const current: Entry =
    typeof value === 'object' && value !== null && !Array.isArray(value)
      ? (value as Entry)
      : {};
  const tagValue = current[spec.tag];
  const branch = spec.branches.find(b => b.value === tagValue);
  const issueAt = (field: string) =>
    showIssues
      ? issues.find(i => i.path[0] === name && i.path[1] === field)
      : undefined;
  // A missing union reports at the property itself.
  const tagIssue =
    issueAt(spec.tag) ??
    (showIssues
      ? issues.find(i => i.path.length === 1 && i.path[0] === name)
      : undefined);
  const setField = (field: string, v: unknown) => {
    const next: Entry = {};
    for (const [k, x] of Object.entries({ ...current, [field]: v }))
      if (x !== undefined) next[k] = x;
    onChange(next);
  };
  return (
    <>
      <Row
        testId={`field-row-${name}`}
        name={<FieldName label={spec.title ?? name} hint={spec.description} />}
        message={<FieldMessage issue={tagIssue} name={name} value={tagValue} />}
        remove={remove}
      >
        <FieldInput
          label={name}
          spec={{ type: { enum: spec.branches.map(b => b.value) } }}
          options={spec.branches.map(b => ({
            value: b.value,
            label: b.title ?? b.value,
          }))}
          value={tagValue}
          disabled={disabled}
          error={tagIssue !== undefined}
          onChange={v => {
            const next = spec.branches.find(b => b.value === v);
            if (next) onChange(branchSeed(spec, next));
          }}
          onTouch={onTouch}
        />
      </Row>
      {branch &&
        Object.entries(branch.fields).map(([field, fieldSpec]) => (
          <Row
            key={`${branch.value}.${field}`}
            testId={`field-row-${name}.${field}`}
            name={
              <Box pl={12}>
                <FieldName
                  label={fieldSpec.title ?? field}
                  hint={fieldSpec.description}
                />
              </Box>
            }
            message={
              <FieldMessage
                issue={issueAt(field)}
                spec={fieldSpec}
                name={field}
                value={current[field]}
              />
            }
          >
            <FieldInput
              label={`${name} ${field}`}
              spec={fieldSpec}
              value={current[field]}
              disabled={disabled}
              error={issueAt(field) !== undefined}
              onChange={v => setField(field, v)}
              onTouch={onTouch}
            />
          </Row>
        ))}
    </>
  );
}

/** One object's fields: required first, then set or added optional ones,
    an Add property menu, and read-only rows for properties the form does
    not draw (kept as they are on save). */
export function FieldGrid({
  shape,
  entry,
  onChange,
  disabled,
  issues,
  touched,
  onTouch,
  isNew = false,
  taken = [],
}: {
  shape: FormShape;
  entry: Entry;
  onChange: (next: Entry) => void;
  disabled: boolean;
  issues: SchemaIssue[];
  touched: ReadonlySet<string>;
  onTouch: (name: string) => void;
  /** An entry added in this draft: a `slugFrom` field follows its source
      until edited. A stored entry's slug is a stable id and never moves. */
  isNew?: boolean;
  /** Other entries' values of the shape's `uniqueBy` field, so a derived
      slug never collides. */
  taken?: readonly string[];
}) {
  const { text } = useSchemeColors();
  // Seeded from what's already set, so clearing a stored optional field's
  // text (undefined round-trips through here too) never drops its row --
  // only the remove control below does that.
  const [shown, setShown] = useState<string[]>(() =>
    Object.keys(entry).filter(
      k =>
        (k in shape.fields || k in shape.unions) && !shape.required.includes(k)
    )
  );
  // The written object's key order, seeded from the entry's own order and
  // extended (once) the first time a new name is set, so clearing and
  // retyping a field returns it to its original position instead of the end.
  const order = useRef<string[]>(Object.keys(entry));
  const set = (name: string, v: unknown) => {
    const patch: Entry = { [name]: v };
    if (isNew)
      for (const [target, f] of Object.entries(shape.fields))
        if (f.slugFrom === name && !touched.has(target))
          patch[target] =
            typeof v === 'string' && v !== '' ? slugOf(v, taken) : undefined;
    for (const k of Object.keys(patch))
      if (!order.current.includes(k)) order.current = [...order.current, k];
    // A key present in the entry but missing from order.current (a stale
    // instance sharing state across an entry swap it never remounted for)
    // would otherwise drop that key on this write.
    const keys = [
      ...order.current,
      ...Object.keys(entry).filter(k => !order.current.includes(k)),
    ];
    const next: Entry = {};
    for (const k of keys) {
      const value = k in patch ? patch[k] : entry[k];
      if (value !== undefined) next[k] = value;
    }
    onChange(next);
  };
  const drop = (name: string) => {
    setShown(s => s.filter(n => n !== name));
    set(name, undefined);
  };
  const issueFor = (name: string) => issues.find(i => i.path[0] === name);
  const addable = addableFields(shape, entry, shown);
  const extras = extraKeys(shape, entry);

  return (
    <Stack gap={0}>
      {visibleFields(shape, entry, shown).map(name => {
        const union = shape.unions[name];
        if (union)
          return (
            <UnionRows
              key={name}
              name={name}
              spec={union}
              value={entry[name]}
              disabled={disabled}
              issues={issues}
              showIssues={touched.has(name)}
              remove={
                !shape.required.includes(name) && (
                  <ActionIcon
                    variant="subtle"
                    color="gray"
                    c={text.muted}
                    size="sm"
                    aria-label={`remove ${name}`}
                    disabled={disabled}
                    onClick={() => drop(name)}
                  >
                    <Icons.close size={14} />
                  </ActionIcon>
                )
              }
              onChange={v => set(name, v)}
              onTouch={() => onTouch(name)}
            />
          );
        const spec = shape.fields[name]!;
        const required = shape.required.includes(name);
        const issue = issueFor(name);
        const showIssue = touched.has(name) && issue !== undefined;
        return (
          <Row
            key={name}
            testId={`field-row-${name}`}
            name={
              <Text
                fz={12}
                ff="monospace"
                c="var(--tk-text-1)"
                truncate
                title={spec.description}
              >
                {spec.title ?? name}
              </Text>
            }
            message={
              <FieldMessage
                issue={showIssue ? issue : undefined}
                spec={spec}
                name={name}
                value={entry[name]}
              />
            }
            remove={
              !required && (
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  c={text.muted}
                  size="sm"
                  aria-label={`remove ${name}`}
                  disabled={disabled}
                  onClick={() => drop(name)}
                >
                  <Icons.close size={14} />
                </ActionIcon>
              )
            }
          >
            <FieldInput
              label={name}
              spec={spec}
              value={entry[name]}
              disabled={disabled}
              error={showIssue}
              onChange={v => set(name, v)}
              onTouch={() => onTouch(name)}
            />
          </Row>
        );
      })}
      {extras.length > 0 && (
        <Box style={{ borderTop: '1px solid var(--tk-line-2)' }} mt={4} pt={4}>
          {extras.map(name => {
            const raw = JSON.stringify(entry[name]);
            return (
              <Row
                key={name}
                name={
                  <Text fz={12} ff="monospace" c={text.muted} truncate>
                    {name}
                  </Text>
                }
                message={
                  <Text fz={12} c={text.muted} truncate>
                    kept on save · edit in JSON
                  </Text>
                }
              >
                <Box
                  style={{
                    ...BLOCK_STYLE,
                    fontFamily: 'var(--mantine-font-family-monospace)',
                    color: 'var(--tk-text-3)',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    padding: '4px 8px',
                    borderRadius: 4,
                  }}
                  title={raw}
                >
                  {raw}
                </Box>
              </Row>
            );
          })}
        </Box>
      )}
      {addable.length > 0 && (
        <Group py={4}>
          <Menu position="bottom-start" withinPortal>
            <Menu.Target>
              <Button
                size="compact-xs"
                variant="subtle"
                disabled={disabled}
                leftSection={<Icons.plus size={12} />}
              >
                Add property
              </Button>
            </Menu.Target>
            <Menu.Dropdown>
              {addable.map(name => (
                <Menu.Item
                  key={name}
                  onClick={() => setShown(s => [...s, name])}
                >
                  {(shape.fields[name] ?? shape.unions[name])?.title ?? name}
                </Menu.Item>
              ))}
            </Menu.Dropdown>
          </Menu>
        </Group>
      )}
    </Stack>
  );
}
