import { describe, it, expect } from "vitest";
import { resolveReadOnly } from "../src/config/security.js";

/**
 * Pins the DEFAULT posture, not just the gating that depends on it.
 *
 * The security suite verifies that registerTools withholds the mutation tools when the
 * flag is set. That leaves the derivation of the flag itself unasserted, which is what
 * these cover.
 */
describe("resolveReadOnly — fail-safe posture", () => {
    it("is read-only when the variable is unset", () => {
        expect(resolveReadOnly(undefined)).toBe(true);
    });

    it("is read-only when the variable is empty", () => {
        expect(resolveReadOnly("")).toBe(true);
    });

    it("is read-only for the explicit opt-in value", () => {
        expect(resolveReadOnly("true")).toBe(true);
    });

    // A typo or wrong casing must not silently unlock writes. Only the exact
    // lowercase "false" is treated as consent.
    it.each(["False", "FALSE", "0", "no", "off", "disabled", " false"])(
        "is read-only for the ambiguous value %j",
        (value) => {
            expect(resolveReadOnly(value)).toBe(true);
        }
    );

    it("permits writes only for the exact string 'false'", () => {
        expect(resolveReadOnly("false")).toBe(false);
    });
});
