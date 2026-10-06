import { Button } from '@mattstack/app-kit/core';
import type { IconName } from '@mattstack/app-kit/icons';
import { Link } from '@mattstack/app-kit/router';
import { Glyph } from '../ui/Glyph';
import classes from './access.module.css';

/** The centred message both access pages share: icon, title, body and one
    link-button. `external` links leave the app, so they skip the router. */
export function AccessNotice({
  icon,
  title,
  body,
  href,
  external = false,
  buttonIcon,
  buttonLabel,
}: {
  icon: IconName;
  title: string;
  body: string;
  href: string;
  external?: boolean;
  buttonIcon: IconName;
  buttonLabel: string;
}) {
  const leftSection = (
    <Glyph
      name={buttonIcon}
      size={16}
      color="currentColor"
      parity="NA Button Icon"
    />
  );
  const label = <span data-parity="NA Button Label">{buttonLabel}</span>;
  return (
    <div className={classes.root} data-parity="Not Available">
      <Glyph name={icon} size={40} color="var(--tk-text-3)" parity="NA Icon" />
      <h2 className={classes.title} data-parity="NA Title">
        {title}
      </h2>
      <p className={classes.body} data-parity="NA Body">
        {body}
      </p>
      {external ? (
        <Button
          component="a"
          href={href}
          radius={6}
          data-parity="NA Button"
          leftSection={leftSection}
        >
          {label}
        </Button>
      ) : (
        <Button
          component={Link}
          href={href}
          radius={6}
          data-parity="NA Button"
          leftSection={leftSection}
        >
          {label}
        </Button>
      )}
    </div>
  );
}
