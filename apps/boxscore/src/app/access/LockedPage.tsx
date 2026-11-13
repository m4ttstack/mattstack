import { useForgeText } from '../forge/forge';
import { useLinks } from '../shell/useLinks';
import { AccessNotice } from './AccessNotice';
import { LOCKED_BODY } from './copy';

export function LockedPage() {
  const { console: consoleUrl } = useLinks();
  const t = useForgeText();
  return (
    <AccessNotice
      icon="userX"
      title="boxscore couldn't tell who you are"
      body={t(LOCKED_BODY)}
      href={`${consoleUrl.replace(/\/$/, '')}/settings#boxscore`}
      external
      buttonIcon="settings"
      buttonLabel="Open console"
    />
  );
}
