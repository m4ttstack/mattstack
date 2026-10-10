import { useState } from 'react';

import { Button, Icon } from '@mattstack/tui-kit';
import { CommandButton } from '../CommandButton.tsx';
import { GIT_BRANCH, RADIO, SQUARE } from '../icons.ts';
import {
  commandKey,
  showDevLinkPrompt,
  versionCell,
  type Row,
} from '../logic.ts';
import { Tooltip } from '../Tooltip.tsx';
import type { BlockProps } from './block.ts';
import { Help } from './Help.tsx';
import { SourceLinkInput } from './SourceLinkInput.tsx';

const DEPLOYED_TIP = 'Running commit, then the newest one';
const RELINK_TIP = 'Use a different checkout';
const UNLINK_TIP = 'Serve the installed bundle instead';

const COMMAND_ORDER = ['deploy', 'build'];

function linkFooter(row: Row): string {
  if (row.devLink === 'broken')
    return 'The linked directory is missing or its manifest is invalid. Relink to fix.';
  return 'Link a source checkout to get build and deploy here, and source serving in dev mode.';
}

/** The modal's close button is where focus lands if the opener is gone once
    the live modal closes (a successful Stop Live removes it). */
function openLiveFromSettings(
  row: Row,
  board: BlockProps['board'],
  opener: HTMLElement
) {
  const dialog = opener.closest('[role="dialog"]');
  board.openLive(row, opener, {
    mode: 'live',
    fallback: () =>
      dialog?.querySelector<HTMLElement>('[data-part="modal-close"]') ?? null,
  });
}

function homeRelative(path: string): string {
  return path.replace(/^\/(?:Users|home)\/[^/]+(?=\/)/, '~');
}

/** Redeploy leads, then Build, then any other manifest command in its own
    order. */
function orderedCommands(row: Row): string[] {
  const names = row.commands ?? [];
  return [
    ...COMMAND_ORDER.filter(n => names.includes(n)),
    ...names.filter(n => !COMMAND_ORDER.includes(n)),
  ];
}

function Deployed({ row }: { row: Row }) {
  const cell = versionCell(row);
  if (cell.kind === 'untracked') return null;
  return (
    <>
      <dt>
        Deployed <Help tip={DEPLOYED_TIP} />
      </dt>
      <dd className="settings-deployed">
        {cell.kind === 'behind' ? (
          <>
            <span className="settings-mono">{cell.deployed}</span>
            <span className="t-warn" aria-hidden="true">
              →
            </span>
            <span className="settings-mono t-warn">{cell.head}</span>
            <span className="t-warn">new code in source</span>
          </>
        ) : (
          'current'
        )}
      </dd>
    </>
  );
}

/** A managed row's linked checkout: where it serves from, what is deployed,
    the manifest's commands, and relink or unlink. Commands follow the
    table's own gates; relink and unlink need canManage. */
export function CodeBlock({ row, data, board, blocks }: BlockProps) {
  const [relinking, setRelinking] = useState(false);
  if (!blocks.code) return null;
  if (row.live) {
    return (
      <section data-block="code" aria-label="Code" className="settings-block">
        <div className="settings-block-head">
          <h3 className="settings-heading">Code</h3>
          <p className="settings-note">Live. It reloads as you edit.</p>
        </div>
        <dl className="settings-facts">
          <dt>Source</dt>
          <dd className="settings-live-source">
            <Icon d={RADIO} className="t-accent" />
            {!row.live.main && <Icon d={GIT_BRANCH} />}
            <span className="settings-mono">
              {row.live.main ? 'main' : row.live.branch}
            </span>
          </dd>
        </dl>
        <div className="settings-actions">
          <Button
            onClick={e => openLiveFromSettings(row, board, e.currentTarget)}
          >
            <Icon d={GIT_BRANCH} /> Change code
          </Button>
          <span className="settings-actions-end">
            <Button
              variant="subtle"
              intent="bad"
              onClick={e => openLiveFromSettings(row, board, e.currentTarget)}
            >
              <Icon d={SQUARE} />
              Stop Live
            </Button>
          </span>
        </div>
      </section>
    );
  }
  const linked = row.devLink === 'linked';
  const showCommands =
    row.enabled !== false && !showDevLinkPrompt(row, data.canManage);
  const commands = showCommands ? orderedCommands(row) : [];
  const canLink = blocks.relink;

  return (
    <section data-block="code" aria-label="Code" className="settings-block">
      <div className="settings-block-head">
        <h3 className="settings-heading">Code</h3>
        {linked ? (
          <p className="settings-note">
            Serves from its linked checkout while deck is in dev mode.
          </p>
        ) : (
          canLink && <p className="settings-note">{linkFooter(row)}</p>
        )}
      </div>
      <dl className="settings-facts">
        <dt>Source</dt>
        <dd>
          {linked ? (
            <span className="settings-mono" title={row.devDir ?? undefined}>
              {row.devDir ? homeRelative(row.devDir) : 'linked'}
            </span>
          ) : canLink ? (
            <SourceLinkInput row={row} board={board} />
          ) : row.devLink === 'broken' ? (
            <span className="t-bad">broken</span>
          ) : (
            'not linked'
          )}
        </dd>
        <Deployed row={row} />
      </dl>
      {(commands.length > 0 || (canLink && linked)) && (
        <div className="settings-actions">
          {commands.map(name => (
            <CommandButton
              key={name}
              row={row}
              name={name}
              phase={board.commandRuns[commandKey(row.name, name)]}
              onRunCommand={board.onRunCommand}
              labeled
            />
          ))}
          {canLink && linked && (
            <span className="settings-actions-end">
              <Tooltip tip={RELINK_TIP}>
                <Button
                  variant="subtle"
                  aria-expanded={relinking}
                  onClick={() => setRelinking(v => !v)}
                >
                  relink
                </Button>
              </Tooltip>
              <Tooltip tip={UNLINK_TIP}>
                <Button
                  variant="subtle"
                  intent="bad"
                  onClick={() => board.onUnlink(row)}
                >
                  unlink
                </Button>
              </Tooltip>
            </span>
          )}
        </div>
      )}
      {canLink && linked && relinking && (
        <SourceLinkInput
          row={row}
          board={board}
          done={() => setRelinking(false)}
          autoFocus
        />
      )}
    </section>
  );
}
