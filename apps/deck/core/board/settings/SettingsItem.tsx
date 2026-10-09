import { Children, type ReactNode } from 'react';

import { Icon } from '@mattstack/tui-kit';

/** `children` render under the label and note, out to the row's end. */
export function SettingsItem({
  icon,
  label,
  note,
  end,
  children,
}: {
  icon: string;
  label: ReactNode;
  note?: ReactNode;
  end?: ReactNode;
  children?: ReactNode;
}) {
  const body = Children.toArray(children);
  return (
    <li className="settings-item">
      <span className="settings-item-icon" aria-hidden="true">
        <Icon d={icon} width="16" height="16" />
      </span>
      <span className="settings-item-text">
        <span className="settings-toggle-label">{label}</span>
        {note && <span className="settings-note">{note}</span>}
      </span>
      {end && <span className="settings-item-end">{end}</span>}
      {body.length > 0 && <div className="settings-item-body">{body}</div>}
    </li>
  );
}
