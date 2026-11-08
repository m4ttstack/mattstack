import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Group,
  Highlight,
  Modal,
  Pill,
  PillsInput,
  Select,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { agentState, paneLocation, stateLine } from './agent-state';
import { HandleAvatar } from './AgentName';
import { useBuddies } from './buddies-context';
import { displayName } from './display-name';
import { doing } from './doing';
import classes from './new-slack-chat.module.css';
import type { RosterBuddy } from './roster-types';
import { supportChatLabel } from './slack-chats-context';
import { StateDot } from './StateDot';

/** What `/api/chat/slack-people` lists: the Slack user id, and the id and
    version `/api/chat/slack-avatar` takes when the person has a picture. */
export interface SlackPerson {
  name: string;
  person: string;
  title?: string;
  avatarId?: string;
  avatarVersion?: string;
}

const RESULTS_SHOWN = 6;
const FACE_SIZE = 22;
const AGENT_FACE = 38;
const CHIP_FACE = 22;

/** The person's Slack picture, or the app's own face for a handle when
    there is none or it won't load. */
export function PersonFace({
  person,
  size = FACE_SIZE,
  className,
}: {
  person: SlackPerson;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const photo =
    person.avatarId && !failed
      ? `/api/chat/slack-avatar/${person.avatarId}?v=${person.avatarVersion ?? ''}`
      : undefined;
  return (
    <span
      className={className ? `${classes.face} ${className}` : classes.face}
      style={{ width: size, height: size }}
    >
      {photo ? (
        <img
          src={photo}
          alt=""
          className={classes.photo}
          data-testid="person-photo"
          onError={() => setFailed(true)}
        />
      ) : (
        <HandleAvatar handle={person.person} variant="inline" size={size} />
      )}
    </span>
  );
}

function matching(people: SlackPerson[], query: string): SlackPerson[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  return people
    .filter(p => p.name.toLowerCase().includes(wanted))
    .slice(0, RESULTS_SHOWN);
}

/** One signed-in agent in the picker: the same face, state, task and place
    the roster's card shows, so the choice reads without opening the card. */
function AgentOption({ buddy, now }: { buddy: RosterBuddy; now: number }) {
  const task = doing(buddy, now);
  const taskText =
    task && task.kind !== 'path' && task.kind !== 'signed-out'
      ? task.text
      : undefined;
  const where =
    paneLocation(buddy) ??
    ([buddy.repo, buddy.branch].filter(Boolean).join(' / ') || undefined);
  return (
    <div className={classes.agent}>
      <HandleAvatar handle={buddy.handle} variant="inline" size={AGENT_FACE} />
      <div className={classes.agentText}>
        <div className={classes.agentHead}>
          <span title={stateLine(buddy, now)} className={classes.agentState}>
            <StateDot state={agentState(buddy)} size="sm" />
          </span>
          <Text
            component="span"
            size="md"
            fw={600}
            className={classes.agentName}
          >
            {displayName(buddy)}
          </Text>
          {where && (
            <Text
              component="span"
              size="xs"
              c="dimmed"
              className={classes.name}
            >
              {where}
            </Text>
          )}
        </div>
        {taskText && (
          <Text size="sm" className={classes.name}>
            {taskText}
          </Text>
        )}
      </div>
    </div>
  );
}

async function errorOf(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    if (body.error) return body.error;
  } catch {
    // The status line says enough.
  }
  return `The server answered ${res.status}`;
}

/** Starts a support chat with a teammate. The server reads the repo from
    settings and sends no requester, so the daemon's notices go to the
    operator. `onStarted` gets the new chat's room, null when the daemon
    could not name it yet. */
export function NewSlackChatDialog({
  opened,
  onClose,
  onStarted,
}: {
  opened: boolean;
  onClose: () => void;
  onStarted: (room: string | null) => void;
}) {
  const [people, setPeople] = useState<SlackPerson[]>();
  const [persona, setPersona] = useState<string>();
  const [loadError, setLoadError] = useState<string>();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<SlackPerson>();
  const [active, setActive] = useState(0);
  const [brief, setBrief] = useState('');
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<string>();
  const [notify, setNotify] = useState<string | null>(null);
  const buddies = useBuddies();
  const liveAgents = useMemo(
    () =>
      [...(buddies?.byHandle.values() ?? [])]
        .filter(b => b.signedOutAt === undefined && b.status !== 'offline')
        .sort((a, b) => displayName(a).localeCompare(displayName(b))),
    [buddies]
  );
  const agents = liveAgents.map(b => ({
    value: b.handle,
    label: displayName(b),
  }));
  const chosen = notify ? buddies?.byHandle.get(notify) : undefined;
  const now = buddies?.now ?? Date.now();

  useEffect(() => {
    if (!opened) return;
    setQuery('');
    setPicked(undefined);
    setBrief('');
    setNotify(null);
    setStartError(undefined);
    let cancelled = false;
    fetch('/api/chat/slack-people')
      .then(async res => {
        if (!res.ok) throw new Error(await errorOf(res));
        return (await res.json()) as {
          people: SlackPerson[];
          persona?: string;
        };
      })
      .then(data => {
        if (cancelled) return;
        setPeople(data.people);
        setPersona(data.persona);
        setLoadError(undefined);
      })
      .catch(err => {
        if (cancelled) return;
        setLoadError(
          err instanceof Error ? err.message : 'No answer from the server'
        );
      });
    return () => {
      cancelled = true;
    };
  }, [opened]);

  const results = useMemo(
    () => (picked ? [] : matching(people ?? [], query)),
    [people, query, picked]
  );
  const searching = !picked && query.trim() !== '';
  const canStart = picked !== undefined && brief.trim() !== '' && !starting;

  const pick = (person: SlackPerson) => {
    setPicked(person);
    setQuery(person.name);
  };

  const start = async () => {
    if (!picked || !canStart) return;
    setStarting(true);
    setStartError(undefined);
    try {
      const res = await fetch('/api/chat/slack-start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          person: picked.person,
          brief: brief.trim(),
          ...(notify ? { notify } : {}),
        }),
      });
      if (!res.ok) throw new Error(await errorOf(res));
      const data = (await res.json()) as { room?: string | null };
      onStarted(data.room ?? null);
      onClose();
    } catch (err) {
      setStartError(
        err instanceof Error ? err.message : 'No answer from the server'
      );
    } finally {
      setStarting(false);
    }
  };

  const name = persona ?? 'The agent';

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!starting) onClose();
      }}
      title={supportChatLabel(persona)}
      size={520}
      styles={{ content: { overflow: 'visible' } }}
    >
      <Stack gap="xxl">
        <Text size="md" className={classes.lede}>
          Let {name} chat with a teammate to provide support or gather info on
          bugs or feature requests for mattstack. Messages are sent under your
          Slack account with a prefix.
        </Text>
        <Stack gap={6} className={classes.search}>
          {picked ? (
            <PillsInput label="Recipient">
              <Pill.Group>
                <Pill
                  size="lg"
                  withRemoveButton
                  onRemove={() => {
                    setPicked(undefined);
                    setQuery('');
                    setActive(0);
                  }}
                  className={classes.chip}
                >
                  <span className={classes.chipBody}>
                    <PersonFace
                      person={picked}
                      size={CHIP_FACE}
                      className={classes.chipFace}
                    />
                    {picked.name}
                  </span>
                </Pill>
              </Pill.Group>
            </PillsInput>
          ) : (
            <TextInput
              label="Recipient"
              placeholder="Search teammates"
              value={query}
              leftSection={<Icon name="search" size={16} />}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck={false}
              data-1p-ignore
              data-lpignore="true"
              data-form-type="other"
              data-autofocus
              onChange={event => {
                setQuery(event.currentTarget.value);
                setActive(0);
              }}
              onKeyDown={event => {
                if (event.key === 'ArrowDown') {
                  event.preventDefault();
                  setActive(i => Math.min(i + 1, results.length - 1));
                } else if (event.key === 'ArrowUp') {
                  event.preventDefault();
                  setActive(i => Math.max(i - 1, 0));
                } else if (event.key === 'Enter' && results[active]) {
                  event.preventDefault();
                  pick(results[active]);
                }
              }}
            />
          )}
          {loadError && (
            <Text size="sm" c="bad" role="alert">
              {loadError}
            </Text>
          )}
          {searching && people === undefined && !loadError && (
            <Text size="sm" c="dimmed">
              Loading teammates
            </Text>
          )}
          {searching && people !== undefined && results.length === 0 && (
            <Text size="sm" c="dimmed">
              No one matches
            </Text>
          )}
          {results.length > 0 && (
            <div
              className={classes.results}
              role="listbox"
              aria-label="Teammates"
              data-testid="person-results"
            >
              {results.map((person, i) => (
                <UnstyledButton
                  key={person.person}
                  role="option"
                  aria-selected={i === active}
                  className={classes.result}
                  data-active={i === active || undefined}
                  onClick={() => pick(person)}
                >
                  <PersonFace person={person} />
                  <Highlight
                    component="span"
                    size="lg"
                    fw={500}
                    highlight={query.trim()}
                    className={classes.name}
                  >
                    {person.name}
                  </Highlight>
                  {person.title && (
                    <Text
                      component="span"
                      size="sm"
                      c="dimmed"
                      className={classes.name}
                    >
                      {person.title}
                    </Text>
                  )}
                </UnstyledButton>
              ))}
            </div>
          )}
        </Stack>
        <Textarea
          label="Brief"
          placeholder={`What should ${persona ?? 'the agent'} help with?`}
          rows={4}
          value={brief}
          onChange={event => setBrief(event.currentTarget.value)}
        />
        {chosen ? (
          <PillsInput label="Keep an agent posted">
            <Pill.Group>
              <Pill
                size="lg"
                withRemoveButton
                onRemove={() => setNotify(null)}
                className={classes.chip}
              >
                <span className={classes.chipBody}>
                  <span className={classes.chipFace}>
                    <HandleAvatar
                      handle={chosen.handle}
                      variant="inline"
                      size={CHIP_FACE}
                    />
                  </span>
                  {displayName(chosen)}
                </span>
              </Pill>
            </Pill.Group>
          </PillsInput>
        ) : (
          <Select
            label="Keep an agent posted"
            placeholder="Updates go to your desk"
            data={agents}
            value={notify}
            onChange={setNotify}
            searchable
            nothingFoundMessage="No agents signed in"
            maxDropdownHeight={320}
            classNames={{
              dropdown: classes.agentDropdown,
              option: classes.agentOption,
            }}
            renderOption={({ option }) => {
              const buddy = buddies?.byHandle.get(option.value);
              return buddy ? (
                <AgentOption buddy={buddy} now={now} />
              ) : (
                option.label
              );
            }}
          />
        )}
        <Group className={classes.footer} wrap="nowrap">
          <Text
            size="sm"
            c={startError ? 'bad' : 'dimmed'}
            className={classes.hint}
            role={startError ? 'alert' : undefined}
          >
            {startError}
          </Text>
          <Button variant="default" disabled={starting} onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!canStart} loading={starting} onClick={start}>
            Start
          </Button>
        </Group>
      </Stack>
    </Modal>
  );
}
