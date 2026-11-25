import type { Ref } from 'react';
import { X } from 'lucide-react';

import { Button, Tooltip } from '@mattstack/tui-kit';
import { partLabel, TEXT_MAX, whoAnswers } from './support-model.ts';
import type { Help } from './use-support.ts';

/** What you need, what goes with it, and who answers. */
export function HelpForm({
  help,
  host,
  inputRef,
  onClose,
}: {
  help: Help;
  host: string;
  inputRef: Ref<HTMLTextAreaElement>;
  onClose: () => void;
}) {
  const { read, text, parts, mr } = help;
  const a = read.availability;
  const away = a.state === 'ready' && a.away;
  const nobody = a.state === 'hidden';
  const ready = parts !== null && text.trim() !== '' && !nobody;
  return (
    <form
      className="tui-help-card"
      data-face="form"
      onSubmit={e => {
        e.preventDefault();
        help.send();
      }}
    >
      <div className="tui-help-head">
        <h2 className="tui-help-title">Ask {read.persona}</h2>
        <button
          type="button"
          className="tui-help-x"
          aria-label="Close"
          onClick={onClose}
        >
          <X size={15} aria-hidden />
        </button>
      </div>
      <p className="tui-help-who">
        <span
          className="tui-help-dot"
          data-tone={nobody ? 'bad' : away ? 'wait' : 'ok'}
          aria-hidden
        />
        {whoAnswers(host, a)}
      </p>
      <textarea
        ref={inputRef}
        className="tui-help-input"
        data-mr={mr ? '' : undefined}
        aria-label="What do you need help with?"
        placeholder="What do you need help with?"
        maxLength={TEXT_MAX}
        value={text}
        onChange={e => help.setText(e.target.value)}
        onKeyDown={e => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            help.send();
          }
        }}
      />
      {help.partsFailed ? (
        <p className="tui-help-note" role="alert">
          rt did not say what would be sent
          <button
            type="button"
            className="tui-help-link"
            onClick={help.loadParts}
          >
            Try again
          </button>
        </p>
      ) : (
        (parts === null || parts.length > 0) && (
          <div className="tui-help-parts">
            <p className="tui-help-parts-label">Sent with it</p>
            <ul className="tui-help-chips" aria-busy={parts === null}>
              {(parts ?? []).map(part => {
                const label = partLabel(part, mr);
                return (
                  <li key={part.key} className="tui-help-chip">
                    <Tooltip tip={part.value} className="tui-help-chip-tip">
                      <span className="tui-help-chip-text">{label}</span>
                    </Tooltip>
                    <button
                      type="button"
                      aria-label={`Leave out ${label}`}
                      onClick={() => help.removePart(part.key)}
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </li>
                );
              })}
            </ul>
          </div>
        )
      )}
      {away && (
        <p className="tui-help-away">Your request will wait up to 7 days</p>
      )}
      <div className="tui-help-foot">
        <span>Goes through mattstack's relay</span>
        <Button
          type="submit"
          variant="filled"
          className="tui-help-send"
          disabled={!ready}
          busy={help.sending}
        >
          Ask {read.persona}
        </Button>
      </div>
    </form>
  );
}
