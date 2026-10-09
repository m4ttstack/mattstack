import { Button, Icon, Tooltip } from '@mattstack/tui-kit';
import { CIRCLE_ARROW_UP, ROCKET } from './icons.ts';
import {
  behindRows,
  redeployingText,
  updateStripText,
  type RedeployAllRun,
  type Row,
} from './logic.ts';

/** The head of the mattstack section's panel: how many apps have new code
    since their last deploy, and the Redeploy all button. Renders nothing
    when none do. The button is hidden where the server refuses deploys. */
export function UpdateStrip({
  rows,
  canManage,
  run,
  onRedeployAll,
}: {
  rows: Row[];
  canManage: boolean;
  run: RedeployAllRun | null;
  onRedeployAll: () => void;
}) {
  const count = behindRows(rows).length;
  if (count === 0 && !run) return null;
  return (
    <div data-block="update-strip" className="update-strip">
      <Icon d={CIRCLE_ARROW_UP} className="update-strip-icon" />
      <span className="update-strip-text">
        {run ? redeployingText(run) : updateStripText(count)}
      </span>
      {canManage && (
        <Tooltip tip="Runs deploy for every app with new code.">
          <Button
            variant="filled"
            intent="warn"
            size="sm"
            busy={run != null}
            onClick={onRedeployAll}
          >
            {run == null && <Icon d={ROCKET} />}
            {run ? 'Redeploying…' : 'Redeploy all'}
          </Button>
        </Tooltip>
      )}
    </div>
  );
}
