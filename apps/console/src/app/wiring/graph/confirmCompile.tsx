import { Text } from '@mattstack/app-kit/core';
import { Icon } from '@mattstack/app-kit/icons';
import { modals } from '@mattstack/app-kit/modals';
import { useQueryClient } from '@tanstack/react-query';

import { guardedWrite, reportCompile, useSkillsCompile } from '../useWiring';
import { ConfirmTitle, MUTED, packConfirmFrame } from './packConfirm';

function what(skills: number): string {
  if (skills === 0) return 'the pack from its sources';
  if (skills === 1) return '1 skill from its sources';
  return `${skills} skills from their sources`;
}

/** Asks before a compile, in the same frame as Publish's confirm, then runs
    it under the pack's write lock and reports it; `onStart` follows a
    confirmed start, as a tab switch. */
export function useConfirmCompile(pack: string, onStart?: () => void) {
  const queryClient = useQueryClient();
  const compile = useSkillsCompile(pack);
  return (skills: number) =>
    modals.confirm({
      title: <ConfirmTitle>Compile Skill Pack?</ConfirmTitle>,
      message: (
        <Text fz={13} lh="normal" c={MUTED} data-parity="body">
          Rebuilds {what(skills)}. The result waits as unsynced changes to
          publish.
        </Text>
      ),
      ...packConfirmFrame({
        confirm: 'Compile',
        color: 'warn',
        icon: <Icon name="fileCog" size={13} />,
      }),
      onConfirm: () =>
        guardedWrite(queryClient, pack, () => {
          void reportCompile(pack, compile.mutateAsync());
          onStart?.();
        }),
    });
}
