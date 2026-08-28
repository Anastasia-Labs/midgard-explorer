import winston, { format } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { config } from "./config";

const { combine, timestamp, prettyPrint } = format;

export const logger = winston.createLogger({
  level: "info",
  format: combine(timestamp(), prettyPrint()),
  transports: [new winston.transports.Console()],
});

/** Rotation with no ceiling is not rotation: a new file per day and nothing
 * ever removed fills the disk, and a full disk takes the database down with
 * the process that wrote the logs. Fourteen days of at most 20MB each bounds
 * it at roughly 280MB. */
const fileRotateTransport = new DailyRotateFile({
  level: "info",
  format: combine(timestamp(), prettyPrint()),
  filename: `${config.LOG_LOCATION}-%DATE%.log`,
  maxSize: "20m",
  maxFiles: "14d",
  zippedArchive: true,
});

logger.add(fileRotateTransport);
