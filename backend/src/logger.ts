import winston, { format } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { config } from "./config";

const { combine, errors, timestamp, prettyPrint } = format;

/** `scheme://user:password@` in any connection URL a driver error quotes. */
const CREDENTIALS = /([a-z][a-z0-9+.-]*:\/\/)[^:@\/\s]+:[^@\s]+@/gi;

const redactCredentials = format((info) => {
  for (const key of ["message", "stack"] as const) {
    const value = info[key];
    if (typeof value === "string") info[key] = value.replace(CREDENTIALS, "$1***:***@");
  }
  return info;
});

/**
 * One format for every transport. `errors` is what keeps a thrown value's
 * message and stack: without it winston logs an Error as `{ level, timestamp }`,
 * and every 500 the server answered was recorded with no cause.
 */
export const logFormat = () =>
  combine(errors({ stack: true }), redactCredentials(), timestamp(), prettyPrint());

export const logger = winston.createLogger({
  level: "info",
  format: logFormat(),
  transports: [new winston.transports.Console()],
});

/** Rotation with no ceiling is not rotation: a new file per day and nothing
 * ever removed fills the disk, and a full disk takes the database down with
 * the process that wrote the logs. Fourteen days of at most 20MB each bounds
 * it at roughly 280MB. */
const fileRotateTransport = new DailyRotateFile({
  level: "info",
  format: logFormat(),
  filename: `${config.LOG_LOCATION}-%DATE%.log`,
  maxSize: "20m",
  maxFiles: "14d",
  zippedArchive: true,
});

logger.add(fileRotateTransport);
