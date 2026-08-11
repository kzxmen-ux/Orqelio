import type { Locale } from "@/lib/i18n/config";

import { getAuditCategory, type OrganizationAuditEvent } from "./types";

type Presentation = {
  badge: string;
  category: ReturnType<typeof getAuditCategory>;
  description: string;
  title: string;
};

export function getAuditEventPresentation(
  event: OrganizationAuditEvent,
  locale: Locale,
): Presentation {
  const ru = locale === "ru";
  const version = event.metadata.versionNumber;
  const locations = event.metadata.locationCount;
  const category = getAuditCategory(event.eventType);
  const badge = {
    administrators: ru ? "Администраторы" : "Әкімшілер",
    ai: ru ? "AI-менеджер" : "ЖИ-менеджер",
    integrations: ru ? "Интеграции" : "Интеграциялар",
  }[category];

  const values: Record<OrganizationAuditEvent["eventType"], [string, string]> = {
    ai_settings_updated: [
      ru ? "Настройки AI-менеджера обновлены" : "ЖИ-менеджер баптаулары жаңартылды",
      version ? (ru ? `Сохранена версия ${version}.` : `${version}-нұсқа сақталды.`) : (ru ? "Конфигурация сохранена." : "Конфигурация сақталды."),
    ],
    ai_settings_restored: [
      ru ? "Настройки AI-менеджера восстановлены" : "ЖИ-менеджер баптаулары қалпына келтірілді",
      version ? (ru ? `Создана новая версия ${version}.` : `Жаңа ${version}-нұсқа жасалды.`) : (ru ? "Снимок восстановлен как новая версия." : "Сурет жаңа нұсқа ретінде қалпына келтірілді."),
    ],
    ai_settings_ready: [ru ? "AI-менеджер готов к настройке следующих этапов" : "ЖИ-менеджер келесі кезеңдерге дайын", ru ? "Обязательная информация заполнена." : "Міндетті ақпарат толтырылды."],
    ai_settings_draft: [ru ? "Настройки AI-менеджера сохранены как черновик" : "ЖИ-менеджер баптаулары нобай ретінде сақталды", ru ? "Обязательную информацию ещё нужно дополнить." : "Міндетті ақпаратты әлі толықтыру қажет."],
    admin_invited: [ru ? "Администратор приглашён" : "Әкімші шақырылды", ru ? "Создано приглашение с ролью администратора." : "Әкімші рөлімен шақыру жасалды."],
    admin_invitation_accepted: [ru ? "Приглашение администратора принято" : "Әкімші шақыруы қабылданды", ru ? "Пользователь получил доступ администратора." : "Пайдаланушы әкімші рұқсатын алды."],
    admin_removed: [ru ? "Администратор удалён" : "Әкімші жойылды", ru ? "Доступ администратора к организации отозван." : "Әкімшінің ұйымға рұқсаты қайтарылды."],
    altegio_connection_started: [ru ? "Начато подключение Altegio" : "Altegio қосылымы басталды", ru ? "Пользователь перенаправлен в Altegio для выбора филиалов." : "Пайдаланушы филиалдарды таңдау үшін Altegio-ға жіберілді."],
    altegio_callback_received: [ru ? "Altegio вернула выбранные филиалы" : "Altegio таңдалған филиалдарды қайтарды", locations ? (ru ? `Получено филиалов: ${locations}.` : `Алынған филиалдар: ${locations}.`) : (ru ? "Callback принят и проверен." : "Callback қабылданып, тексерілді.")],
    altegio_activation_succeeded: [ru ? "Altegio успешно подключена" : "Altegio сәтті қосылды", locations ? (ru ? `Проверен доступ к филиалам: ${locations}.` : `Филиалдарға рұқсат тексерілді: ${locations}.`) : (ru ? "Активация и проверка доступа завершены." : "Белсендіру және рұқсатты тексеру аяқталды.")],
    altegio_activation_failed: [ru ? "Не удалось активировать Altegio" : "Altegio-ны белсендіру мүмкін болмады", ru ? "Провайдер отклонил активацию одного из филиалов." : "Провайдер филиалдардың бірін белсендіруден бас тартты."],
    altegio_access_verification_failed: [ru ? "Не удалось проверить доступ Altegio" : "Altegio рұқсатын тексеру мүмкін болмады", ru ? "Активация не была отмечена как успешная." : "Белсендіру сәтті деп белгіленбеді."],
    altegio_disconnected: [ru ? "Altegio отключена" : "Altegio ажыратылды", ru ? "Подключение переведено в отключённое состояние." : "Қосылым ажыратылған күйге ауыстырылды."],
  };
  const [title, description] = values[event.eventType];
  return { badge, category, description, title };
}
