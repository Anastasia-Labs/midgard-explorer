import { Schema } from "effect";

export const HealthzResponse = Schema.Struct({
  status: Schema.Literal("ok"),
  now: Schema.String,
});
export type HealthzResponse = Schema.Schema.Type<typeof HealthzResponse>;

export const decodeHealthz = Schema.decodeUnknownSync(HealthzResponse);
