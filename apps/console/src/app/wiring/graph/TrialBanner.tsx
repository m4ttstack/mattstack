import { Alert, Code, CopyButton, Group, Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';

import { usePackTrial } from '../useWiring';
import classes from './graph.module.css';

/**
 * Says the pack's org copy is on a trial branch, where nothing reaches the
 * team, with the command that goes back. The console offers no Publish here.
 */
export function TrialBanner({
  pack,
  ...spacing
}: {
  pack: string;
  m?: number;
  mb?: number;
}) {
  const trial = usePackTrial(pack);
  if (!trial) return null;
  const back = `rt team branch use ${trial.dataBranch ?? '<data branch>'}`;
  return (
    <Alert
      variant="light"
      color="purple"
      icon={<Icon name="gitBranch" size={16} />}
      title={`Trial branch ${trial.branch}`}
      classNames={{ root: classes.trialBanner }}
      data-testid="trial-banner"
      {...spacing}
    >
      <Text fz={13} lh="normal">
        Changes stay on this Mac and never reach your team. Publishing is off.
      </Text>
      <Group gap={8} mt={6} wrap="nowrap">
        <Text fz={13} lh="normal">
          Go back with
        </Text>
        <Code data-testid="trial-back">{back}</Code>
        {trial.dataBranch && (
          <CopyButton value={back} size="compact-xs" variant="default">
            Copy
          </CopyButton>
        )}
      </Group>
    </Alert>
  );
}
