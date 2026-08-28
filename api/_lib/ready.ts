import { ensureSchema } from "./database.js";

let schemaPromise: Promise<void> | undefined;

/** Initialize the small schema once per warm serverless instance. */
export function prepareDatabase(): Promise<void> {
  schemaPromise ??= ensureSchema().catch((error) => {
    schemaPromise = undefined;
    throw error;
  });
  return schemaPromise;
}
