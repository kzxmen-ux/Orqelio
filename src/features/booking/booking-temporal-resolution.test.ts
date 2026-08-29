import assert from "node:assert/strict";
import test from "node:test";

import type { ModelBookingRequest } from "../ai-runtime/decision-types.ts";
import {
  resolveBookingTemporal,
  type BookingTemporalResolutionInput,
} from "./booking-temporal-resolution-core.ts";

const BOOKING_REQUEST: ModelBookingRequest = {
  serviceQuery: null,
  staffQuery: null,
  dateText: "завтра",
  timeText: "16:00",
  customerName: null,
  customerPhone: null,
  appointmentReference: null,
};

function input(
  request: Partial<ModelBookingRequest> = {},
  options: Partial<
    Pick<
      BookingTemporalResolutionInput,
      "intent" | "nowInstant" | "timeContext"
    >
  > = {},
): BookingTemporalResolutionInput {
  return {
    intent: options.intent ?? "check_availability",
    bookingRequest: { ...BOOKING_REQUEST, ...request },
    timeContext: options.timeContext ?? { timeZone: "Asia/Almaty" },
    nowInstant: options.nowInstant ?? "2026-08-29T10:30:45Z",
  };
}

test("parses Russian and Kazakh relative dates from the trusted business date", () => {
  const cases = [
    ["сегодня", "2026-08-29"],
    ["бүгін", "2026-08-29"],
    ["завтра", "2026-08-30"],
    ["ертең", "2026-08-30"],
  ] as const;

  for (const [dateText, localDate] of cases) {
    const result = resolveBookingTemporal(
      input(
        { dateText, timeText: dateText === "сегодня" || dateText === "бүгін" ? "16:00" : "15:00" },
        { intent: "create_appointment" },
      ),
    );
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.localDate, localDate);
    }
  }
});

test("parses ISO, numeric, and Russian/Kazakh named-month dates", () => {
  for (const dateText of [
    "2026-08-30",
    "30.08.2026",
    "  30   АВГУСТА  ",
    "30 августа 2026",
    "30 тамыз",
    "30 ТАМЫЗ 2026",
  ]) {
    const result = resolveBookingTemporal(
      input({ dateText }, { intent: "create_appointment" }),
    );
    assert.deepEqual(result, {
      status: "resolved",
      intent: "create_appointment",
      localDate: "2026-08-30",
      localTime: "16:00",
      startAt: "2026-08-30T11:00:00Z",
    });
  }
});

test("a yearless named date uses only the current local year and never rolls forward", () => {
  assert.deepEqual(
    resolveBookingTemporal(input({ dateText: "28 августа" })),
    { status: "needs_clarification", field: "dateText" },
  );
});

test("missing date needs input; malformed, unsupported, and past dates need clarification", () => {
  for (const dateText of [null, "   "] as const) {
    assert.deepEqual(resolveBookingTemporal(input({ dateText })), {
      status: "needs_input",
      field: "dateText",
    });
  }

  for (const dateText of [
    "к выходным",
    "30.02.2027",
    "2026-13-01",
    "2026-08-28",
  ]) {
    assert.deepEqual(resolveBookingTemporal(input({ dateText })), {
      status: "needs_clarification",
      field: "dateText",
    });
  }
});

test("normalizes supported time prefixes and rejects fuzzy or malformed time", () => {
  for (const timeText of ["15:00", "  В   15:00 ", "САҒАТ 15:00"] as const) {
    const result = resolveBookingTemporal(
      input({ timeText }, { intent: "create_appointment" }),
    );
    assert.equal(result.status, "resolved");
    if (result.status === "resolved") {
      assert.equal(result.localTime, "15:00");
    }
  }

  for (const timeText of ["после обеда", "около 15", "25:00", "15:7"] as const) {
    assert.deepEqual(resolveBookingTemporal(input({ timeText })), {
      status: "needs_clarification",
      field: "timeText",
    });
  }
});

test("create requires time while availability allows a missing time", () => {
  for (const timeText of [null, "  "] as const) {
    assert.deepEqual(
      resolveBookingTemporal(
        input({ timeText }, { intent: "create_appointment" }),
      ),
      { status: "needs_input", field: "timeText" },
    );

    assert.deepEqual(resolveBookingTemporal(input({ timeText })), {
      status: "resolved",
      intent: "check_availability",
      localDate: "2026-08-30",
      localTime: null,
      from: "2026-08-29T19:00:00Z",
      to: "2026-08-30T19:00:00Z",
      requestedStartAt: null,
    });
  }
});

test("today without a time starts at the exact trusted nowInstant", () => {
  assert.deepEqual(
    resolveBookingTemporal(
      input(
        { dateText: "сегодня", timeText: null },
        {
          nowInstant: "2026-08-29T10:30:45.123456789Z",
          timeContext: { timeZone: "Europe/Berlin" },
        },
      ),
    ),
    {
      status: "resolved",
      intent: "check_availability",
      localDate: "2026-08-29",
      localTime: null,
      from: "2026-08-29T10:30:45.123456789Z",
      to: "2026-08-29T22:00:00Z",
      requestedStartAt: null,
    },
  );
});

test("same-day times past or equal to the current local minute require clarification", () => {
  for (const timeText of ["15:29", "15:30"] as const) {
    assert.deepEqual(
      resolveBookingTemporal(input({ dateText: "сегодня", timeText })),
      { status: "needs_clarification", field: "timeText" },
    );
  }

  const future = resolveBookingTemporal(
    input(
      { dateText: "сегодня", timeText: "15:31" },
      { intent: "create_appointment" },
    ),
  );
  assert.deepEqual(future, {
    status: "resolved",
    intent: "create_appointment",
    localDate: "2026-08-29",
    localTime: "15:31",
    startAt: "2026-08-29T10:31:00Z",
  });
});

test("converts the same local time correctly in multiple IANA zones", () => {
  const cases = [
    ["Asia/Almaty", "2026-08-30T10:00:00Z"],
    ["Europe/Moscow", "2026-08-30T12:00:00Z"],
    ["Asia/Tashkent", "2026-08-30T10:00:00Z"],
    ["Europe/Berlin", "2026-08-30T13:00:00Z"],
  ] as const;

  for (const [timeZone, startAt] of cases) {
    assert.deepEqual(
      resolveBookingTemporal(
        input(
          { dateText: "2026-08-30", timeText: "15:00" },
          { intent: "create_appointment", timeContext: { timeZone } },
        ),
      ),
      {
        status: "resolved",
        intent: "create_appointment",
        localDate: "2026-08-30",
        localTime: "15:00",
        startAt,
      },
    );
  }
});

test("availability with an explicit time returns that instant through the next local day start", () => {
  assert.deepEqual(
    resolveBookingTemporal(
      input(
        { dateText: "2026-08-30", timeText: "15:00" },
        { timeContext: { timeZone: "Europe/Berlin" } },
      ),
    ),
    {
      status: "resolved",
      intent: "check_availability",
      localDate: "2026-08-30",
      localTime: "15:00",
      from: "2026-08-30T13:00:00Z",
      to: "2026-08-30T22:00:00Z",
      requestedStartAt: "2026-08-30T13:00:00Z",
    },
  );
});

test("full-day windows follow local DST boundaries instead of assuming 24 hours", () => {
  assert.deepEqual(
    resolveBookingTemporal(
      input(
        { dateText: "2026-03-29", timeText: null },
        {
          nowInstant: "2026-03-28T10:00:00Z",
          timeContext: { timeZone: "Europe/Berlin" },
        },
      ),
    ),
    {
      status: "resolved",
      intent: "check_availability",
      localDate: "2026-03-29",
      localTime: null,
      from: "2026-03-28T23:00:00Z",
      to: "2026-03-29T22:00:00Z",
      requestedStartAt: null,
    },
  );
});

test("rejects nonexistent and ambiguous DST local times", () => {
  const cases = [
    ["2026-03-29", "02:30", "2026-03-28T10:00:00Z"],
    ["2026-10-25", "02:30", "2026-10-24T10:00:00Z"],
  ] as const;

  for (const [dateText, timeText, nowInstant] of cases) {
    assert.deepEqual(
      resolveBookingTemporal(
        input(
          { dateText, timeText },
          {
            intent: "create_appointment",
            nowInstant,
            timeContext: { timeZone: "Europe/Berlin" },
          },
        ),
      ),
      { status: "needs_clarification", field: "timeText" },
    );
  }
});

test("invalid timezone or non-absolute nowInstant becomes a safe time-context failure", () => {
  for (const invalidInput of [
    input({}, { timeContext: { timeZone: "Invalid/Timezone" } }),
    input({}, { timeContext: { timeZone: "+05:00" } }),
    input({}, { nowInstant: "2026-08-29T10:30:45" }),
    input({}, { nowInstant: "not-an-instant" }),
  ]) {
    assert.deepEqual(resolveBookingTemporal(invalidInput), {
      status: "failed",
      code: "time_context_unavailable",
    });
  }
});

test("relative dates are driven only by nowInstant, not the system clock", () => {
  const first = resolveBookingTemporal(
    input(
      { dateText: "завтра", timeText: null },
      { nowInstant: "2031-01-01T00:00:00Z" },
    ),
  );
  const second = resolveBookingTemporal(
    input(
      { dateText: "завтра", timeText: null },
      { nowInstant: "2042-06-10T00:00:00Z" },
    ),
  );

  assert.equal(first.status === "resolved" ? first.localDate : null, "2031-01-02");
  assert.equal(second.status === "resolved" ? second.localDate : null, "2042-06-11");
});
