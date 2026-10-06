import { usePersonHref } from '../preview/preview';
import { AccessNotice } from './AccessNotice';

export function NotAvailablePage({ own }: { own: string }) {
  const personHref = usePersonHref();
  return (
    <AccessNotice
      icon="eyeOff"
      title="This page isn't available to you"
      body="You can see only your own page in boxscore. Ask your team owner for Team view."
      href={personHref(own)}
      buttonIcon="arrowLeft"
      buttonLabel="Your page"
    />
  );
}
