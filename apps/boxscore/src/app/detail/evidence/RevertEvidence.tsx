import { useState } from 'react';

import { formatNumber } from '../../../shared/metrics';
import type { EvidenceRow } from '../../../shared/types';
import { dayLabel } from '../../model/labels';
import { Glyph } from '../../ui/Glyph';
import classes from './evidence.module.css';
import type { EvidenceProps } from './index';
import panels from './panels.module.css';
import { EmptyEvidence, EvHead, MrId } from './parts';

function RevertBadge({ by, lived }: { by: string; lived: string }) {
  return (
    <span
      className={`${classes.badge} ${panels.revBadge}`}
      data-parity="Rev Badge"
      style={{ background: 'var(--mantine-color-bad-light)' }}
    >
      <Glyph
        name="undo2"
        size={12}
        color="var(--tk-text-bad-small)"
        parity="undo"
      />
      <span
        className={`${classes.t} ${classes.badgeText}`}
        data-parity="b"
        style={{ color: 'var(--tk-text-bad-small)' }}
      >
        {`reverted by ${by} after ${lived}`}
      </span>
    </span>
  );
}

function RevertRow({ row }: { row: EvidenceRow }) {
  const [id = '', title, , by = '', lived = ''] = row.cells;
  return (
    <div
      className={`${classes.band} ${panels.revertRow}`}
      data-parity={`Revert ${id}`}
    >
      <MrId id={id} href={row.href} />
      <span className={`${classes.t} ${panels.rowTitle}`} data-parity="t">
        {title}
      </span>
      <RevertBadge by={by} lived={lived} />
    </div>
  );
}

function ZeroState({ checked }: { checked: number }) {
  return (
    <div className={panels.zeroState} data-parity="Zero State">
      <span
        className={panels.okBadge}
        data-parity="Ok Badge"
        style={{ background: 'var(--mantine-color-ok-light)' }}
      >
        <Glyph
          name="check"
          size={20}
          color="var(--tk-text-ok)"
          parity="check"
        />
      </span>
      <span className={`${classes.t} ${panels.zeroTitle}`} data-parity="zt">
        {`No reverts across ${formatNumber(checked)} merged MRs`}
      </span>
      <span className={`${classes.t} ${panels.zeroSub}`} data-parity="zs">
        A reverted MR shows here with the MR that reverted it and how long it
        lived.
      </span>
    </div>
  );
}

function CheckedRow({ row }: { row: EvidenceRow }) {
  const [id = '', title, day] = row.cells;
  return (
    <div className={`${classes.band} ${panels.row}`} data-parity={`Chk ${id}`}>
      <MrId id={id} href={row.href} />
      <span className={`${classes.t} ${panels.rowTitle}`} data-parity="t">
        {title}
      </span>
      <span
        className={`${classes.t} ${classes.num} ${panels.mergedOn}`}
        data-parity="dt"
      >
        {day ? dayLabel(day) : ''}
      </span>
    </div>
  );
}

export function RevertEvidence({ ev }: EvidenceProps) {
  const [open, setOpen] = useState(false);
  if (ev.rows.length === 0) return <EmptyEvidence />;
  const checked = ev.facts?.checked ?? ev.rows.length;
  const reverted = ev.rows.filter(r => !r.muted);
  return (
    <>
      {reverted.length === 0 ? (
        <>
          <ZeroState checked={checked} />
          <EvHead title="When there is one" right="example row" />
          <div
            className={`${classes.band} ${panels.revertRow} ${panels.example}`}
            data-parity="Revert Example"
            aria-hidden
          >
            <span
              className={`${classes.t} ${classes.num} ${classes.id} ${classes.idCol}`}
              data-parity="id"
            >
              !45xxx
            </span>
            <span
              className={`${classes.t} ${panels.rowTitle} ${panels.exampleTitle}`}
              data-parity="t"
            >
              Title of the reverted MR
            </span>
            <RevertBadge by="!45yyy" lived="2d" />
          </div>
        </>
      ) : (
        <>
          <EvHead title="Reverted MRs" right="newest first" />
          {reverted.map(row => (
            <RevertRow key={row.cells[0]} row={row} />
          ))}
        </>
      )}
      {open && (
        <>
          <EvHead title="Checked MRs" right="newest first" />
          {ev.rows.map(row => (
            <CheckedRow key={row.cells[0]} row={row} />
          ))}
        </>
      )}
      <div className={classes.evFooter} data-parity="Ev Footer">
        <span className={`${classes.t} ${classes.count}`} data-parity="c">
          {`${formatNumber(checked)} merged MRs checked`}
        </span>
        <button
          type="button"
          className={classes.showAll}
          onClick={() => setOpen(!open)}
        >
          <span
            className={`${classes.t} ${classes.showAllLabel}`}
            data-parity="sa"
          >
            {open ? 'Hide checked MRs' : 'Show checked MRs'}
          </span>
        </button>
      </div>
    </>
  );
}
