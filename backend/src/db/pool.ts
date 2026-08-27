export type BoundedPoolConfig = {
  connectionString: string;
  max: number;
  connectionTimeoutMillis: number;
  idleTimeoutMillis: number;
  statement_timeout: number;
  query_timeout: number;
  keepAlive: boolean;
  application_name: string;
  options?: string;
};

/** A public explorer must never inherit the driver's effectively unbounded
 * operational policy. These settings bound both concurrency and how long a
 * query may occupy a node connection. */
export function boundedPoolConfig(input: {
  connectionString: string;
  max: number;
  connectionTimeoutMs: number;
  idleTimeoutMs: number;
  statementTimeoutMs: number;
  applicationName: string;
  readOnly?: boolean;
}): BoundedPoolConfig {
  return {
    connectionString: input.connectionString,
    max: input.max,
    connectionTimeoutMillis: input.connectionTimeoutMs,
    idleTimeoutMillis: input.idleTimeoutMs,
    statement_timeout: input.statementTimeoutMs,
    query_timeout: input.statementTimeoutMs + 1_000,
    keepAlive: true,
    application_name: input.applicationName,
    ...(input.readOnly
      ? { options: "-c default_transaction_read_only=on" }
      : {}),
  };
}
