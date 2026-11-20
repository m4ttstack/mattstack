import type { Server } from "bun";
import { startApiServer, type ApiServerDeps } from "../api-server.ts";

/**
 * Starts the API server on a port the OS assigns at bind time; read it back
 * from `server.port`. Probing for a free port and binding it again leaves a
 * gap another process can take, and Mac CI runners share localhost.
 */
export async function startEphemeralApiServer(deps: ApiServerDeps): Promise<Server<any>> {
  const previous = process.env.RT_API_PORT;
  process.env.RT_API_PORT = "0";
  try {
    return await startApiServer(deps);
  } finally {
    if (previous === undefined) delete process.env.RT_API_PORT;
    else process.env.RT_API_PORT = previous;
  }
}
