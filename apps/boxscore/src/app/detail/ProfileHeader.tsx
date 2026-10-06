import { ActionIcon, Avatar, Button, Menu } from '@mattstack/app-kit/core';
import { Link } from '@mattstack/app-kit/router';
import type { MetricKey, UserRow } from '../../shared/types';
import { initials } from '../model/labels';
import { previewHref, usePersonHref } from '../preview/preview';
import { Glyph } from '../ui/Glyph';
import { YouBadge } from '../ui/YouBadge';
import classes from './detail.module.css';

export const displayName = (u: UserRow): string => u.name ?? u.username;

function Step({
  label,
  icon,
  glyphParity,
  to,
  stat,
}: {
  label: string;
  icon: 'chevronLeft' | 'chevronRight';
  glyphParity: string;
  to: UserRow | undefined;
  stat: MetricKey;
}) {
  const personHref = usePersonHref();
  const parity = `Step ${glyphParity}`;
  const glyph = (
    <Glyph name={icon} size={15} color="currentColor" parity={glyphParity} />
  );
  if (!to) {
    return (
      <ActionIcon
        variant="default"
        size={32}
        data-parity={parity}
        aria-label={label}
        disabled
      >
        {glyph}
      </ActionIcon>
    );
  }
  return (
    <ActionIcon
      component={Link}
      href={personHref(to.username, stat)}
      variant="default"
      size={32}
      data-parity={parity}
      aria-label={label}
    >
      {glyph}
    </ActionIcon>
  );
}

export function ProfileHeader({
  person,
  people,
  stat,
  meta,
  self = false,
  canPreview = false,
}: {
  person: UserRow;
  people: UserRow[];
  stat: MetricKey;
  meta: string;
  self?: boolean;
  canPreview?: boolean;
}) {
  const personHref = usePersonHref();
  const name = displayName(person);
  const at = people.findIndex(u => u.username === person.username);
  const you = person.isCurrentUser;
  return (
    <>
      {!self && (
        <Link href="/" className={classes.backLink} data-parity="Back Link">
          <Glyph
            name="arrowLeft"
            size={14}
            color="var(--tk-text-accent)"
            parity="Back Icon"
          />
          <span
            className={`${classes.t} ${classes.backLabel}`}
            data-parity="Back Label"
          >
            Leaderboard
          </span>
        </Link>
      )}
      <div className={classes.profileHeader} data-parity="Profile Header">
        <div className={classes.profile}>
          <Avatar
            size={56}
            color={you ? 'accent' : undefined}
            variant={you ? 'filled' : 'default'}
            data-parity="Avatar"
          >
            <span data-parity="Initials">{initials(name)}</span>
          </Avatar>
          <div className={classes.profileText}>
            <div className={classes.nameLine}>
              <h1 className={`${classes.t} ${classes.name}`} data-parity="Name">
                {name}
              </h1>
              {you && <YouBadge />}
            </div>
            <span className={`${classes.t} ${classes.meta}`} data-parity="Meta">
              {meta}
            </span>
          </div>
        </div>
        {!self && (
          <div className={classes.switcher}>
            {canPreview && (
              <Button
                component={Link}
                href={previewHref(person.username)}
                variant="default"
                size="compact-sm"
                data-parity="Preview Button"
                leftSection={
                  <Glyph
                    name="eye"
                    size={14}
                    color="currentColor"
                    parity="Preview Icon"
                  />
                }
              >
                <span data-parity="Preview Label">Preview Self view</span>
              </Button>
            )}
            <Step
              label="Previous person"
              icon="chevronLeft"
              glyphParity="chevron-left"
              to={people[at - 1]}
              stat={stat}
            />
            <Menu position="bottom-end" width={220}>
              <Menu.Target>
                <button
                  type="button"
                  className={classes.personSelect}
                  data-parity="Person Select"
                  aria-label={`Choose a person, showing ${name}`}
                >
                  <span
                    className={`${classes.t} ${classes.selLabel}`}
                    data-parity="Sel Label"
                  >
                    {`${at + 1} of ${people.length} · ${name}`}
                  </span>
                  <Glyph
                    name="chevronsUpDown"
                    size={13}
                    color="var(--tk-text-3)"
                    parity="Caret"
                  />
                </button>
              </Menu.Target>
              <Menu.Dropdown>
                {people.map(u => (
                  <Menu.Item
                    key={u.username}
                    component={Link}
                    href={personHref(u.username, stat)}
                    aria-current={
                      u.username === person.username ? 'page' : undefined
                    }
                  >
                    {displayName(u)}
                  </Menu.Item>
                ))}
              </Menu.Dropdown>
            </Menu>
            <Step
              label="Next person"
              icon="chevronRight"
              glyphParity="chevron-right"
              to={people[at + 1]}
              stat={stat}
            />
          </div>
        )}
      </div>
    </>
  );
}
