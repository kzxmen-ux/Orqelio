import type { AiBookingActionExecutionResult } from "../../booking/ai-booking-action-executor-core.ts";

export type BookingResponseLocale = { language: "ru" | "kk"; timeZone: string };

// Only display-name options from catalog resolution may be interpolated. Never
// stringify a booking result: its verified IDs remain server-only.
export function buildBookingResultResponse(
  result: AiBookingActionExecutionResult,
  locale: BookingResponseLocale,
): string | null {
  const kk = locale.language === "kk";
  const unavailable = kk
    ? "Қазір тексеру мүмкін болмады. Әкімшіге хабарласыңыз."
    : "Сейчас не удалось проверить. Пожалуйста, обратитесь к администратору.";
  const uncertain = kk
    ? "Жазылудың нәтижесі белгісіз: растай да, болмады деп те айта алмаймын. Қайта жазбаймын. Әкімшіден тексеруді сұраңыз."
    : "Результат записи пока неизвестен: не могу подтвердить ни успех, ни отказ. Повторно записывать не буду. Уточните у администратора.";
  const otherTime = kk
    ? "Бұл уақыт бос емес. Басқа уақытты таңдаңыз."
    : "Это время уже занято. Выберите, пожалуйста, другое время.";
  const questions = {
    serviceQuery: kk ? "Қандай қызмет керек?" : "Какая услуга вам нужна?",
    staffQuery: kk ? "Қай маманды таңдайсыз?" : "К какому специалисту хотите записаться?",
    dateText: kk ? "Қай күнге жазылайық?" : "На какую дату хотите записаться?",
    timeText: kk ? "Қай уақыт ыңғайлы?" : "Какое время вам удобно?",
    customerName: kk ? "Есіміңіз кім?" : "Как к вам обращаться?",
  };
  const format = (instant: string): string => {
    // Explicit offset required: never interpret a provider time in server TZ.
    if (!/(Z|[+-]\d{2}:\d{2})$/.test(instant)) throw new Error("Invalid instant");
    return new Intl.DateTimeFormat(kk ? "kk-KZ" : "ru-RU", {
      timeZone: locale.timeZone,
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).format(new Date(instant));
  };

  try {
    switch (result.status) {
      case "already_executing": return null;
      case "indeterminate": return uncertain;
      case "needs_input": return questions[result.field];
      case "needs_clarification": {
        const options = result.field === "serviceQuery" || result.field === "staffQuery"
          ? [...new Set((result.options ?? []).map((name) => name.trim().replace(/\s+/gu, " ")))]
              .filter((name) => name.length > 0 && name.length <= 120).slice(0, 5)
          : [];
        return questions[result.field] + (options.length ? `\n${options.join("; ")}` : "");
      }
      case "create_succeeded":
        return kk
          ? `Жазылуыңыз расталды: ${format(result.appointment.startAt)}.`
          : `Запись подтверждена: ${format(result.appointment.startAt)}.`;
      case "create_failed": return result.code === "slot_unavailable" ? otherTime :
        kk ? "Жазылу орындалмады. Әкімшіге хабарласыңыз." : "Записаться не удалось. Обратитесь к администратору.";
      case "unavailable": return unavailable;
      case "availability": {
        if (!result.result.success) return result.result.code === "slot_unavailable" ? otherTime : unavailable;
        const times = [...new Set(result.result.data.map((slot) => slot.startAt))]
          .sort((a, b) => Date.parse(a) - Date.parse(b)).map(format);
        const options = [...new Set(times)].slice(0, 5);
        if (!options.length) return kk
          ? "Бұл аралықта бос уақыт жоқ. Басқа күнді немесе уақытты таңдаңыз."
          : "В этом промежутке свободного времени нет. Выберите другую дату или время.";
        return (kk ? "Бос уақыттар (ұйымның жергілікті уақыты):\n" : "Свободное время (по местному времени организации):\n")
          + options.join("\n") + (kk ? "\nҚайсысы ыңғайлы?" : "\nКакое вам подходит?");
      }
    }
  } catch {
    // A confirmed mutation with unformattable evidence must not be called failed.
    return result.status === "create_succeeded" ? uncertain : unavailable;
  }
}
