import { useQueryClient } from '@tanstack/react-query';

import { client } from '../../api';
import { readApiError } from '../useRuns';

/** Pause and Redo for one run, each answering null once it worked or the
    reason it did not. */
export function useModeControls(repo: string, runId: string) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['runs'] });
    await queryClient.invalidateQueries({ queryKey: ['run', repo, runId] });
    await queryClient.invalidateQueries({ queryKey: ['gates'] });
  };

  const pause = async (): Promise<string | null> => {
    try {
      const res = await client.api.runs[':repo'][':runId'].hold.$post({
        param: { repo, runId },
      });
      if (!res.ok)
        return (await readApiError(res, "couldn't pause the run")).message;
    } catch {
      return "the console server didn't answer";
    }
    await refresh();
    return null;
  };

  const redo = async (gate: string, note: string): Promise<string | null> => {
    try {
      const res = await client.api.gates[':id'].redo.$post({
        param: { id: gate },
        json: { note },
      });
      if (!res.ok)
        return (await readApiError(res, "couldn't send the run back")).message;
    } catch {
      return "the console server didn't answer";
    }
    await refresh();
    return null;
  };

  return { pause, redo };
}
