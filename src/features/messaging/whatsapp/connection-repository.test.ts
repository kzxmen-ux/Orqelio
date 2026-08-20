import assert from "node:assert/strict";
import test from "node:test";

import {
  isValidWhatsappProviderIdentifier,
  resolveWhatsappConnectionWithQuery,
  type WhatsappConnectionInput,
  type WhatsappConnectionQuery,
} from "./connection-repository-core.ts";

const ACTIVE_ROW = {
  id: "fixture-connection-id",
  organization_id: "fixture-organization-id",
  phone_number_id: "222222222222222",
  status: "active",
  waba_id: "111111111111111",
};

function queryForRows(
  rows: Array<Record<string, unknown>>,
): WhatsappConnectionQuery {
  return async (input) => ({
    data: rows.filter(
      (row) =>
        row.waba_id === input.wabaId &&
        row.phone_number_id === input.phoneNumberId,
    ),
    error: null,
  });
}

const VALID_INPUT: WhatsappConnectionInput = {
  phoneNumberId: "222222222222222",
  wabaId: "111111111111111",
};

test("accepts bounded decimal WABA and phone number identifiers", () => {
  assert.equal(isValidWhatsappProviderIdentifier(VALID_INPUT.wabaId), true);
  assert.equal(
    isValidWhatsappProviderIdentifier(VALID_INPUT.phoneNumberId),
    true,
  );
});

test("rejects empty, whitespace, alphabetic, and overlong identifiers", () => {
  for (const value of ["", " ", "123 456", "abc123", "1".repeat(33)]) {
    assert.equal(isValidWhatsappProviderIdentifier(value), false);
  }
});

test("invalid WABA or phone number input returns null without querying", async () => {
  for (const input of [
    { phoneNumberId: VALID_INPUT.phoneNumberId, wabaId: "" },
    { phoneNumberId: "", wabaId: VALID_INPUT.wabaId },
  ]) {
    let queryWasCalled = false;
    const result = await resolveWhatsappConnectionWithQuery(input, async () => {
      queryWasCalled = true;
      return { data: [ACTIVE_ROW], error: null };
    });

    assert.equal(result, null);
    assert.equal(queryWasCalled, false);
  }
});

test("resolves exactly one active connection for the exact pair", async () => {
  const result = await resolveWhatsappConnectionWithQuery(
    VALID_INPUT,
    queryForRows([ACTIVE_ROW]),
  );

  assert.deepEqual(result, {
    connectionId: "fixture-connection-id",
    organizationId: "fixture-organization-id",
  });
});

test("suspended and disconnected connections do not resolve", async () => {
  for (const status of ["suspended", "disconnected"]) {
    const result = await resolveWhatsappConnectionWithQuery(
      VALID_INPUT,
      queryForRows([{ ...ACTIVE_ROW, status }]),
    );

    assert.equal(result, null);
  }
});

test("wrong WABA with the same phone number does not resolve", async () => {
  const result = await resolveWhatsappConnectionWithQuery(
    { ...VALID_INPUT, wabaId: "333333333333333" },
    queryForRows([ACTIVE_ROW]),
  );

  assert.equal(result, null);
});

test("wrong phone number with the same WABA does not resolve", async () => {
  const result = await resolveWhatsappConnectionWithQuery(
    { ...VALID_INPUT, phoneNumberId: "444444444444444" },
    queryForRows([ACTIVE_ROW]),
  );

  assert.equal(result, null);
});

test("no connection returns null", async () => {
  const result = await resolveWhatsappConnectionWithQuery(
    VALID_INPUT,
    queryForRows([]),
  );

  assert.equal(result, null);
});

test("multiple matching rows fail closed instead of choosing one", async () => {
  await assert.rejects(
    resolveWhatsappConnectionWithQuery(
      VALID_INPUT,
      queryForRows([
        ACTIVE_ROW,
        { ...ACTIVE_ROW, id: "fixture-second-connection-id" },
      ]),
    ),
    /ambiguous/,
  );
});

test("unexpected database errors throw a safe error", async () => {
  await assert.rejects(
    resolveWhatsappConnectionWithQuery(VALID_INPUT, async () => ({
      data: null,
      error: { message: "fixture database detail" },
    })),
    new Error("WhatsApp connection resolution failed."),
  );
});
