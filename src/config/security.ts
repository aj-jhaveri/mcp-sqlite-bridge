/**
 * Security posture resolution.
 *
 * Kept as a pure function so the default itself is testable, not just the gating that
 * depends on it.
 */

/**
 * Resolves write access from the raw environment value.
 *
 * Read-only unless the caller opts out with the exact string "false". Every other
 * value — unset, empty, "true", "False", a typo — resolves to read-only: this server
 * is reachable without authentication, so enabling writes must require deliberate
 * intent rather than a missing variable.
 */
export function resolveReadOnly(value: string | undefined): boolean {
    return value !== "false";
}
