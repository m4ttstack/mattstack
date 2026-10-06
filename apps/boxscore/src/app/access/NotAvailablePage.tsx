import { AccessNotice } from './AccessNotice';

export function NotAvailablePage({ own }: { own: string }) {
  return (
    <AccessNotice
      icon="eyeOff"
      title="This page isn't available to you"
      body="You can see only your own page in boxscore. Ask your team owner for Team view."
      href={`/user/${encodeURIComponent(own)}`}
      buttonIcon="arrowLeft"
      buttonLabel="Your page"
    />
  );
}
