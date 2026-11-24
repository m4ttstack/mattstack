import { useRef, type ReactElement } from 'react';

import {
  CircleCheck,
  CircleX,
  Clock3,
  LifeBuoy,
  LoaderCircle,
  Moon,
  X,
} from 'lucide-react';

import { Button, Popover, Tooltip } from '@mattstack/tui-kit';
import { HelpForm } from './HelpForm.tsx';
import {
  firstName,
  hostOf,
  isOpen,
  pill,
  requestCard,
  sendErrorCard,
  type Card,
  type CardIcon,
  type Pill,
} from './support-model.ts';
import type { Help } from './use-support.ts';

const CARD_ICON: Record<CardIcon, typeof X> = {
  spin: LoaderCircle,
  check: CircleCheck,
  clock: Clock3,
  moon: Moon,
  x: CircleX,
};

function PillMark({ pill: p }: { pill: Pill }) {
  if (p.tone === 'work')
    return <LoaderCircle className="tui-help-spin" size={16} aria-hidden />;
  if (p.tone !== 'rest')
    return <span className="tui-help-dot" data-tone={p.tone} aria-hidden />;
  return <LifeBuoy size={16} aria-hidden />;
}

/** One card for every state of a request, and for a send that was refused. */
export function StatusCard({
  card,
  words,
  host,
  hostDm,
  onClose,
  onAskAgain,
  onTryAgain,
  onShowIt,
  onFollow,
}: {
  card: Card;
  words: string;
  host: string;
  hostDm: string | null;
  onClose: () => void;
  onAskAgain?: () => void;
  onTryAgain?: () => void;
  onShowIt?: () => void;
  /** A link out of the card was followed. */
  onFollow?: () => void;
}) {
  const Mark = CARD_ICON[card.icon];
  return (
    <div className="tui-help-card" data-face="status">
      <div className="tui-help-status">
        <Mark
          className={
            card.icon === 'spin' ? 'tui-help-mark tui-help-spin' : 'tui-help-mark'
          }
          data-tone={card.tone}
          size={18}
          aria-hidden
        />
        <div className="tui-help-status-text" role="status">
          <p className="tui-help-status-title">{card.title}</p>
          {card.detail && (
            <p className="tui-help-status-detail">{card.detail}</p>
          )}
        </div>
        <button
          type="button"
          className="tui-help-x"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <p className="tui-help-words">{words}</p>
      <CardActions
        card={card}
        host={host}
        hostDm={hostDm}
        onAskAgain={onAskAgain}
        onTryAgain={onTryAgain}
        onShowIt={onShowIt}
        onFollow={onFollow}
      />
    </div>
  );
}

function CardActions({
  card,
  host,
  hostDm,
  onAskAgain,
  onTryAgain,
  onShowIt,
  onFollow,
}: Pick<
  Parameters<typeof StatusCard>[0],
  | 'card'
  | 'host'
  | 'hostDm'
  | 'onAskAgain'
  | 'onTryAgain'
  | 'onShowIt'
  | 'onFollow'
>) {
  const action = card.action;
  if (!action) return null;
  const link = (href: string, label: string, primary: boolean) => (
    <a
      className="tui-help-act"
      data-primary={primary || undefined}
      href={href}
      target="_blank"
      rel="noreferrer"
      onClick={onFollow}
    >
      {label}
    </a>
  );
  const button = (
    label: string,
    primary: boolean,
    onClick: (() => void) | undefined
  ) => (
    <Button
      variant={primary ? 'filled' : 'default'}
      className="tui-help-act"
      data-primary={primary || undefined}
      onClick={onClick}
    >
      {label}
    </Button>
  );
  let control: ReactElement | null = null;
  switch (action.kind) {
    case 'open-slack':
      control = link(action.href, 'Open in Slack', true);
      break;
    case 'message-host':
      control = hostDm ? link(hostDm, `Message ${host}`, false) : null;
      break;
    case 'ask-again':
      control = button('Ask again', true, onAskAgain);
      break;
    case 'try-again':
      control = button('Try again', true, onTryAgain);
      break;
    case 'show-it':
      control = button('Show it', false, onShowIt);
      break;
  }
  return control && <div className="tui-help-acts">{control}</div>;
}

export function HelpButton({ help }: { help: Help }) {
  const { read, request, open, setOpen } = help;
  const first = useRef<HTMLTextAreaElement>(null);
  const a = read.availability;
  const host = request
    ? hostOf(a) || firstName(request.peer)
    : hostOf(a);
  const face = pill(request, host, read.persona);
  const disabled = !request && a.state === 'disabled' ? a.reason : null;

  const trigger = (
    <button
      type="button"
      className="tui-help"
      data-open={open || undefined}
      data-tone={face.tone}
      aria-disabled={disabled ? true : undefined}
      aria-label={disabled ? `${face.label} ${disabled}` : undefined}
    >
      <PillMark pill={face} />
      <span className="tui-help-label">{face.label}</span>
    </button>
  );

  if (disabled)
    return (
      <div className="tui-help-slot">
        <Tooltip tip={disabled}>{trigger}</Tooltip>
      </div>
    );

  if (face.href && request && !open)
    return (
      <div className="tui-help-slot">
        <a
          className="tui-help"
          data-tone={face.tone}
          href={face.href}
          target="_blank"
          rel="noreferrer"
          onClick={() => help.markSeen(request.id)}
        >
          <PillMark pill={face} />
          <span className="tui-help-label">{face.label}</span>
        </a>
      </div>
    );

  const close = () => setOpen(false);
  const body = help.error ? (
    <StatusCard
      card={sendErrorCard(help.error, host, help.requests.some(isOpen))}
      words={help.text}
      host={host}
      hostDm={read.hostDm}
      onClose={close}
      onTryAgain={help.send}
      onShowIt={help.clearError}
    />
  ) : request ? (
    <StatusCard
      card={requestCard(request, host, read.persona, help.requests)}
      words={request.text}
      host={host}
      hostDm={read.hostDm}
      onClose={close}
      onAskAgain={() => help.askAgain(request.text)}
      onShowIt={() => help.markSeen(request.id)}
      onFollow={close}
    />
  ) : (
    <HelpForm help={help} host={host} inputRef={first} onClose={close} />
  );

  return (
    <div className="tui-help-slot">
      <Popover
        open={open}
        onOpenChange={setOpen}
        side="top"
        align="end"
        sideOffset={8}
        ariaLabel={`Ask ${read.persona}`}
        initialFocus={first}
        classNames={{ root: 'tui-help-portal', popup: 'tui-help-popup' }}
        trigger={trigger}
      >
        {body}
      </Popover>
    </div>
  );
}
