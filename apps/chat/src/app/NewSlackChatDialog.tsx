import { useEffect, useMemo, useState } from 'react';
import {
  Button,
  Group,
  Modal,
  Stack,
  Text,
  Textarea,
  TextInput,
  UnstyledButton,
} from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { HandleAvatar } from './AgentName';
import classes from './new-slack-chat.module.css';

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

/** The person's Slack picture, or the app's own face for a handle when
    there is none or it won't load. */
export function PersonFace({ person }: { person: SlackPerson }) {
  const [failed, setFailed] = useState(false);
  const photo =
    person.avatarId && !failed
      ? `/api/chat/slack-avatar/${person.avatarId}?v=${person.avatarVersion ?? ''}`
      : undefined;
  return (
    <span
      className={classes.face}
      style={{ width: FACE_SIZE, height: FACE_SIZE }}
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
        <HandleAvatar
          handle={person.person}
          variant="inline"
          size={FACE_SIZE}
        />
      )}
    </span>
  );
}

function matching(people: SlackPerson[], query: string): SlackPerson[] {
  const wanted = query.trim().toLowerCase();
  if (!wanted) return [];
  return people
    .filter(
      p =>
        p.name.toLowerCase().includes(wanted) ||
        p.title?.toLowerCase().includes(wanted)
    )
    .slice(0, RESULTS_SHOWN);
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

  useEffect(() => {
    if (!opened) return;
    setQuery('');
    setPicked(undefined);
    setBrief('');
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
        body: JSON.stringify({ person: picked.person, brief: brief.trim() }),
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

  const hint = startError
    ? startError
    : picked === undefined
      ? 'Pick a person to start'
      : brief.trim() === ''
        ? 'Add a brief to start'
        : undefined;

  return (
    <Modal
      opened={opened}
      onClose={() => {
        if (!starting) onClose();
      }}
      title="New Slack chat"
      size={480}
      centered
    >
      <Stack gap="md">
        <Stack gap={6}>
          <TextInput
            label="Person"
            placeholder="Search teammates"
            value={query}
            leftSection={<Icon name="search" size={16} />}
            data-autofocus
            onChange={event => {
              setQuery(event.currentTarget.value);
              setPicked(undefined);
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
                  <Text
                    component="span"
                    size="lg"
                    fw={500}
                    className={classes.name}
                  >
                    {person.name}
                  </Text>
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
        <Group className={classes.footer} wrap="nowrap">
          <Text
            size="sm"
            c={startError ? 'bad' : 'dimmed'}
            className={classes.hint}
            role={startError ? 'alert' : undefined}
          >
            {hint}
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
