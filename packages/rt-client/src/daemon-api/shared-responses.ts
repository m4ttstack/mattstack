import {
  FailureEnvelopeSchema,
  MalformedPathSchema,
  MethodNotAllowedSchema,
  NotFoundSchema,
  TooLargeSchema,
  UnauthorizedSchema,
} from "./envelopes.ts";
import type { DaemonRoute } from "./routes.ts";

export const SHARED_RESPONSES = {
  MalformedPath: { status: 400, schema: MalformedPathSchema, description: "A path parameter is not valid %-encoding." },
  Unauthorized: { status: 401, schema: UnauthorizedSchema, description: "`X-RT-Token` is missing or wrong." },
  NotFound: { status: 404, schema: NotFoundSchema, description: "No route has this path." },
  MethodNotAllowed: { status: 405, schema: MethodNotAllowedSchema, description: "The route takes another method." },
  TooLarge: { status: 413, schema: TooLargeSchema, description: "The request body is over the command's size limit." },
  Failure: { status: 500, schema: FailureEnvelopeSchema, description: "The REST layer threw; a handler's own throw answers 200 with this body." },
} as const;

export type SharedResponse = keyof typeof SHARED_RESPONSES;

export function sharedResponsesFor(route: DaemonRoute): SharedResponse[] {
  const out: SharedResponse[] = [];
  if (route.request.params) out.push("MalformedPath");
  if (route.token) out.push("Unauthorized");
  if (route.shapeNotFound) out.push("NotFound");
  if (route.kind === "generic") out.push("MethodNotAllowed");
  if (route.kind === "generic" && route.method === "post") out.push("TooLarge");
  out.push("Failure");
  return out;
}

/** `sharedResponsesFor` at the type level; the two must name the same responses. */
export type SharedResponsesFor<T extends DaemonRoute> =
  | (T["request"] extends { params: object } ? "MalformedPath" : never)
  | (T["token"] extends true ? "Unauthorized" : never)
  | (T extends { shapeNotFound: true } ? "NotFound" : never)
  | (T["kind"] extends "generic" ? "MethodNotAllowed" : never)
  | (T extends { kind: "generic"; method: "post" } ? "TooLarge" : never)
  | "Failure";
