import { describe, it, expect } from "vitest";
import { resolveReadOnly } from "../src/config/security.js";

/**
 * These pin the DEFAULT, which is what actually failed in production.
 *
 * The existing security suite verified that registerTools gates the mutation tools on
 * config.readOnly, and it did — but it constructed that flag by hand. Nothing asserted
 * how the flag is derived from the environment, so `READ_ONLY === "true"` shipped with
 * an unset variable resolving to read-WRITE on a public, unauthenticated endpoint.
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
