import { useState } from 'react';

import { Button, Tooltip } from '@mattstack/tui-kit';
import { CommandButton } from '../CommandButton.tsx';
import {
  commandKey,
  showDevLinkPrompt,
  versionCell,
  type Row,
} from '../logic.ts';
import type { BlockProps } from './block.ts';
import { Help } from './Help.tsx';
import { SourceLinkInput } from './SourceLinkInput.tsx';

const DEPLOYED_TIP =
  'Left is the commit running now. Right is the newest commit in the linked checkout.';
const RELINK_TIP = 'Point deck at a different checkout of this app.';
const UNLINK_TIP =
  'Serve from the installed bundle instead of source. Build and deploy disappear until you relink.';

const COMMAND_ORDER = ['deploy', 'build'];

function linkFooter(row: Row): string {
  if (row.devLink === 'broken')
    return 'the linked directory is missing or its manifest is invalid, relink to fix';
  return 'link a source checkout to get build/deploy here and source serving in dev mode';
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
  const linked = row.devLink === 'linked';
  const showCommands =
    row.enabled !== false && !showDevLinkPrompt(row, data.canManage);
  const commands = showCommands ? orderedCommands(row) : [];
  const canLink = blocks.relink;

  return (
    <section data-block="code" aria-label="Code" className="settings-block">
      <div className="settings-block-head">
        <h3 className="settings-heading">Code</h3>
        {linked && (
          <p className="settings-note">
            Serves from its linked checkout while deck is in dev mode.
          </p>
        )}
      </div>
      {linked || !canLink ? (
        <dl className="settings-facts">
          <dt>Source</dt>
          <dd>
            {linked ? (
              <span className="settings-mono" title={row.devDir ?? undefined}>
                {row.devDir ? homeRelative(row.devDir) : 'linked'}
              </span>
            ) : row.devLink === 'broken' ? (
              <span className="t-bad">broken</span>
            ) : (
              'not linked'
            )}
          </dd>
          <Deployed row={row} />
        </dl>
      ) : (
        <div className="settings-link">
          <SourceLinkInput row={row} board={board} done={() => {}} />
          <p className="settings-note">{linkFooter(row)}</p>
        </div>
      )}
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
