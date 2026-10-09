// One manifest command button, shared by the apps table (icon only) and the
// settings modal's Code block (icon and label), so both keep the same
// aria-label, tooltip, busy phase and handler.
import { Button, Icon, Tooltip } from '@mattstack/tui-kit';
import { CIRCLE_ARROW_UP, HAMMER, ROCKET } from './icons.ts';
import { commandButtonLabel, type CommandPhase, type Row } from './logic.ts';

const BUILD_TIP =
  'Runs the build command only. The running app does not change until you redeploy.';
const REDEPLOY_TIP =
  "Runs this app's deploy command from its linked checkout, so the running app picks up the new code.";

const COMMAND_ICONS: Record<string, string> = { build: HAMMER, deploy: ROCKET };
const LABELED_ICONS: Record<string, string> = {
  build: HAMMER,
  deploy: CIRCLE_ARROW_UP,
};
const COMMAND_TITLES: Record<string, string> = {
  build: 'Build',
  deploy: 'Redeploy',
};

function commandTip(
  row: Row,
  name: string,
  phase: CommandPhase | undefined
): string {
  if (phase != null) return commandButtonLabel(name, phase);
  if (name === 'build') return BUILD_TIP;
  return row.newCode
    ? `New code since last deploy: ${row.newCode.deployed} to ${row.newCode.head}. ${REDEPLOY_TIP}`
    : REDEPLOY_TIP;
}

/** `build` and `deploy` carry an icon; any other manifest command keeps its
    text label. A busy icon-only button shows only the kit spinner, since
    Button renders the spinner beside its children. */
export function CommandButton({
  row,
  name,
  phase,
  onRunCommand,
  labeled = false,
}: {
  row: Row;
  name: string;
  phase: CommandPhase | undefined;
  onRunCommand: (row: Row, name: string) => void;
  /** The modal's form: icon plus a title, and Redeploy tinted when there is
      new code to ship. */
  labeled?: boolean;
}) {
  const icon = COMMAND_ICONS[name];
  const run = () => onRunCommand(row, name);
  const label = `${name} ${row.name}`;
  if (!icon) {
    return (
      <Button
        variant={labeled ? 'default' : 'subtle'}
        size={labeled ? 'md' : 'sm'}
        busy={phase != null}
        aria-label={label}
        onClick={run}
      >
        {commandButtonLabel(name, phase)}
      </Button>
    );
  }
  const primary = name === 'deploy' && row.newCode != null;
  if (labeled) {
    return (
      <Tooltip tip={commandTip(row, name, phase)}>
        <Button
          variant={primary ? 'outline' : 'default'}
          intent={primary ? 'warn' : 'accent'}
          busy={phase != null}
          className="command-labeled"
          aria-label={label}
          onClick={run}
        >
          {phase == null && <Icon d={LABELED_ICONS[name]!} />}
          {phase === 'restarting'
            ? commandButtonLabel(name, phase)
            : COMMAND_TITLES[name]}
        </Button>
      </Tooltip>
    );
  }
  return (
    <Tooltip tip={commandTip(row, name, phase)}>
      <Button
        variant="subtle"
        size="sm"
        iconOnly
        busy={phase != null}
        className={primary ? 't-warn' : 'row-icon'}
        aria-label={label}
        onClick={run}
      >
        {phase == null && <Icon d={icon} />}
      </Button>
    </Tooltip>
  );
}
