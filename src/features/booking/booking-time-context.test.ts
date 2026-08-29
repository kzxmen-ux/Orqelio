import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isIanaTimeZone,
  loadBookingTimeContextForOrganizationCore,
  type BookingTimeContextDependencies,
} from "./booking-time-context-core.ts";

const ORGANIZATION_ID = "11111111-1111-4111-8111-111111111111";
const MIGRATION_PATH = new URL(
  "../../../supabase/migrations/20260829163853_trusted_organization_timezone.sql",
  import.meta.url,
);
const PRODUCTION_LOADER_PATH = new URL(
  "./booking-time-context.ts",
  import.meta.url,
);

function dependencies(
  rows: unknown,
  isValidTimeZone: (timeZone: string) => boolean = isIanaTimeZone,
): BookingTimeContextDependencies {
  return {
    loadOrganizationRows: async () => rows,
    isValidTimeZone,
  };
}

test("validates real IANA timezones with the platform Intl capability", () => {
  assert.equal(isIanaTimeZone("Asia/Almaty"), true);
  assert.equal(isIanaTimeZone("Europe/Berlin"), true);
  assert.equal(isIanaTimeZone("Invalid/Timezone"), false);
});

test("normalizes surrounding whitespace and exposes only timeZone", async () => {
  const result = await loadBookingTimeContextForOrganizationCore(
    ORGANIZATION_ID,
    dependencies([
      { id: ORGANIZATION_ID, timezone: "  Asia/Almaty\t" },
    ]),
  );

  assert.deepEqual(result, {
    success: true,
    context: { timeZone: "Asia/Almaty" },
  });
  if (result.success) {
    assert.deepEqual(Object.keys(result).sort(), ["context", "success"]);
    assert.deepEqual(Object.keys(result.context), ["timeZone"]);
    assert.equal("organizationId" in result.context, false);
    assert.equal("timezone" in result.context, false);
  }
});

test("rejects invalid and empty database timezones without a fallback", async () => {
  for (const timezone of ["Invalid/Timezone", "   "] as const) {
    const result = await loadBookingTimeContextForOrganizationCore(
      ORGANIZATION_ID,
      dependencies([{ id: ORGANIZATION_ID, timezone }]),
    );

    assert.deepEqual(result, {
      success: false,
      code: "time_context_unavailable",
    });
    assert.doesNotMatch(JSON.stringify(result), /Asia\/Almaty/);
  }
});

test("rejects missing, duplicate, and malformed organization rows", async () => {
  const malformedRows: readonly unknown[] = [
    null,
    [],
    [null],
    [{}],
    [{ id: ORGANIZATION_ID }],
    [{ id: ORGANIZATION_ID, timezone: null }],
    [
      { id: ORGANIZATION_ID, timezone: "Asia/Almaty" },
      { id: ORGANIZATION_ID, timezone: "Europe/Berlin" },
    ],
  ];

  for (const rows of malformedRows) {
    assert.deepEqual(
      await loadBookingTimeContextForOrganizationCore(
        ORGANIZATION_ID,
        dependencies(rows),
      ),
      { success: false, code: "time_context_unavailable" },
    );
  }
});

test("rejects an organization ID mismatch", async () => {
  const result = await loadBookingTimeContextForOrganizationCore(
    ORGANIZATION_ID,
    dependencies([
      {
        id: "22222222-2222-4222-8222-222222222222",
        timezone: "Asia/Almaty",
      },
    ]),
  );

  assert.deepEqual(result, {
    success: false,
    code: "time_context_unavailable",
  });
});

test("contains dependency and timezone validator exceptions", async () => {
  const loadFailure = await loadBookingTimeContextForOrganizationCore(
    ORGANIZATION_ID,
    {
      loadOrganizationRows: async () => {
        throw new Error("raw database details");
      },
      isValidTimeZone: isIanaTimeZone,
    },
  );
  assert.deepEqual(loadFailure, {
    success: false,
    code: "time_context_unavailable",
  });

  const validationFailure = await loadBookingTimeContextForOrganizationCore(
    ORGANIZATION_ID,
    dependencies([{ id: ORGANIZATION_ID, timezone: "Asia/Almaty" }], () => {
      throw new Error("raw validator details");
    }),
  );
  assert.deepEqual(validationFailure, {
    success: false,
    code: "time_context_unavailable",
  });
});

test("production loader is server-only and selects only id and timezone", () => {
  const source = readFileSync(PRODUCTION_LOADER_PATH, "utf8");

  assert.match(source, /^import "server-only";/);
  assert.match(source, /createPrivilegedClient/);
  assert.match(source, /\.from\("organizations"\)/);
  assert.match(source, /\.select\("id, timezone"\)/);
  assert.match(source, /\.eq\("id", organizationId\)/);
  assert.doesNotMatch(source, /cookie|credential|dateText|timeText/i);
});

test("migration adds the trusted default and constraints without write grants", () => {
  const migration = readFileSync(MIGRATION_PATH, "utf8");

  assert.match(
    migration,
    /add column timezone text not null default 'Asia\/Almaty'/i,
  );
  assert.match(
    migration,
    /check \(char_length\(timezone\) between 1 and 100\)/i,
  );
  assert.match(migration, /check \(timezone = btrim\(timezone\)\)/i);
  assert.doesNotMatch(migration, /grant\s+update/i);
  assert.doesNotMatch(migration, /alter\s+policy|create\s+policy/i);
});
