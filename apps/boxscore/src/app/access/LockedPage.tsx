import { useForgeText } from '../forge/forge';
import { useLinks } from '../shell/useLinks';
import { AccessNotice } from './AccessNotice';

export function LockedPage() {
  const { console: consoleUrl } = useLinks();
  const t = useForgeText();
  return (
    <AccessNotice
      icon="userX"
      title="boxscore couldn't tell who you are"
      body={t(
        'Check that your GitLab token is set and that your GitLab username is on the team roster in console.'
      )}
      href={`${consoleUrl.replace(/\/$/, '')}/settings#boxscore`}
      external
      buttonIcon="settings"
      buttonLabel="Open console"
    />
  );
}
