/**
 * Security posture resolution.
 *
 * Kept as a pure function so the DEFAULT can be tested. The existing security suite
 * covered the gating mechanism by passing `config.readOnly` directly, which meant the
 * env-var resolution — where the actual defect lived — was never exercised: an unset
 * READ_ONLY silently enabled the mutation tools on a public, unauthenticated endpoint.
 */

/**
 * Resolves write access from the raw environment value.
 *
 * Read-only unless the caller opts out with the exact string "false". Every other
 * value — unset, empty, "true", "False", a typo — resolves to read-only, because this
 * server is reachable without authentication and the unsafe direction must require
 * deliberate intent rather than a missing variable.
 */
export function resolveReadOnly(value: string | undefined): boolean {
    return value !== "false";
}
