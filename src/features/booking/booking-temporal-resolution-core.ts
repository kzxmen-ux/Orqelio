import { Temporal } from "@js-temporal/polyfill";

import type { ModelBookingRequest } from "../ai-runtime/decision-types.ts";
import type { BookingTimeContext } from "./booking-time-context-core.ts";

export type BookingTemporalResolutionInput = {
  intent: "check_availability" | "create_appointment";
  bookingRequest: ModelBookingRequest;
  timeContext: BookingTimeContext;
  nowInstant: string;
};

type BookingTemporalField = "dateText" | "timeText";

export type BookingTemporalResolutionResult =
  | {
      status: "resolved";
      intent: "check_availability";
      localDate: string;
      localTime: string | null;
      from: string;
      to: string;
      requestedStartAt: string | null;
    }
  | {
      status: "resolved";
      intent: "create_appointment";
      localDate: string;
      localTime: string;
      startAt: string;
    }
  | { status: "needs_input"; field: BookingTemporalField }
  | { status: "needs_clarification"; field: BookingTemporalField }
  | { status: "failed"; code: "time_context_unavailable" };

const MONTHS = new Map<string, number>([
  ["января", 1],
  ["февраля", 2],
  ["марта", 3],
  ["апреля", 4],
  ["мая", 5],
  ["июня", 6],
  ["июля", 7],
  ["августа", 8],
  ["сентября", 9],
  ["октября", 10],
  ["ноября", 11],
  ["декабря", 12],
  ["қаңтар", 1],
  ["ақпан", 2],
  ["наурыз", 3],
  ["сәуір", 4],
  ["мамыр", 5],
  ["маусым", 6],
  ["шілде", 7],
  ["тамыз", 8],
  ["қыркүйек", 9],
  ["қазан", 10],
  ["қараша", 11],
  ["желтоқсан", 12],
]);

const ABSOLUTE_INSTANT_PATTERN = /T.*(?:Z|[+-]\d{2}:\d{2})$/i;

function normalizeText(value: string): string {
  return value.trim().replace(/\s+/gu, " ").toLowerCase();
}

function parsePlainDate(
  year: number,
  month: number,
  day: number,
): Temporal.PlainDate | null {
  try {
    return Temporal.PlainDate.from({ year, month, day }, { overflow: "reject" });
  } catch {
    return null;
  }
}

function parseDateText(
  value: string,
  currentDate: Temporal.PlainDate,
): Temporal.PlainDate | null {
  if (value === "сегодня" || value === "бүгін") {
    return currentDate;
  }
  if (value === "завтра" || value === "ертең") {
    return currentDate.add({ days: 1 });
  }

  const isoMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (isoMatch) {
    return parsePlainDate(
      Number(isoMatch[1]),
      Number(isoMatch[2]),
      Number(isoMatch[3]),
    );
  }

  const numericMatch = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value);
  if (numericMatch) {
    return parsePlainDate(
      Number(numericMatch[3]),
      Number(numericMatch[2]),
      Number(numericMatch[1]),
    );
  }

  const namedMatch = /^(\d{1,2}) ([\p{L}]+)(?: (\d{4}))?$/u.exec(value);
  if (!namedMatch) {
    return null;
  }

  const month = MONTHS.get(namedMatch[2]);
  if (!month) {
    return null;
  }

  return parsePlainDate(
    namedMatch[3] ? Number(namedMatch[3]) : currentDate.year,
    month,
    Number(namedMatch[1]),
  );
}

function parseTimeText(value: string): Temporal.PlainTime | null {
  const match = /^(?:(?:в|сағат) )?([01]?\d|2[0-3]):([0-5]\d)$/.exec(value);
  if (!match) {
    return null;
  }

  return Temporal.PlainTime.from({
    hour: Number(match[1]),
    minute: Number(match[2]),
  });
}

function toInstantRejectingDst(
  date: Temporal.PlainDate,
  time: Temporal.PlainTime,
  timeZone: string,
): Temporal.Instant | null {
  try {
    return date
      .toPlainDateTime(time)
      .toZonedDateTime(timeZone, { disambiguation: "reject" })
      .toInstant();
  } catch {
    return null;
  }
}

function resolveDayStart(
  date: Temporal.PlainDate,
  timeZone: string,
): Temporal.Instant | null {
  return toInstantRejectingDst(date, Temporal.PlainTime.from("00:00"), timeZone);
}

function timeContextFailure(): BookingTemporalResolutionResult {
  return { status: "failed", code: "time_context_unavailable" };
}

export function resolveBookingTemporal(
  input: BookingTemporalResolutionInput,
): BookingTemporalResolutionResult {
  try {
    const timeZone = input.timeContext.timeZone.trim();
    if (
      timeZone.length === 0 ||
      /^[+-]/.test(timeZone) ||
      !ABSOLUTE_INSTANT_PATTERN.test(input.nowInstant)
    ) {
      return timeContextFailure();
    }

    const now = Temporal.Instant.from(input.nowInstant);
    const businessNow = now.toZonedDateTimeISO(timeZone);
    const currentDate = businessNow.toPlainDate();
    const rawDateText = input.bookingRequest.dateText;
    if (rawDateText === null || normalizeText(rawDateText).length === 0) {
      return { status: "needs_input", field: "dateText" };
    }

    const date = parseDateText(normalizeText(rawDateText), currentDate);
    if (!date || Temporal.PlainDate.compare(date, currentDate) < 0) {
      return { status: "needs_clarification", field: "dateText" };
    }

    const rawTimeText = input.bookingRequest.timeText;
    const normalizedTime =
      rawTimeText === null ? "" : normalizeText(rawTimeText);
    if (normalizedTime.length === 0) {
      if (input.intent === "create_appointment") {
        return { status: "needs_input", field: "timeText" };
      }

      const nextDayStart = resolveDayStart(date.add({ days: 1 }), timeZone);
      const from =
        Temporal.PlainDate.compare(date, currentDate) === 0
          ? now
          : resolveDayStart(date, timeZone);
      if (!from || !nextDayStart) {
        return timeContextFailure();
      }

      return {
        status: "resolved",
        intent: "check_availability",
        localDate: date.toString(),
        localTime: null,
        from: from.toString(),
        to: nextDayStart.toString(),
        requestedStartAt: null,
      };
    }

    const time = parseTimeText(normalizedTime);
    if (!time) {
      return { status: "needs_clarification", field: "timeText" };
    }

    if (Temporal.PlainDate.compare(date, currentDate) === 0) {
      const currentMinute = Temporal.PlainTime.from({
        hour: businessNow.hour,
        minute: businessNow.minute,
      });
      if (Temporal.PlainTime.compare(time, currentMinute) <= 0) {
        return { status: "needs_clarification", field: "timeText" };
      }
    }

    const requestedInstant = toInstantRejectingDst(date, time, timeZone);
    if (!requestedInstant) {
      return { status: "needs_clarification", field: "timeText" };
    }

    const localDate = date.toString();
    const localTime = time.toString({ smallestUnit: "minute" });
    if (input.intent === "create_appointment") {
      return {
        status: "resolved",
        intent: "create_appointment",
        localDate,
        localTime,
        startAt: requestedInstant.toString(),
      };
    }

    const nextDayStart = resolveDayStart(date.add({ days: 1 }), timeZone);
    if (!nextDayStart) {
      return timeContextFailure();
    }

    return {
      status: "resolved",
      intent: "check_availability",
      localDate,
      localTime,
      from: requestedInstant.toString(),
      to: nextDayStart.toString(),
      requestedStartAt: requestedInstant.toString(),
    };
  } catch {
    return timeContextFailure();
  }
}
