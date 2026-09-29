import { getApiToken, tokenOk } from "../api-auth.ts";
import { createRealSecretsExecSeam, type SecretsSeams } from "../../secrets/store.ts";
import { createRealAgeKeySeam } from "../../home/age-key.ts";
import { getLogin, secretsBackend, type DevLogin } from "../../logins/store.ts";
import { parsePlaceholder } from "../../logins/origin.ts";
import { AttemptLimiter, loginFingerprint } from "../../logins/attempt-limit.ts";
import type { Commands } from "../../../packages/rt-client/src/commands.ts";
import type { CommandResult, HandlerContext } from "./types.ts";

let seamsSingleton: SecretsSeams | null = null;
function defaultSeams(): SecretsSeams {
  return seamsSingleton ??= { ageKeySeam: createRealAgeKeySeam(), execSeam: createRealSecretsExecSeam() };
}

export interface LoginsHandlerOverrides {
  apiToken?: () => string;
  readLogin?: (key: string) => Promise<DevLogin | null>;
  limiter?: AttemptLimiter;
}

export function createLoginsHandlers(
  ctx: Pick<HandlerContext, "log">,
  overrides: LoginsHandlerOverrides = {},
): { "logins:fill": (payload: unknown) => Promise<CommandResult<"logins:fill">> } {
  const apiToken = overrides.apiToken ?? (() => getApiToken());
  // A store failure (a corrupt entry, a missing age key) throws to the
  // daemon's command seam, which answers ok:false with the error's message;
  // none of those messages carry a stored value.
  const readLogin = overrides.readLogin ?? ((key: string) => getLogin(secretsBackend(defaultSeams()), key));
  const limiter = overrides.limiter ?? new AttemptLimiter();

  return {
    "logins:fill": async (raw: unknown) => {
      const p = (raw ?? {}) as Commands["logins:fill"]["payload"];
      if (!p.token) return { ok: false as const, error: "missing-token" };
      if (!tokenOk(p.token, apiToken())) return { ok: false as const, error: "bad-token" };
      const parsed = typeof p.name === "string" ? parsePlaceholder(p.name) : null;
      if (!parsed || typeof p.frameOrigin !== "string" || (p.elementKind !== "password" && p.elementKind !== "text")) {
        return { ok: false as const, error: "bad-payload" };
      }
      // The daemon cannot see who is on the other end of its socket; the
      // caller's own claim is logged and labelled as such.
      const caller = { client: typeof p.client === "string" ? p.client : null, pid: typeof p.pid === "number" ? p.pid : null, verified: false };
      const note = (fields: Record<string, unknown>) => ctx.log.info({ name: p.name, caller, ...fields }, "logins:fill");

      const login = await readLogin(parsed.key);
      if (!login) {
        note({ refused: "unknown" });
        return { ok: true as const, data: { refused: "unknown" as const } };
      }
      const kindOk = parsed.kind !== "password" || p.elementKind === "password";
      if (p.frameOrigin !== login.origin || !kindOk) {
        note({ origin: login.origin, frameOrigin: p.frameOrigin, elementKind: p.elementKind, refused: "mismatch" });
        return { ok: true as const, data: { refused: "mismatch" as const } };
      }
      if (parsed.kind === "password") {
        const grant = limiter.take(parsed.key, loginFingerprint(login));
        if (!grant.ok) {
          note({ origin: login.origin, refused: "limited", until: grant.until });
          return { ok: true as const, data: { refused: "limited" as const, until: grant.until } };
        }
      }
      note({ origin: login.origin, released: parsed.kind });
      return {
        ok: true as const,
        data: { origin: login.origin, kind: parsed.kind, value: parsed.kind === "email" ? login.email : login.password },
      };
    },
  };
}
