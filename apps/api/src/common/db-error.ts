// Shared Postgres error predicates for API controllers.
//
// Drizzle (postgres-js driver) surfaces database errors with the raw SQLSTATE
// in `error.code`. Controllers must map constraint violations to clean 4xx
// responses WITHOUT echoing the driver message ("duplicate key value violates
// unique constraint \"pages_project_slug_key\"...") into the HTTP body — it
// leaks schema details and produces inconsistent text across endpoints.

/** True for Postgres `unique_violation` (SQLSTATE 23505). */
export function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "23505";
}
