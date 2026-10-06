import { useLinks } from '../shell/useLinks';
import { AccessNotice } from './AccessNotice';

export function LockedPage() {
  const { console: consoleUrl } = useLinks();
  return (
    <AccessNotice
      icon="userX"
      title="boxscore couldn't tell who you are"
      body="Check that your GitLab token is set and that your GitLab username is on the team roster in console."
      href={`${consoleUrl.replace(/\/$/, '')}/settings#boxscore`}
      external
      buttonIcon="settings"
      buttonLabel="Open console"
    />
  );
}
