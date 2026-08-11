import type { Locale } from "@/lib/i18n/config";

import type {
  AltegioIntegrationAttempt,
  IntegrationCenterStatus,
  IntegrationErrorCategory,
} from "./types";

export function integrationStatusLabel(status: IntegrationCenterStatus, locale: Locale): string {
  const labels: Record<IntegrationCenterStatus, [string, string]> = {
    activation: ["Активация", "Белсендіру"],
    awaiting_return: ["Ожидание возврата из Altegio", "Altegio-дан қайтаруды күту"],
    connected: ["Подключено", "Қосылған"],
    disconnected: ["Отключено", "Ажыратылған"],
    error: ["Ошибка", "Қате"],
    not_connected: ["Не подключено", "Қосылмаған"],
    partial: ["Частично подключено", "Ішінара қосылған"],
    paused: ["Приостановлено", "Уақытша тоқтатылған"],
    started: ["Подключение начато", "Қосылым басталды"],
    verification: ["Проверка доступа", "Рұқсатты тексеру"],
  };
  return labels[status][locale === "ru" ? 0 : 1];
}

export function integrationErrorLabel(category: IntegrationErrorCategory, locale: Locale): string {
  const labels: Record<IntegrationErrorCategory, [string, string]> = {
    authorization_rejected: ["Авторизация отклонена", "Авторизация қабылданбады"],
    expired: ["Время подключения истекло", "Қосылу уақыты аяқталды"],
    insufficient_permissions: ["Нет необходимых прав", "Қажетті рұқсаттар жоқ"],
    partial_activation: ["Частичная активация", "Ішінара белсендіру"],
    provider_unavailable: ["Altegio временно недоступна", "Altegio уақытша қолжетімсіз"],
    unknown_provider_error: ["Неизвестная ошибка провайдера", "Провайдердің белгісіз қатесі"],
    verification_failed: ["Не удалось проверить доступ", "Рұқсатты тексеру мүмкін болмады"],
  };
  return labels[category][locale === "ru" ? 0 : 1];
}

export function attemptStatusLabel(attempt: AltegioIntegrationAttempt, locale: Locale): string {
  const ru = locale === "ru";
  if (attempt.status === "pending" && new Date(attempt.expiresAt).getTime() <= Date.now()) {
    return ru ? "Срок истёк" : "Мерзімі аяқталды";
  }
  const labels: Record<AltegioIntegrationAttempt["status"], [string, string]> = {
    error: ["Ошибка", "Қате"],
    expired: ["Срок истёк", "Мерзімі аяқталды"],
    partial: ["Частично завершено", "Ішінара аяқталды"],
    pending: ["Подключение начато", "Қосылым басталды"],
    processing: ["Обработка", "Өңделуде"],
    succeeded: ["Успешно", "Сәтті"],
  };
  return labels[attempt.status][ru ? 0 : 1];
}
