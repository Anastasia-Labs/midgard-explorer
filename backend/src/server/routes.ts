import { Express } from "express";
import { registerCatalogue } from "./catalogue";

/** Every public route comes from the endpoint catalogue, which is also what
 * the OpenAPI document, the rate-limit mounts and the reference page derive
 * from. Adding a route here rather than there would make it undocumented and
 * unlimited, so there is nothing to add here. */
export function registerRoutes(app: Express) {
  registerCatalogue(app);
}
