import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { shouldBlockPortalAccess } from "../src/lib/access-policy";

describe("student access policy", () => {
  it("blocks access when the student is denied", () => {
    assert.equal(shouldBlockPortalAccess("DENIED", null), true);
  });

  it("blocks access when the device was revoked for an active student", () => {
    assert.equal(
      shouldBlockPortalAccess("ACTIVE", { approved: false, reason: "revoked-by-admin" }),
      true,
    );
  });

  it("allows access for an active student with an approved device", () => {
    assert.equal(
      shouldBlockPortalAccess("ACTIVE", { approved: true, reason: null }),
      false,
    );
  });
});
