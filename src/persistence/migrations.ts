/** IndexedDB schema migrations are owned by database.ts; this hook is kept as a stable extension point. */
export async function runMigrations(): Promise<void> { /* v1 is created by the database upgrade transaction */ }
