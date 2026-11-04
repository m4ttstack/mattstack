import { createRealAgeKeySeam } from "../home/age-key.ts";
import { createRealSecretsExecSeam, readSecret, type SecretsSeams } from "../secrets/store.ts";
import { createSlackClient, type SlackClient } from "./client.ts";

let seams: SecretsSeams | undefined;

/** Null when the machine has no Slack token. The token is read each time so a rotation needs no daemon restart. */
export async function slackClientFromSecrets(): Promise<SlackClient | null> {
  seams ??= { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() };
  const token = await readSecret("board", "slackToken", seams);
  return token ? createSlackClient(token) : null;
}
