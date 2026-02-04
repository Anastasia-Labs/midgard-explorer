import winston, { format } from "winston";
import DailyRotateFile from "winston-daily-rotate-file";
import { config } from "./config";

const { combine, timestamp, prettyPrint } = format;

export const logger = winston.createLogger({
  level: "info",
  format: combine(timestamp(), prettyPrint()),
  transports: [new winston.transports.Console()],
});

const fileRotateTransport = new DailyRotateFile({
  level: "info",
  format: combine(timestamp(), prettyPrint()),
  filename: `${config.LOG_LOCATION}-%DATE%.log`,
});

logger.add(fileRotateTransport);
