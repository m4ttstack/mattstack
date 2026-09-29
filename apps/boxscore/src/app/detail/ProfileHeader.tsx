import { Menu } from '@mattstack/app-kit/core';
import { Link } from '@mattstack/app-kit/router';
import type { MetricKey, UserRow } from '../../shared/types';
import { statHref } from '../leaderboard/StandingsTable';
import { initials } from '../model/labels';
import { Glyph } from '../ui/Glyph';
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
  const parity = `Step ${glyphParity}`;
  const glyph = (
    <Glyph
      name={icon}
      size={15}
      color="var(--tk-text-2)"
      parity={glyphParity}
    />
  );
  if (!to) {
    return (
      <button
        type="button"
        className={classes.step}
        data-parity={parity}
        aria-label={label}
        disabled
      >
        {glyph}
      </button>
    );
  }
  return (
    <Link
      href={statHref(to.username, stat)}
      className={classes.step}
      data-parity={parity}
      aria-label={label}
    >
      {glyph}
    </Link>
  );
}

export function ProfileHeader({
  person,
  people,
  stat,
  meta,
}: {
  person: UserRow;
  people: UserRow[];
  stat: MetricKey;
  meta: string;
}) {
  const name = displayName(person);
  const at = people.findIndex(u => u.username === person.username);
  const you = person.isCurrentUser;
  return (
    <>
      <Link href="/" className={classes.backLink}>
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
      <div className={classes.profileHeader}>
        <div className={classes.profile}>
          <span
            className={classes.avatar}
            data-parity="Avatar"
            style={{
              background: you ? 'var(--tk-fill-accent)' : 'var(--tk-raised)',
            }}
          >
            <span
              className={`${classes.t} ${classes.initials}`}
              data-parity="Initials"
              style={{
                color: you ? 'var(--tk-on-fill-accent)' : 'var(--tk-text-2)',
              }}
            >
              {initials(name)}
            </span>
          </span>
          <div className={classes.profileText}>
            <div className={classes.nameLine}>
              <h1 className={`${classes.t} ${classes.name}`} data-parity="Name">
                {name}
              </h1>
              {you && (
                <span className={classes.youBadge} data-parity="You Badge">
                  <span
                    className={`${classes.t} ${classes.you}`}
                    data-parity="You"
                  >
                    you
                  </span>
                </span>
              )}
            </div>
            <span className={`${classes.t} ${classes.meta}`} data-parity="Meta">
              {meta}
            </span>
          </div>
        </div>
        <div className={classes.switcher}>
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
                  href={statHref(u.username, stat)}
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
      </div>
    </>
  );
}
