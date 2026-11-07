import { createRealAgeKeySeam } from "../home/age-key.ts";
import { createRealSecretsExecSeam, readSecret, type SecretsSeams } from "../secrets/store.ts";

export const SUPPORT_KEY_NAME = "rt.linearSupportApiKey";

let seams: SecretsSeams | null = null;

/** Null when the key was never stored; a store that cannot be read throws. */
export async function readSupportApiKey(): Promise<string | null> {
  seams ??= { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() };
  return readSecret("rt", "linearSupportApiKey", seams);
}
