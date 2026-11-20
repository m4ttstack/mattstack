import { OpenAPIHono } from "@hono/zod-openapi";
import { hc } from "hono/client";
import { z } from "zod";
import { FailureEnvelopeSchema } from "./envelopes.ts";
import * as R from "./routes.ts";
import type { DaemonRoute } from "./routes.ts";
import { SHARED_RESPONSES, sharedResponsesFor, type SharedResponsesFor } from "./shared-responses.ts";

type SharedResponseEntries<T extends DaemonRoute> = {
  [K in SharedResponsesFor<T> as (typeof SHARED_RESPONSES)[K]["status"]]: {
    description: string;
    content: { "application/json": { schema: (typeof SHARED_RESPONSES)[K]["schema"] } };
  };
};

type ContractRoute<T extends DaemonRoute> = {
  method: T["method"];
  path: T["path"];
  request: {
    query: T["request"] extends { query: infer Q extends z.ZodType } ? Q : undefined;
    params: T["request"] extends { params: infer P extends z.ZodType } ? P : undefined;
    body: T["request"] extends { body: infer B extends z.ZodType }
      ? { content: { "application/json": { schema: B } } }
      : undefined;
  };
  // A handler that refuses or throws also answers 200, so callers must narrow on `ok`.
  responses: {
    200: {
      description: string;
      content: { "application/json": { schema: z.ZodUnion<[T["success"], typeof FailureEnvelopeSchema]> } };
    };
  } & SharedResponseEntries<T>;
};

function contract<T extends DaemonRoute>(route: T): ContractRoute<T> {
  return {
    method: route.method,
    path: route.path,
    request: {
      query: route.request.query,
      params: route.request.params,
      body: route.request.body ? { content: { "application/json": { schema: route.request.body } } } : undefined,
    },
    responses: {
      200: {
        description: route.summary,
        content: { "application/json": { schema: z.union([route.success, FailureEnvelopeSchema]) } },
      },
      ...Object.fromEntries(
        sharedResponsesFor(route).map((name) => {
          const shared = SHARED_RESPONSES[name];
          return [shared.status, { description: shared.description, content: { "application/json": { schema: shared.schema } } }];
        }),
      ),
    },
  } as ContractRoute<T>;
}

const contractOnly = (): never => {
  throw new Error("the daemon contract app serves types only");
};

/** Exists for its type: the daemon serves the routes, this app never runs. */
export function contractApp() {
  return new OpenAPIHono()
    .openapi(contract(R.statusGetRoute), contractOnly)
    .openapi(contract(R.portsListRoute), contractOnly)
    .openapi(contract(R.cacheListRoute), contractOnly)
    .openapi(contract(R.cacheGetRoute), contractOnly)
    .openapi(contract(R.reposListRoute), contractOnly)
    .openapi(contract(R.processesListRoute), contractOnly)
    .openapi(contract(R.notificationsDrainRoute), contractOnly)
    .openapi(contract(R.cacheRefreshRoute), contractOnly)
    .openapi(contract(R.hooksRepairRoute), contractOnly)
    .openapi(contract(R.daemonShutdownRoute), contractOnly)
    .openapi(contract(R.sdmRecentsRoute), contractOnly)
    .openapi(contract(R.sdmReconnectRoute), contractOnly)
    .openapi(contract(R.eventsEmitRoute), contractOnly)
    .openapi(contract(R.eventsListRoute), contractOnly)
    .openapi(contract(R.secretsReadRoute), contractOnly)
    .openapi(contract(R.runsListRoute), contractOnly)
    .openapi(contract(R.runsGetRoute), contractOnly)
    .openapi(contract(R.usageMrsRoute), contractOnly)
    .openapi(contract(R.usageMrRoute), contractOnly)
    .openapi(contract(R.usageRunRoute), contractOnly)
    .openapi(contract(R.usageTrendsRoute), contractOnly)
    .openapi(contract(R.usageStatusRoute), contractOnly)
    .openapi(contract(R.reconcilerStatusRoute), contractOnly)
    .openapi(contract(R.reconcilerClearRoute), contractOnly);
}

export type DaemonAppType = ReturnType<typeof contractApp>;

export function createDaemonClient(baseUrl: string, init?: { token?: string; client?: string }) {
  const headers: Record<string, string> = {};
  if (init?.token) headers["X-RT-Token"] = init.token;
  if (init?.client) headers["X-RT-Client"] = init.client;
  return hc<DaemonAppType>(baseUrl, { headers });
}
