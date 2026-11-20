import { z } from "zod";

export function okData<T extends z.ZodType>(data: T) {
  return z.object({ ok: z.literal(true), data });
}

export function okFlat<T extends z.ZodRawShape>(shape: T) {
  return z.object({ ok: z.literal(true), ...shape });
}

export const FailureEnvelopeSchema = z
  .object({
    ok: z.literal(false),
    error: z.string(),
    failure: z.object({ code: z.string(), message: z.string() }).optional().describe("Set on a 500 only."),
  })
  .describe("A refused or failed request. A handler's own refusal answers 200 with this body.");

export const UnauthorizedSchema = z.object({ ok: z.literal(false), error: z.literal("unauthorized") });

export const NotFoundSchema = z.object({
  ok: z.literal(false),
  error: z.literal("not found"),
  docs: z.string().describe("The daemon's index URL."),
});

export const MethodNotAllowedSchema = z.object({
  ok: z.literal(false),
  error: z.string().regex(/^use (GET|POST)$/).describe("`use <METHOD>`, naming the method the route takes."),
});

export const MalformedPathSchema = z.object({ ok: z.literal(false), error: z.literal("malformed path parameter") });

export const TooLargeSchema = z.object({
  ok: z.literal(false),
  error: z
    .string()
    .regex(/^request body over the \d+ MiB limit for \S+$/)
    .describe("`request body over the <n> MiB limit for <command>`."),
});
