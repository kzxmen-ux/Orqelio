export const SUPPORTED_LOCALES = ["ru", "kk"] as const;

export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = "ru";
export const LOCALE_COOKIE_NAME = "nexora_locale";

export function isLocale(value: unknown): value is Locale {
  return (
    typeof value === "string" &&
    SUPPORTED_LOCALES.includes(value as Locale)
  );
}

const translations: Record<Locale, Record<string, string>> = {
  ru: {
    "AI Manager": "ИИ-менеджер",
    "Authentication": "Аутентификация",
    "Sign in": "Войти",
    "Get started": "Начать",
    "Built around your existing systems": "Работает с вашими системами",
    "An AI manager, not another CRM.": "ИИ-менеджер, а не ещё одна CRM.",
    "Orqelio is designed to work on top of the CRM a business already trusts, connecting customer conversations with operational data without replacing the source of truth.":
      "Orqelio — ИИ-менеджер, который работает поверх CRM, которой бизнес уже доверяет: связывает диалоги с клиентами с операционными данными, не заменяя источник достоверной информации.",
    "Project foundation is ready": "Основа проекта готова",
    "Page not found": "Страница не найдена",
    "The requested page does not exist or you do not have access to it.":
      "Запрошенная страница не существует или у вас нет к ней доступа.",
    "Return to home": "Вернуться на главную",
    "Use your email and password to continue to Orqelio.":
      "Введите электронную почту и пароль, чтобы продолжить работу в Orqelio.",
    "New to Orqelio?": "Впервые в Orqelio?",
    "Create an account": "Создать аккаунт",
    "Welcome back": "С возвращением",
    "The authentication link is invalid or expired. Try again.":
      "Ссылка для аутентификации недействительна или истекла. Попробуйте ещё раз.",
    "Forgot your password?": "Забыли пароль?",
    "Create the account that will manage your Orqelio access.":
      "Создайте аккаунт для управления доступом к Orqelio.",
    "Already have an account?": "Уже есть аккаунт?",
    "Create your account": "Создание аккаунта",
    "Enter your email and we will send password reset instructions if the account exists.":
      "Введите электронную почту. Если аккаунт существует, мы отправим инструкции по сбросу пароля.",
    "Return to sign in": "Вернуться ко входу",
    "Reset your password": "Сброс пароля",
    "Choose a new password for your account.":
      "Придумайте новый пароль для аккаунта.",
    "Update password": "Обновить пароль",
    "Send reset link": "Отправить ссылку",
    "Create account": "Создать аккаунт",
    "Please wait…": "Подождите…",
    "Email": "Электронная почта",
    "New password": "Новый пароль",
    "Password": "Пароль",
    "Confirm password": "Подтвердите пароль",
    "Signing out…": "Выходим…",
    "Sign out": "Выйти",
    "Protected application": "Защищённое приложение",
    "Your password has been updated.": "Пароль успешно обновлён.",
    "Sign out could not be completed. Try again.":
      "Не удалось выйти. Попробуйте ещё раз.",
    "Organizations": "Организации",
    "Choose your organization": "Выберите организацию",
    "You are authenticated as": "Вы вошли как",
    "an authenticated user": "авторизованный пользователь",
    "You do not belong to an organization yet.":
      "Вы пока не состоите ни в одной организации.",
    "Create an organization": "Создать организацию",
    "You will become its owner automatically.":
      "Вы автоматически станете её владельцем.",
    "Organization name": "Название организации",
    "Slug": "Адрес организации",
    "Saving…": "Сохраняем…",
    "Create organization": "Создать организацию",
    "Save settings": "Сохранить настройки",
    "Overview": "Обзор",
    "Integrations": "Интеграции",
    "Administrators": "Администраторы",
    "← All organizations": "← Все организации",
    "Organization workspace": "Рабочее пространство организации",
    "owner": "владелец",
    "admin": "администратор",
    "Workspace overview": "Обзор рабочего пространства",
    "This page is loaded only after Supabase RLS and a server-side membership query authorize access.":
      "Эта страница загружается только после проверки доступа политиками Supabase RLS и серверным запросом членства.",
    "Organization settings": "Настройки организации",
    "Owners and admins may update operational organization fields.":
      "Владелец и администраторы могут изменять рабочие данные организации.",
    "Owner settings": "Настройки владельца",
    "Invite administrators with a one-time link and remove active administrators. Only organization owners can access this page.":
      "Приглашайте администраторов одноразовой ссылкой и удаляйте действующих администраторов. Страница доступна только владельцу организации.",
    "Administrator settings could not be loaded. Try again later.":
      "Не удалось загрузить настройки администраторов. Попробуйте позже.",
    "Invite an administrator": "Пригласить администратора",
    "The link expires after seven days. Orqelio stores only its cryptographic hash, so copy it immediately.":
      "Ссылка действует семь дней. Orqelio хранит только её криптографический хеш, поэтому скопируйте её сразу.",
    "Active administrators": "Действующие администраторы",
    "Added": "Добавлен",
    "No active administrators.": "Действующих администраторов нет.",
    "Invitation history": "История приглашений",
    "Expires": "Истекает",
    "Created": "Создано",
    "pending": "ожидает",
    "accepted": "принято",
    "expired": "истекло",
    "revoked": "отозвано",
    "No invitations have been created.": "Приглашений пока нет.",
    "Administrator email": "Электронная почта администратора",
    "One-time invitation link": "Одноразовая ссылка-приглашение",
    "Copied": "Скопировано",
    "Copy link": "Копировать ссылку",
    "Creating…": "Создаём…",
    "Create invitation": "Создать приглашение",
    "Working…": "Выполняем…",
    "Revoke": "Отозвать",
    "Remove": "Удалить",
    "Invitation unavailable": "Приглашение недоступно",
    "This invitation link is invalid. Ask the organization owner for a new link.":
      "Эта ссылка-приглашение недействительна. Попросите владельца организации создать новую.",
    "Administrator invitation": "Приглашение администратора",
    "Join an organization in Orqelio": "Присоединиться к организации в Orqelio",
    "Sign in or create an account with the exact email address that received this invitation.":
      "Войдите или создайте аккаунт с тем адресом электронной почты, на который пришло приглашение.",
    "Signed in as": "Вы вошли как",
    "The invitation can be accepted only if this email matches.":
      "Приглашение можно принять, только если адрес электронной почты совпадает.",
    "Accepting…": "Принимаем…",
    "Accept administrator invitation": "Принять приглашение администратора",
    "Connect Orqelio to external systems without copying their operational data into this workspace.":
      "Подключайте Orqelio к внешним системам без копирования их операционных данных в это рабочее пространство.",
    "Create and manage provider-neutral CRM connection metadata. A real CRM adapter has not been selected or implemented.":
      "Создавайте и настраивайте независимые от провайдера подключения CRM. Реальный CRM-адаптер пока не выбран и не реализован.",
    "CRM connections": "Подключения CRM",
    "Your CRM connections": "Ваши подключения CRM",
    "Manage the CRM connections available to this organization. The external CRM remains the source of truth.":
      "Управляйте подключениями CRM этой организации. Внешняя CRM остаётся источником достоверных данных.",
    "Provider:": "Провайдер:",
    "Edit": "Изменить",
    "No connections yet": "Подключений пока нет",
    "Choose the development connection below to prepare the integration boundary.":
      "Выберите подключение для разработки ниже, чтобы подготовить интеграционный слой.",
    "Choose an available provider below to start a connection.":
      "Выберите доступного провайдера ниже, чтобы начать подключение.",
    "Connect a new CRM": "Подключить новую CRM",
    "Choose a provider. Production integrations will become available after their adapters are implemented and verified.":
      "Выберите провайдера. Рабочие интеграции станут доступны после реализации и проверки их адаптеров.",
    "Official integration": "Официальная интеграция",
    "Coming soon": "Скоро",
    "Agreement in progress": "В процессе согласования",
    "DIKIDI integration is planned. After connection, Orqelio will be able to use the business services, staff, schedule, and bookings.":
      "Интеграция с DIKIDI планируется. Orqelio сможет использовать услуги, сотрудников, расписание и записи бизнеса после подключения.",
    "API access is being coordinated with DIKIDI.":
      "API-доступ согласовывается с DIKIDI",
    "YCLIENTS integration is planned and cannot be connected yet.":
      "Интеграция YCLIENTS запланирована, но пока недоступна для подключения.",
    "Altegio integration is planned and cannot be connected yet.":
      "Интеграция Altegio запланирована, но пока недоступна для подключения.",
    "Connect Altegio": "Подключить Altegio",
    "Connect integration": "Подключить интеграцию",
    "Redirecting to Altegio…": "Переходим в Altegio…",
    "You will be redirected to Altegio to choose one or more locations and confirm access. After confirmation, Altegio will return you to Orqelio.":
      "Вы перейдёте в Altegio, выберете один или несколько филиалов и подтвердите доступ. После подтверждения Altegio вернёт вас в Orqelio.",
    "The Altegio connection request is invalid.":
      "Запрос на подключение Altegio недействителен.",
    "The Altegio connection could not be started. Check organization access and try again.":
      "Не удалось начать подключение Altegio. Проверьте доступ к организации и повторите попытку.",
    "Configure": "Настроить",
    "Development only": "Только для разработки",
    "Development connection": "Подключение для разработки",
    "Create a non-secret test connection for developing the integration foundation.":
      "Создайте тестовое подключение без секретов для разработки интеграционного слоя.",
    "Development CRM connection": "CRM-подключение для разработки",
    "Create a non-secret development connection. This does not contact or connect to any real CRM provider.":
      "Создайте подключение для разработки без секретов. Оно не обращается к реальному провайдеру CRM и не подключается к нему.",
    "Workspace reference (optional)":
      "Идентификатор рабочего пространства (необязательно)",
    "Create development connection": "Создать подключение для разработки",
    "Foundation": "Основа",
    "Open integration →": "Открыть интеграцию →",
    "← Integrations": "← Интеграции",
    "These records are placeholders for future provider adapters. The external CRM remains the source of truth.":
      "Эти записи — заготовки для будущих адаптеров провайдеров. Внешняя CRM остаётся источником достоверных данных.",
    "New CRM connection": "Новое подключение CRM",
    "CRM connection deleted.": "Подключение CRM удалено.",
    "Provider: Custom placeholder": "Провайдер: тестовая заготовка",
    "Last sync:": "Последняя синхронизация:",
    "Never": "Никогда",
    "connected": "подключено",
    "disconnected": "отключено",
    "draft": "черновик",
    "error": "ошибка",
    "No CRM connections": "Нет подключений CRM",
    "Create a placeholder record to prepare the integration boundary.":
      "Создайте запись-заготовку для подготовки интеграционного слоя.",
    "← CRM connections": "← Подключения CRM",
    "Create a non-secret placeholder. This does not contact or connect to any real CRM provider.":
      "Создайте безопасную запись-заготовку. Она не обращается к реальному провайдеру CRM и не подключается к нему.",
    "Custom placeholder": "Тестовая заготовка",
    "Connection settings": "Настройки подключения",
    "Only controlled, non-secret placeholder configuration is stored.":
      "Хранятся только контролируемые несекретные настройки заготовки.",
    "Connection name": "Название подключения",
    "Primary CRM": "Основная CRM",
    "External workspace reference": "Идентификатор внешнего рабочего пространства",
    "Optional non-secret identifier. Never enter API keys, tokens, or passwords.":
      "Необязательный несекретный идентификатор. Никогда не вводите API-ключи, токены или пароли.",
    "Provider region": "Регион провайдера",
    "Not specified": "Не указан",
    "Global": "Глобальный",
    "Europe": "Европа",
    "United States": "США",
    "Asia Pacific": "Азиатско-Тихоокеанский регион",
    "Create placeholder connection": "Создать подключение-заготовку",
    "Save connection settings": "Сохранить настройки подключения",
    "Connection lifecycle": "Состояние подключения",
    "No real CRM adapter exists yet. Orqelio will not mark this placeholder as connected without a verified provider response.":
      "Реального CRM-адаптера пока нет. Orqelio не отметит заготовку подключённой без подтверждённого ответа провайдера.",
    "Connect provider — not available yet":
      "Подключить провайдера — пока недоступно",
    "Updating…": "Обновляем…",
    "Return to draft": "Вернуть в черновик",
    "Mark as disconnected": "Отметить отключённым",
    "Delete connection": "Удалить подключение",
    "This removes only this Orqelio connection record. It does not modify any external CRM.":
      "Будет удалена только запись подключения в Orqelio. Внешняя CRM не изменится.",
    "Deleting…": "Удаляем…",
    "Enter a valid email address.": "Введите корректный адрес электронной почты.",
    "Check the highlighted field.": "Проверьте выделенное поле.",
    "Enter your password.": "Введите пароль.",
    "Check the highlighted fields.": "Проверьте выделенные поля.",
    "Use 8 to 128 characters.": "Используйте от 8 до 128 символов.",
    "Confirm your password.": "Подтвердите пароль.",
    "Passwords do not match.": "Пароли не совпадают.",
    "If an account exists and email delivery is available, a password reset link is on its way. If you requested one recently, wait a few minutes before trying again.":
      "Если аккаунт существует и отправка почты доступна, ссылка для сброса пароля уже отправлена. Если вы недавно запрашивали её, подождите несколько минут.",
    "Sign in is temporarily unavailable. Try again.":
      "Вход временно недоступен. Попробуйте ещё раз.",
    "Email or password is incorrect.": "Неверная электронная почта или пароль.",
    "Unable to sign in. Try again.": "Не удалось войти. Попробуйте ещё раз.",
    "Account creation is temporarily unavailable.":
      "Создание аккаунта временно недоступно.",
    "Unable to create the account. Check your details or try again later.":
      "Не удалось создать аккаунт. Проверьте данные или попробуйте позже.",
    "Check your email to confirm your address and finish creating your account.":
      "Проверьте почту, подтвердите адрес и завершите создание аккаунта.",
    "This recovery session is invalid or expired. Request a new reset link.":
      "Сеанс восстановления недействителен или истёк. Запросите новую ссылку.",
    "Password update is temporarily unavailable.":
      "Обновление пароля временно недоступно.",
    "Unable to update the password. Request a new reset link and try again.":
      "Не удалось обновить пароль. Запросите новую ссылку и попробуйте ещё раз.",
    "Enter an organization name.": "Введите название организации.",
    "Organization name must be 100 characters or fewer.":
      "Название организации должно содержать не более 100 символов.",
    "Slug must be at least 3 characters.":
      "Адрес организации должен содержать не менее 3 символов.",
    "Slug must be 63 characters or fewer.":
      "Адрес организации должен содержать не более 63 символов.",
    "Use lowercase letters, numbers, and single hyphens.":
      "Используйте строчные латинские буквы, цифры и одиночные дефисы.",
    "Your session has expired. Sign in and try again.":
      "Сеанс истёк. Войдите и попробуйте ещё раз.",
    "This organization slug is already in use.":
      "Этот адрес организации уже используется.",
    "The organization could not be created. Try again later.":
      "Не удалось создать организацию. Попробуйте позже.",
    "The organization could not be updated. Try again later.":
      "Не удалось обновить организацию. Попробуйте позже.",
    "Organization not found or access was denied.":
      "Организация не найдена или доступ запрещён.",
    "Organization settings saved.": "Настройки организации сохранены.",
    "Email address is too long.": "Адрес электронной почты слишком длинный.",
    "An active invitation already exists, or this user is already a member.":
      "Активное приглашение уже существует или пользователь уже состоит в организации.",
    "The invitation could not be created. Check owner access and try again.":
      "Не удалось создать приглашение. Проверьте права владельца и попробуйте ещё раз.",
    "Invitation created. Copy this link now; it cannot be shown again.":
      "Приглашение создано. Скопируйте ссылку сейчас — повторно показать её нельзя.",
    "The invitation request is invalid.": "Некорректный запрос приглашения.",
    "The invitation could not be revoked. It may no longer be pending.":
      "Не удалось отозвать приглашение. Возможно, оно уже не ожидает принятия.",
    "Invitation revoked.": "Приглашение отозвано.",
    "The administrator request is invalid.":
      "Некорректный запрос управления администратором.",
    "The administrator could not be removed. Check owner access and try again.":
      "Не удалось удалить администратора. Проверьте права владельца и попробуйте ещё раз.",
    "Administrator removed.": "Администратор удалён.",
    "Invitation link is invalid.": "Ссылка-приглашение недействительна.",
    "Sign in or create an account before accepting.":
      "Войдите или создайте аккаунт перед принятием приглашения.",
    "This invitation is invalid, expired, revoked, already used, or belongs to another email.":
      "Приглашение недействительно, истекло, отозвано, уже использовано или предназначено для другого адреса.",
    "Enter a connection name.": "Введите название подключения.",
    "Connection name must be 100 characters or fewer.":
      "Название подключения должно содержать не более 100 символов.",
    "Workspace reference must be 100 characters or fewer.":
      "Идентификатор рабочего пространства должен содержать не более 100 символов.",
    "Use letters, numbers, underscores, or hyphens.":
      "Используйте латинские буквы, цифры, подчёркивания или дефисы.",
    "The CRM connection could not be created. Check organization access and try again.":
      "Не удалось создать подключение CRM. Проверьте доступ к организации и попробуйте ещё раз.",
    "The CRM connection could not be updated. Access may have been denied.":
      "Не удалось обновить подключение CRM. Возможно, доступ запрещён.",
    "Connection settings saved.": "Настройки подключения сохранены.",
    "The CRM connection request is invalid.":
      "Некорректный запрос подключения CRM.",
    "The CRM connection status could not be changed. Access may have been denied.":
      "Не удалось изменить состояние подключения CRM. Возможно, доступ запрещён.",
    "Connection marked as disconnected.":
      "Подключение отмечено как отключённое.",
    "Connection returned to draft.": "Подключение возвращено в черновик.",
    "The CRM connection could not be deleted. Access may have been denied.":
      "Не удалось удалить подключение CRM. Возможно, доступ запрещён.",
    "Connect": "Подключить",
    "Connect YCLIENTS": "Подключить YCLIENTS",
    "Redirecting to YCLIENTS…": "Переходим в YCLIENTS…",
    "Connect through the official YCLIENTS marketplace. API activation follows in a later step.":
      "Подключитесь через официальный маркетплейс YCLIENTS. Активация API будет выполнена на следующем этапе.",
    "You will be redirected to the official YCLIENTS marketplace. No API token is requested on this page.":
      "Вы перейдёте в официальный маркетплейс YCLIENTS. На этой странице не запрашиваются API-токены.",
    "The YCLIENTS connection request is invalid.":
      "Запрос на подключение YCLIENTS недействителен.",
    "The YCLIENTS connection could not be started. Check organization access and try again.":
      "Не удалось начать подключение YCLIENTS. Проверьте доступ к организации и повторите попытку.",
    "Activation required": "Требуется активация",
    "YCLIENTS callback received": "Ответ YCLIENTS получен",
    "The salon was confirmed by the marketplace redirect. Nexora has not activated API access yet.":
      "Салон подтверждён переходом из маркетплейса. Orqelio ещё не активировал доступ к API.",
    "Salon ID": "ID салона",
    "Waiting for confirmation": "Ожидает подтверждения",
    "Connection is waiting for confirmation":
      "Подключение ожидает подтверждения",
    "Complete the marketplace step in YCLIENTS. This request expires after 10 minutes.":
      "Завершите подключение в маркетплейсе YCLIENTS. Запрос истечёт через 10 минут.",
    "The YCLIENTS callback could not be completed. The request may be missing, expired, reused, or invalid.":
      "Не удалось завершить подключение YCLIENTS. Запрос отсутствует, истёк, уже использован или недействителен.",
    "The YCLIENTS callback could not be completed. Open your organization and try again.":
      "Не удалось завершить подключение YCLIENTS. Откройте организацию и повторите попытку.",
    "The YCLIENTS marketplace identifies the salon. API activation is a separate future step.":
      "Маркетплейс YCLIENTS определяет салон. Активация API будет отдельным следующим этапом.",
    "Authentication required": "Требуется вход",
    "Sign in to continue connecting Altegio.":
      "Войдите, чтобы продолжить подключение Altegio.",
    "Altegio callback is invalid": "Некорректный ответ Altegio",
    "The location identifiers are missing or invalid. Return to Altegio and try again.":
      "Идентификаторы филиалов отсутствуют или недействительны. Вернитесь в Altegio и повторите попытку.",
    "Organization access required": "Требуется доступ к организации",
    "You need owner or administrator access to an organization before connecting Altegio.":
      "Для подключения Altegio нужен доступ владельца или администратора хотя бы к одной организации.",
    "Open organizations": "Открыть организации",
    "Altegio locations received": "Филиалы Altegio получены",
    "The marketplace returned these location identifiers. Orqelio has not activated the integration or connected to the Altegio API.":
      "Маркетплейс передал эти идентификаторы филиалов. Orqelio ещё не активировал интеграцию и не подключался к API Altegio.",
    "Altegio returned the selected locations to Orqelio. Final activation is not completed yet, and Orqelio has not connected to the Altegio API.":
      "Altegio вернул выбранные филиалы в Orqelio. Финальная активация ещё не завершена, и Orqelio не подключался к API Altegio.",
    "Activation and data synchronization are not enabled yet.":
      "Активация и синхронизация данных пока не включены.",
    "Open integrations": "Открыть интеграции",
    "Altegio activation failed": "Не удалось активировать Altegio",
    "Altegio returned a safe provider error. You can retry while the authorization window is open.":
      "Altegio вернула ошибку. Пока окно авторизации открыто, можно безопасно повторить попытку.",
    "Altegio authorization expired": "Срок авторизации Altegio истёк",
    "Start the connection again from integrations to receive a new authorization window.":
      "Запустите подключение заново в разделе интеграций, чтобы получить новое окно авторизации.",
    "Altegio activation is in progress": "Активация Altegio выполняется",
    "Orqelio is activating and verifying the selected locations.":
      "Orqelio активирует и проверяет доступ к выбранным филиалам.",
    "Altegio callback does not match": "Ответ Altegio не соответствует попытке",
    "This callback does not match the selected organization or connection attempt.":
      "Этот ответ не соответствует выбранной организации или попытке подключения.",
    "Altegio activation is partially complete": "Altegio активирована частично",
    "Some locations were verified and some require a safe retry.":
      "Часть филиалов проверена, для остальных требуется безопасная повторная попытка.",
    "Altegio callback was already used": "Ответ Altegio уже использован",
    "This one-time callback has already been processed. Open integrations to view the current state.":
      "Этот одноразовый ответ уже обработан. Откройте интеграции, чтобы посмотреть текущее состояние.",
    "Altegio activation completed": "Активация Altegio завершена",
    "All selected locations were activated and access was verified.":
      "Все выбранные филиалы активированы, доступ к ним проверен.",
    "Altegio activation is unavailable": "Активация Altegio недоступна",
    "The connection attempt could not be verified. Start again from integrations.":
      "Не удалось проверить попытку подключения. Запустите её заново из раздела интеграций.",
    "Verified locations": "Проверенные филиалы",
    "Locations requiring attention": "Филиалы, требующие внимания",
    "Retry activation": "Повторить активацию",
    "Altegio locations were activated and API access was verified.":
      "Филиалы Altegio активированы, доступ к API проверен.",
    "Altegio activation is incomplete or requires attention.":
      "Активация Altegio не завершена или требует внимания.",
    "Altegio activation and API access are not implemented yet.":
      "Активация Altegio и доступ к API пока не реализованы.",
    "AI administrator": "AI-администратор",
    "Public navigation": "Навигация по сайту",
    "Start free": "Начать бесплатно",
    "AI administrator for appointment businesses":
      "AI-администратор для бизнеса по записи",
    "An AI administrator that answers clients and books them 24/7":
      "AI-администратор, который отвечает клиентам и записывает их 24/7",
    "Orqelio talks to clients in messengers, advises on services, finds available time, and creates a booking in your system without replacing the CRM you already use.":
      "Orqelio общается с клиентами в мессенджерах, консультирует по услугам, находит свободное время и создаёт запись в вашей системе — без замены привычной CRM.",
    "See how it works": "Посмотреть, как это работает",
    "For beauty salons, barbershops, clinics, SPA, and other appointment-based businesses.":
      "Для салонов красоты, барбершопов, клиник, SPA и других бизнесов по записи.",
    "Booking confirmed": "Запись подтверждена",
    "Client": "Клиент",
    "Hello, I would like to book a coloring appointment tomorrow.":
      "Здравствуйте, хочу записаться на окрашивание завтра.",
    "Illustration of the planned experience. Messaging and AI booking are not publicly launched yet.":
      "Иллюстрация планируемого сценария. Мессенджеры и AI-запись ещё не запущены публично.",
    "Planned experience": "Планируемый сценарий",
    "Of course. Tomorrow there is availability at 14:00 and 17:30. Which time works for you?":
      "Конечно. Завтра свободно в 14:00 и 17:30. Какое время вам подходит?",
    "Coloring": "Окрашивание",
    "Tomorrow at 17:30": "Завтра, 17:30",
    "Benefits": "Преимущества",
    "Less waiting in every client conversation":
      "Меньше ожидания в каждом диалоге с клиентом",
    "Clients do not wait for an administrator to reply.":
      "Клиенты не ждут ответа администратора.",
    "Responds instantly": "Отвечает мгновенно",
    "Orqelio checks services, staff, and available slots in the connected system.":
      "Orqelio проверяет услуги, сотрудников и свободные слоты в подключённой системе.",
    "Books accurately": "Записывает без ошибок",
    "New requests can be handled in the evening, at night, and on weekends.":
      "Новые обращения могут обрабатываться вечером, ночью и в выходные.",
    "Works around the clock": "Работает круглосуточно",
    "Planned workflow": "Планируемый процесс",
    "How Orqelio will work": "Как будет работать Orqelio",
    "These stages describe the planned process after the corresponding integrations are launched.":
      "Эти этапы описывают планируемый процесс после запуска соответствующих интеграций.",
    "Connect your booking system": "Подключаете систему записи",
    "Configure your business information":
      "Настраиваете информацию о бизнесе",
    "Connect a messaging channel": "Подключаете мессенджер",
    "Orqelio starts answering and booking clients":
      "Orqelio начинает отвечать и записывать клиентов",
    "Foundation available": "Основа доступна",
    "Planned": "Запланировано",
    "For service businesses": "Для сервисного бизнеса",
    "Built for teams that work by appointment":
      "Для команд, которые работают по записи",
    "Beauty salons": "Салоны красоты",
    "Barbershops": "Барбершопы",
    "Nail studios": "Ногтевые студии",
    "Cosmetology and clinics": "Косметологии и клиники",
    "SPA and massage": "SPA и массаж",
    "Grooming and wellness": "Груминг и wellness",
    "Works with your existing system": "Работает с вашей системой",
    "Does not replace your system — makes it smarter":
      "Не заменяет вашу систему — делает её умнее",
    "Services, staff, schedules, and bookings stay in your booking platform. Orqelio works on top of it and takes care of client communication.":
      "Услуги, сотрудники, расписание и записи остаются в вашей booking-платформе. Orqelio работает поверх неё и берёт на себя общение с клиентами.",
    "Prepare your business for automatic client booking":
      "Подготовьте бизнес к автоматической записи клиентов",
    "Create an organization and connect your first booking system.":
      "Создайте организацию и подключите первую систему записи.",
    "Start setup": "Начать настройку",
    "AI administrator for appointment-based businesses in Kazakhstan.":
      "AI-администратор для бизнеса по записи в Казахстане.",
    "Home": "Главная",
    "Settings": "Настройки",
    "Owner": "Владелец",
    "Admin": "Администратор",
    "Operational dashboard": "Рабочая панель",
    "Connect systems and prepare Orqelio to work with customers.":
      "Подключите системы и подготовьте Orqelio к работе с клиентами.",
    "Setup progress": "Прогресс настройки",
    "steps completed": "этапов завершено",
    "Organization created": "Организация создана",
    "Altegio connected": "Altegio подключена",
    "Services and staff imported": "Услуги и сотрудники импортированы",
    "AI manager configured": "AI-менеджер настроен",
    "Messaging channel connected": "Канал сообщений подключён",
    "Orqelio launched": "Orqelio запущена",
    "Soon": "Скоро",
    "Next available action": "Следующее доступное действие",
    "Review your integration": "Проверьте интеграцию",
    "Altegio is connected. Future setup stages will become available as they are implemented.":
      "Altegio подключена. Следующие этапы настройки станут доступны после их реализации.",
    "Start with Altegio so Orqelio can use your existing business system when activation becomes available.":
      "Начните с Altegio, чтобы Orqelio могла использовать вашу рабочую систему после появления активации.",
    "Connected": "Подключено",
    "Connection error": "Ошибка подключения",
    "Connection incomplete": "Подключение не завершено",
    "Not connected": "Не подключено",
    "Paused": "Приостановлено",
    "A connected Altegio CRM record exists for this organization.":
      "Для этой организации существует подключённая CRM-запись Altegio.",
    "The saved Altegio connection is marked with an error.":
      "Сохранённое подключение Altegio отмечено ошибкой.",
    "The Altegio connection still requires setup.":
      "Подключение Altegio ещё требует настройки.",
    "Altegio has not been added to this organization.":
      "Altegio ещё не добавлена в эту организацию.",
    "The saved Altegio connection is marked as disconnected.":
      "Сохранённое подключение Altegio отмечено как отключённое.",
    "Continue connection": "Продолжить подключение",
    "Status reflects the saved CRM connection only and does not claim live API health.":
      "Статус отражает только сохранённое состояние CRM-подключения и не подтверждает доступность API.",
    "Organization summary": "Сводка организации",
    "Organization": "Организация",
    "Your role": "Ваша роль",
    "Team members": "Участники организации",
    "Altegio status": "Статус Altegio",
    "Quick actions": "Быстрые действия",
    "Open the organization areas available today.":
      "Перейдите в доступные разделы организации.",
    "Manage CRM connections and provider setup.":
      "Управляйте CRM-подключениями и настройкой провайдеров.",
    "Invite and manage organization administrators.":
      "Приглашайте администраторов организации и управляйте ими.",
    "Only the organization owner can manage administrators.":
      "Управлять администраторами может только владелец организации.",
    "Update the organization name and workspace address.":
      "Измените название организации и адрес рабочего пространства.",
    "AI manager": "AI-менеджер",
    "Activity history": "История действий",
    "Configure AI manager": "Настроить AI-менеджера",
    "Configure communication and human handoff rules.":
      "Настройте общение и правила передачи диалога человеку.",
    "Altegio and AI manager settings are ready. Review your integration when needed.":
      "Altegio и настройки AI-менеджера готовы. При необходимости проверьте интеграцию.",
    "Add business context and handoff rules before Orqelio starts working with customers.":
      "Добавьте контекст о бизнесе и правила передачи диалога до начала работы Orqelio с клиентами.",
    "Messages": "Сообщения",
    "Analytics": "Аналитика",
    "Language": "Язык",
    "Русский": "Русский",
    "Қазақша": "Қазақша",
  },
  kk: {
    "AI Manager": "ЖИ-менеджер",
    "Authentication": "Аутентификация",
    "Sign in": "Кіру",
    "Get started": "Бастау",
    "Built around your existing systems": "Қолданыстағы жүйелеріңізбен жұмыс істейді",
    "An AI manager, not another CRM.": "Тағы бір CRM емес, ЖИ-менеджер.",
    "Orqelio is designed to work on top of the CRM a business already trusts, connecting customer conversations with operational data without replacing the source of truth.":
      "Orqelio — бизнес сенетін CRM жүйесінің үстінде жұмыс істейтін ЖИ-менеджер: негізгі дереккөзді алмастырмай, клиенттермен диалогтарды операциялық деректермен байланыстырады.",
    "Project foundation is ready": "Жоба негізі дайын",
    "Page not found": "Бет табылмады",
    "The requested page does not exist or you do not have access to it.":
      "Сұралған бет жоқ немесе оған кіруге рұқсатыңыз жоқ.",
    "Return to home": "Басты бетке оралу",
    "Use your email and password to continue to Orqelio.":
      "Orqelio-да жұмысты жалғастыру үшін электрондық поштаңыз бен құпиясөзіңізді енгізіңіз.",
    "New to Orqelio?": "Orqelio-ны алғаш рет қолданып тұрсыз ба?",
    "Create an account": "Тіркелгі жасау",
    "Welcome back": "Қайта оралғаныңызға қуаныштымыз",
    "The authentication link is invalid or expired. Try again.":
      "Аутентификация сілтемесі жарамсыз немесе мерзімі өткен. Қайталап көріңіз.",
    "Forgot your password?": "Құпиясөзді ұмыттыңыз ба?",
    "Create the account that will manage your Orqelio access.":
      "Orqelio-ға кіруді басқаратын тіркелгі жасаңыз.",
    "Already have an account?": "Тіркелгіңіз бар ма?",
    "Create your account": "Тіркелгі жасау",
    "Enter your email and we will send password reset instructions if the account exists.":
      "Электрондық поштаңызды енгізіңіз. Тіркелгі бар болса, құпиясөзді қалпына келтіру нұсқаулығын жібереміз.",
    "Return to sign in": "Кіру бетіне оралу",
    "Reset your password": "Құпиясөзді қалпына келтіру",
    "Choose a new password for your account.":
      "Тіркелгіңізге жаңа құпиясөз таңдаңыз.",
    "Update password": "Құпиясөзді жаңарту",
    "Send reset link": "Сілтемені жіберу",
    "Create account": "Тіркелгі жасау",
    "Please wait…": "Күте тұрыңыз…",
    "Email": "Электрондық пошта",
    "New password": "Жаңа құпиясөз",
    "Password": "Құпиясөз",
    "Confirm password": "Құпиясөзді растаңыз",
    "Signing out…": "Шығуда…",
    "Sign out": "Шығу",
    "Protected application": "Қорғалған қолданба",
    "Your password has been updated.": "Құпиясөз сәтті жаңартылды.",
    "Sign out could not be completed. Try again.":
      "Жүйеден шығу мүмкін болмады. Қайталап көріңіз.",
    "Organizations": "Ұйымдар",
    "Choose your organization": "Ұйымды таңдаңыз",
    "You are authenticated as": "Сіз мына пайдаланушы ретінде кірдіңіз:",
    "an authenticated user": "аутентификацияланған пайдаланушы",
    "You do not belong to an organization yet.":
      "Сіз әзірге ешбір ұйымға кірмейсіз.",
    "Create an organization": "Ұйым құру",
    "You will become its owner automatically.":
      "Сіз автоматты түрде оның иесі боласыз.",
    "Organization name": "Ұйым атауы",
    "Slug": "Ұйым мекенжайы",
    "Saving…": "Сақталуда…",
    "Create organization": "Ұйым құру",
    "Save settings": "Баптауларды сақтау",
    "Overview": "Шолу",
    "Integrations": "Интеграциялар",
    "Administrators": "Әкімшілер",
    "← All organizations": "← Барлық ұйымдар",
    "Organization workspace": "Ұйымның жұмыс кеңістігі",
    "owner": "иесі",
    "admin": "әкімші",
    "Workspace overview": "Жұмыс кеңістігіне шолу",
    "This page is loaded only after Supabase RLS and a server-side membership query authorize access.":
      "Бұл бетке кіру Supabase RLS саясаттары және мүшелікті серверлік тексеру арқылы расталғаннан кейін ғана жүктеледі.",
    "Organization settings": "Ұйым баптаулары",
    "Owners and admins may update operational organization fields.":
      "Иесі мен әкімшілер ұйымның жұмыс деректерін өзгерте алады.",
    "Owner settings": "Иесі баптаулары",
    "Invite administrators with a one-time link and remove active administrators. Only organization owners can access this page.":
      "Әкімшілерді бір реттік сілтемемен шақырып, белсенді әкімшілерді жойыңыз. Бұл бет тек ұйым иесіне қолжетімді.",
    "Administrator settings could not be loaded. Try again later.":
      "Әкімші баптауларын жүктеу мүмкін болмады. Кейінірек қайталап көріңіз.",
    "Invite an administrator": "Әкімшіні шақыру",
    "The link expires after seven days. Orqelio stores only its cryptographic hash, so copy it immediately.":
      "Сілтеме жеті күн жарамды. Orqelio оның криптографиялық хешін ғана сақтайды, сондықтан бірден көшіріп алыңыз.",
    "Active administrators": "Белсенді әкімшілер",
    "Added": "Қосылды",
    "No active administrators.": "Белсенді әкімшілер жоқ.",
    "Invitation history": "Шақырулар тарихы",
    "Expires": "Мерзімі:",
    "Created": "Жасалды",
    "pending": "күтуде",
    "accepted": "қабылданды",
    "expired": "мерзімі өтті",
    "revoked": "қайтарылды",
    "No invitations have been created.": "Шақырулар әлі жасалмаған.",
    "Administrator email": "Әкімшінің электрондық поштасы",
    "One-time invitation link": "Бір реттік шақыру сілтемесі",
    "Copied": "Көшірілді",
    "Copy link": "Сілтемені көшіру",
    "Creating…": "Жасалуда…",
    "Create invitation": "Шақыру жасау",
    "Working…": "Орындалуда…",
    "Revoke": "Қайтарып алу",
    "Remove": "Жою",
    "Invitation unavailable": "Шақыру қолжетімсіз",
    "This invitation link is invalid. Ask the organization owner for a new link.":
      "Бұл шақыру сілтемесі жарамсыз. Ұйым иесінен жаңа сілтеме сұраңыз.",
    "Administrator invitation": "Әкімші шақыруы",
    "Join an organization in Orqelio": "Orqelio ұйымына қосылу",
    "Sign in or create an account with the exact email address that received this invitation.":
      "Шақыру жіберілген электрондық пошта мекенжайымен кіріңіз немесе тіркелгі жасаңыз.",
    "Signed in as": "Сіз мына пайдаланушы ретінде кірдіңіз:",
    "The invitation can be accepted only if this email matches.":
      "Шақыруды электрондық пошта мекенжайы сәйкес келгенде ғана қабылдауға болады.",
    "Accepting…": "Қабылдануда…",
    "Accept administrator invitation": "Әкімші шақыруын қабылдау",
    "Connect Orqelio to external systems without copying their operational data into this workspace.":
      "Операциялық деректерді осы жұмыс кеңістігіне көшірмей, Orqelio-ны сыртқы жүйелерге қосыңыз.",
    "Create and manage provider-neutral CRM connection metadata. A real CRM adapter has not been selected or implemented.":
      "Провайдерге тәуелсіз CRM қосылымдарын жасаңыз және басқарыңыз. Нақты CRM адаптері әлі таңдалмаған және іске асырылмаған.",
    "CRM connections": "CRM қосылымдары",
    "Your CRM connections": "CRM қосылымдарыңыз",
    "Manage the CRM connections available to this organization. The external CRM remains the source of truth.":
      "Осы ұйымның CRM қосылымдарын басқарыңыз. Сыртқы CRM негізгі дереккөз болып қалады.",
    "Provider:": "Провайдер:",
    "Edit": "Өзгерту",
    "No connections yet": "Қосылымдар әлі жоқ",
    "Choose the development connection below to prepare the integration boundary.":
      "Интеграция қабатын дайындау үшін төмендегі әзірлеу қосылымын таңдаңыз.",
    "Choose an available provider below to start a connection.":
      "Қосылымды бастау үшін төмендегі қолжетімді провайдерді таңдаңыз.",
    "Connect a new CRM": "Жаңа CRM қосу",
    "Choose a provider. Production integrations will become available after their adapters are implemented and verified.":
      "Провайдерді таңдаңыз. Жұмыс интеграциялары адаптерлері іске асырылып, тексерілгеннен кейін қолжетімді болады.",
    "Official integration": "Ресми интеграция",
    "Coming soon": "Жақында",
    "Agreement in progress": "Келісу процесінде",
    "DIKIDI integration is planned. After connection, Orqelio will be able to use the business services, staff, schedule, and bookings.":
      "DIKIDI интеграциясы жоспарланып отыр. Қосылғаннан кейін Orqelio бизнестің қызметтерін, қызметкерлерін, кестесін және жазбаларын пайдалана алады.",
    "API access is being coordinated with DIKIDI.":
      "DIKIDI-мен API рұқсаты келісілуде",
    "YCLIENTS integration is planned and cannot be connected yet.":
      "YCLIENTS интеграциясы жоспарланған, бірақ әзірге қосу мүмкін емес.",
    "Altegio integration is planned and cannot be connected yet.":
      "Altegio интеграциясы жоспарланған, бірақ әзірге қосу мүмкін емес.",
    "Connect Altegio": "Altegio-ны қосу",
    "Connect integration": "Интеграцияны қосу",
    "Redirecting to Altegio…": "Altegio-ға өтуде…",
    "You will be redirected to Altegio to choose one or more locations and confirm access. After confirmation, Altegio will return you to Orqelio.":
      "Сіз Altegio-ға өтіп, бір немесе бірнеше филиалды таңдап, қолжетімділікті растайсыз. Растаудан кейін Altegio сізді Orqelio-ға қайтарады.",
    "The Altegio connection request is invalid.":
      "Altegio қосылым сұрауы жарамсыз.",
    "The Altegio connection could not be started. Check organization access and try again.":
      "Altegio қосылымын бастау мүмкін болмады. Ұйымға кіру құқығын тексеріп, қайталап көріңіз.",
    "Configure": "Баптау",
    "Development only": "Тек әзірлеуге арналған",
    "Development connection": "Әзірлеу қосылымы",
    "Create a non-secret test connection for developing the integration foundation.":
      "Интеграция негізін әзірлеу үшін құпия деректерсіз сынақ қосылымын жасаңыз.",
    "Development CRM connection": "Әзірлеуге арналған CRM қосылымы",
    "Create a non-secret development connection. This does not contact or connect to any real CRM provider.":
      "Құпия деректерсіз әзірлеу қосылымын жасаңыз. Ол нақты CRM провайдеріне хабарласпайды және қосылмайды.",
    "Workspace reference (optional)":
      "Жұмыс кеңістігінің идентификаторы (міндетті емес)",
    "Create development connection": "Әзірлеу қосылымын жасау",
    "Foundation": "Негіз",
    "Open integration →": "Интеграцияны ашу →",
    "← Integrations": "← Интеграциялар",
    "These records are placeholders for future provider adapters. The external CRM remains the source of truth.":
      "Бұл жазбалар болашақ провайдер адаптерлеріне арналған. Сыртқы CRM негізгі дереккөз болып қалады.",
    "New CRM connection": "Жаңа CRM қосылымы",
    "CRM connection deleted.": "CRM қосылымы жойылды.",
    "Provider: Custom placeholder": "Провайдер: сынақ үлгісі",
    "Last sync:": "Соңғы синхрондау:",
    "Never": "Ешқашан",
    "connected": "қосылған",
    "disconnected": "ажыратылған",
    "draft": "жоба",
    "error": "қате",
    "No CRM connections": "CRM қосылымдары жоқ",
    "Create a placeholder record to prepare the integration boundary.":
      "Интеграция қабатын дайындау үшін үлгі жазба жасаңыз.",
    "← CRM connections": "← CRM қосылымдары",
    "Create a non-secret placeholder. This does not contact or connect to any real CRM provider.":
      "Құпия дерексіз үлгі жасаңыз. Ол нақты CRM провайдеріне хабарласпайды және қосылмайды.",
    "Custom placeholder": "Сынақ үлгісі",
    "Connection settings": "Қосылым баптаулары",
    "Only controlled, non-secret placeholder configuration is stored.":
      "Тек бақыланатын, құпия емес үлгі баптаулары сақталады.",
    "Connection name": "Қосылым атауы",
    "Primary CRM": "Негізгі CRM",
    "External workspace reference": "Сыртқы жұмыс кеңістігінің идентификаторы",
    "Optional non-secret identifier. Never enter API keys, tokens, or passwords.":
      "Міндетті емес құпия емес идентификатор. API кілттерін, токендерді немесе құпиясөздерді ешқашан енгізбеңіз.",
    "Provider region": "Провайдер аймағы",
    "Not specified": "Көрсетілмеген",
    "Global": "Жаһандық",
    "Europe": "Еуропа",
    "United States": "АҚШ",
    "Asia Pacific": "Азия-Тынық мұхиты",
    "Create placeholder connection": "Үлгі қосылымын жасау",
    "Save connection settings": "Қосылым баптауларын сақтау",
    "Connection lifecycle": "Қосылым күйі",
    "No real CRM adapter exists yet. Orqelio will not mark this placeholder as connected without a verified provider response.":
      "Нақты CRM адаптері әлі жоқ. Orqelio провайдердің расталған жауабынсыз бұл үлгіні қосылған деп белгілемейді.",
    "Connect provider — not available yet":
      "Провайдерді қосу — әзірге қолжетімсіз",
    "Updating…": "Жаңартылуда…",
    "Return to draft": "Жоба күйіне қайтару",
    "Mark as disconnected": "Ажыратылған деп белгілеу",
    "Delete connection": "Қосылымды жою",
    "This removes only this Orqelio connection record. It does not modify any external CRM.":
      "Тек Orqelio-дағы осы қосылым жазбасы жойылады. Сыртқы CRM өзгермейді.",
    "Deleting…": "Жойылуда…",
    "Enter a valid email address.": "Жарамды электрондық пошта мекенжайын енгізіңіз.",
    "Check the highlighted field.": "Белгіленген өрісті тексеріңіз.",
    "Enter your password.": "Құпиясөзді енгізіңіз.",
    "Check the highlighted fields.": "Белгіленген өрістерді тексеріңіз.",
    "Use 8 to 128 characters.": "8-ден 128-ге дейін таңба қолданыңыз.",
    "Confirm your password.": "Құпиясөзді растаңыз.",
    "Passwords do not match.": "Құпиясөздер сәйкес келмейді.",
    "If an account exists and email delivery is available, a password reset link is on its way. If you requested one recently, wait a few minutes before trying again.":
      "Тіркелгі бар және пошта жіберу қолжетімді болса, құпиясөзді қалпына келтіру сілтемесі жіберілді. Жақында сұратсаңыз, бірнеше минут күтіңіз.",
    "Sign in is temporarily unavailable. Try again.":
      "Кіру уақытша қолжетімсіз. Қайталап көріңіз.",
    "Email or password is incorrect.":
      "Электрондық пошта немесе құпиясөз қате.",
    "Unable to sign in. Try again.":
      "Кіру мүмкін болмады. Қайталап көріңіз.",
    "Account creation is temporarily unavailable.":
      "Тіркелгі жасау уақытша қолжетімсіз.",
    "Unable to create the account. Check your details or try again later.":
      "Тіркелгіні жасау мүмкін болмады. Деректерді тексеріңіз немесе кейінірек қайталап көріңіз.",
    "Check your email to confirm your address and finish creating your account.":
      "Поштаңызды тексеріп, мекенжайды растаңыз және тіркелгі жасауды аяқтаңыз.",
    "This recovery session is invalid or expired. Request a new reset link.":
      "Қалпына келтіру сеансы жарамсыз немесе мерзімі өткен. Жаңа сілтеме сұратыңыз.",
    "Password update is temporarily unavailable.":
      "Құпиясөзді жаңарту уақытша қолжетімсіз.",
    "Unable to update the password. Request a new reset link and try again.":
      "Құпиясөзді жаңарту мүмкін болмады. Жаңа сілтеме сұратып, қайталап көріңіз.",
    "Enter an organization name.": "Ұйым атауын енгізіңіз.",
    "Organization name must be 100 characters or fewer.":
      "Ұйым атауы 100 таңбадан аспауы керек.",
    "Slug must be at least 3 characters.":
      "Ұйым мекенжайы кемінде 3 таңбадан тұруы керек.",
    "Slug must be 63 characters or fewer.":
      "Ұйым мекенжайы 63 таңбадан аспауы керек.",
    "Use lowercase letters, numbers, and single hyphens.":
      "Кіші латын әріптерін, сандарды және дара дефистерді қолданыңыз.",
    "Your session has expired. Sign in and try again.":
      "Сеанс мерзімі аяқталды. Кіріп, қайталап көріңіз.",
    "This organization slug is already in use.":
      "Бұл ұйым мекенжайы қолданыста.",
    "The organization could not be created. Try again later.":
      "Ұйымды құру мүмкін болмады. Кейінірек қайталап көріңіз.",
    "The organization could not be updated. Try again later.":
      "Ұйымды жаңарту мүмкін болмады. Кейінірек қайталап көріңіз.",
    "Organization not found or access was denied.":
      "Ұйым табылмады немесе кіруге тыйым салынды.",
    "Organization settings saved.": "Ұйым баптаулары сақталды.",
    "Email address is too long.": "Электрондық пошта мекенжайы тым ұзын.",
    "An active invitation already exists, or this user is already a member.":
      "Белсенді шақыру бар немесе пайдаланушы ұйымның мүшесі.",
    "The invitation could not be created. Check owner access and try again.":
      "Шақыруды жасау мүмкін болмады. Иесінің құқығын тексеріп, қайталап көріңіз.",
    "Invitation created. Copy this link now; it cannot be shown again.":
      "Шақыру жасалды. Сілтемені қазір көшіріңіз — оны қайта көрсету мүмкін емес.",
    "The invitation request is invalid.": "Шақыру сұрауы жарамсыз.",
    "The invitation could not be revoked. It may no longer be pending.":
      "Шақыруды қайтарып алу мүмкін болмады. Ол енді күту күйінде болмауы мүмкін.",
    "Invitation revoked.": "Шақыру қайтарылды.",
    "The administrator request is invalid.": "Әкімші сұрауы жарамсыз.",
    "The administrator could not be removed. Check owner access and try again.":
      "Әкімшіні жою мүмкін болмады. Иесінің құқығын тексеріп, қайталап көріңіз.",
    "Administrator removed.": "Әкімші жойылды.",
    "Invitation link is invalid.": "Шақыру сілтемесі жарамсыз.",
    "Sign in or create an account before accepting.":
      "Шақыруды қабылдамас бұрын кіріңіз немесе тіркелгі жасаңыз.",
    "This invitation is invalid, expired, revoked, already used, or belongs to another email.":
      "Шақыру жарамсыз, мерзімі өткен, қайтарылған, қолданылған немесе басқа электрондық поштаға арналған.",
    "Enter a connection name.": "Қосылым атауын енгізіңіз.",
    "Connection name must be 100 characters or fewer.":
      "Қосылым атауы 100 таңбадан аспауы керек.",
    "Workspace reference must be 100 characters or fewer.":
      "Жұмыс кеңістігінің идентификаторы 100 таңбадан аспауы керек.",
    "Use letters, numbers, underscores, or hyphens.":
      "Латын әріптерін, сандарды, астын сызу немесе дефис таңбаларын қолданыңыз.",
    "The CRM connection could not be created. Check organization access and try again.":
      "CRM қосылымын жасау мүмкін болмады. Ұйымға кіруді тексеріп, қайталап көріңіз.",
    "The CRM connection could not be updated. Access may have been denied.":
      "CRM қосылымын жаңарту мүмкін болмады. Кіруге тыйым салынуы мүмкін.",
    "Connection settings saved.": "Қосылым баптаулары сақталды.",
    "The CRM connection request is invalid.": "CRM қосылым сұрауы жарамсыз.",
    "The CRM connection status could not be changed. Access may have been denied.":
      "CRM қосылым күйін өзгерту мүмкін болмады. Кіруге тыйым салынуы мүмкін.",
    "Connection marked as disconnected.":
      "Қосылым ажыратылған деп белгіленді.",
    "Connection returned to draft.": "Қосылым жоба күйіне қайтарылды.",
    "The CRM connection could not be deleted. Access may have been denied.":
      "CRM қосылымын жою мүмкін болмады. Кіруге тыйым салынуы мүмкін.",
    "Connect": "Қосу",
    "Connect YCLIENTS": "YCLIENTS-ті қосу",
    "Redirecting to YCLIENTS…": "YCLIENTS-ке өтуде…",
    "Connect through the official YCLIENTS marketplace. API activation follows in a later step.":
      "Ресми YCLIENTS маркетплейсі арқылы қосылыңыз. API белсендіру келесі кезеңде орындалады.",
    "You will be redirected to the official YCLIENTS marketplace. No API token is requested on this page.":
      "Сіз ресми YCLIENTS маркетплейсіне өтесіз. Бұл бетте API токендері сұралмайды.",
    "The YCLIENTS connection request is invalid.":
      "YCLIENTS қосылым сұрауы жарамсыз.",
    "The YCLIENTS connection could not be started. Check organization access and try again.":
      "YCLIENTS қосылымын бастау мүмкін болмады. Ұйымға кіру құқығын тексеріп, қайталап көріңіз.",
    "Activation required": "Белсендіру қажет",
    "YCLIENTS callback received": "YCLIENTS жауабы алынды",
    "The salon was confirmed by the marketplace redirect. Nexora has not activated API access yet.":
      "Салон маркетплейстен қайта бағыттау арқылы расталды. Orqelio API рұқсатын әлі белсендірген жоқ.",
    "Salon ID": "Салон ID-і",
    "Waiting for confirmation": "Растауды күтуде",
    "Connection is waiting for confirmation":
      "Қосылым растауды күтуде",
    "Complete the marketplace step in YCLIENTS. This request expires after 10 minutes.":
      "YCLIENTS маркетплейсіндегі қадамды аяқтаңыз. Сұрау 10 минуттан кейін аяқталады.",
    "The YCLIENTS callback could not be completed. The request may be missing, expired, reused, or invalid.":
      "YCLIENTS қосылымын аяқтау мүмкін болмады. Сұрау жоқ, мерзімі өткен, қайта қолданылған немесе жарамсыз болуы мүмкін.",
    "The YCLIENTS callback could not be completed. Open your organization and try again.":
      "YCLIENTS қосылымын аяқтау мүмкін болмады. Ұйымыңызды ашып, қайталап көріңіз.",
    "The YCLIENTS marketplace identifies the salon. API activation is a separate future step.":
      "YCLIENTS маркетплейсі салонды анықтайды. API белсендіру кейінгі бөлек кезең болады.",
    "Authentication required": "Кіру қажет",
    "Sign in to continue connecting Altegio.":
      "Altegio қосылымын жалғастыру үшін жүйеге кіріңіз.",
    "Altegio callback is invalid": "Altegio жауабы жарамсыз",
    "The location identifiers are missing or invalid. Return to Altegio and try again.":
      "Филиал идентификаторлары жоқ немесе жарамсыз. Altegio-ға оралып, қайталап көріңіз.",
    "Organization access required": "Ұйымға кіру қажет",
    "You need owner or administrator access to an organization before connecting Altegio.":
      "Altegio-ны қосу үшін кемінде бір ұйымға иесі немесе әкімшісі ретінде кіру қажет.",
    "Open organizations": "Ұйымдарды ашу",
    "Altegio locations received": "Altegio филиалдары алынды",
    "The marketplace returned these location identifiers. Orqelio has not activated the integration or connected to the Altegio API.":
      "Маркетплейс осы филиал идентификаторларын жіберді. Orqelio интеграцияны әлі белсендірмеді және Altegio API-іне қосылмады.",
    "Altegio returned the selected locations to Orqelio. Final activation is not completed yet, and Orqelio has not connected to the Altegio API.":
      "Altegio таңдалған филиалдарды Orqelio-ға қайтарды. Соңғы белсендіру әлі аяқталған жоқ және Orqelio Altegio API-іне қосылмады.",
    "Activation and data synchronization are not enabled yet.":
      "Белсендіру және деректерді синхрондау әлі қосылмаған.",
    "Open integrations": "Интеграцияларды ашу",
    "Altegio activation failed": "Altegio белсендірілмеді",
    "Altegio returned a safe provider error. You can retry while the authorization window is open.":
      "Altegio қатені қайтарды. Авторизация терезесі ашық кезде қауіпсіз қайталап көруге болады.",
    "Altegio authorization expired": "Altegio авторизациясының мерзімі аяқталды",
    "Start the connection again from integrations to receive a new authorization window.":
      "Жаңа авторизация терезесін алу үшін интеграциялар бөлімінен қосылуды қайта бастаңыз.",
    "Altegio activation is in progress": "Altegio белсендіріліп жатыр",
    "Orqelio is activating and verifying the selected locations.":
      "Orqelio таңдалған филиалдарды белсендіріп, қолжетімділікті тексеріп жатыр.",
    "Altegio callback does not match": "Altegio жауабы әрекетке сәйкес емес",
    "This callback does not match the selected organization or connection attempt.":
      "Бұл жауап таңдалған ұйымға немесе қосылу әрекетіне сәйкес емес.",
    "Altegio activation is partially complete": "Altegio ішінара белсендірілді",
    "Some locations were verified and some require a safe retry.":
      "Кейбір филиалдар тексерілді, қалғандары үшін қауіпсіз қайталау қажет.",
    "Altegio callback was already used": "Altegio жауабы бұрын қолданылған",
    "This one-time callback has already been processed. Open integrations to view the current state.":
      "Бұл бір реттік жауап өңделген. Ағымдағы күйді көру үшін интеграцияларды ашыңыз.",
    "Altegio activation completed": "Altegio белсендіру аяқталды",
    "All selected locations were activated and access was verified.":
      "Барлық таңдалған филиалдар белсендіріліп, қолжетімділік тексерілді.",
    "Altegio activation is unavailable": "Altegio белсендіру қолжетімсіз",
    "The connection attempt could not be verified. Start again from integrations.":
      "Қосылу әрекетін тексеру мүмкін болмады. Интеграциялар бөлімінен қайта бастаңыз.",
    "Verified locations": "Тексерілген филиалдар",
    "Locations requiring attention": "Назар аударуды қажет ететін филиалдар",
    "Retry activation": "Белсендіруді қайталау",
    "Altegio locations were activated and API access was verified.":
      "Altegio филиалдары белсендіріліп, API қолжетімділігі тексерілді.",
    "Altegio activation is incomplete or requires attention.":
      "Altegio белсендіру аяқталмаған немесе назар аударуды қажет етеді.",
    "Altegio activation and API access are not implemented yet.":
      "Altegio белсендіруі және API қолжетімділігі әлі іске асырылмаған.",
    "AI administrator": "ЖИ-әкімші",
    "Public navigation": "Сайт навигациясы",
    "Start free": "Тегін бастау",
    "AI administrator for appointment businesses":
      "Жазылу арқылы жұмыс істейтін бизнеске арналған ЖИ-әкімші",
    "An AI administrator that answers clients and books them 24/7":
      "Клиенттерге жауап беріп, оларды тәулік бойы жазатын ЖИ-әкімші",
    "Orqelio talks to clients in messengers, advises on services, finds available time, and creates a booking in your system without replacing the CRM you already use.":
      "Orqelio клиенттермен мессенджерлерде сөйлеседі, қызметтер бойынша кеңес береді, бос уақытты табады және үйреншікті CRM-ді ауыстырмай, сіздің жүйеңізде жазба жасайды.",
    "See how it works": "Қалай жұмыс істейтінін көру",
    "For beauty salons, barbershops, clinics, SPA, and other appointment-based businesses.":
      "Сұлулық салондарына, барбершоптарға, клиникаларға, SPA және басқа да жазылу арқылы жұмыс істейтін бизнеске арналған.",
    "Booking confirmed": "Жазба расталды",
    "Client": "Клиент",
    "Hello, I would like to book a coloring appointment tomorrow.":
      "Сәлеметсіз бе, ертең шаш бояуға жазылғым келеді.",
    "Illustration of the planned experience. Messaging and AI booking are not publicly launched yet.":
      "Жоспарланған сценарийдің үлгісі. Мессенджерлер мен ЖИ арқылы жазу әлі жалпыға қолжетімді емес.",
    "Planned experience": "Жоспарланған сценарий",
    "Of course. Tomorrow there is availability at 14:00 and 17:30. Which time works for you?":
      "Әрине. Ертең сағат 14:00 және 17:30-да бос уақыт бар. Қай уақыт сізге ыңғайлы?",
    "Coloring": "Шаш бояу",
    "Tomorrow at 17:30": "Ертең, 17:30",
    "Benefits": "Артықшылықтар",
    "Less waiting in every client conversation":
      "Клиентпен әр диалогта күтуді азайтады",
    "Clients do not wait for an administrator to reply.":
      "Клиенттер әкімшінің жауабын күтпейді.",
    "Responds instantly": "Бірден жауап береді",
    "Orqelio checks services, staff, and available slots in the connected system.":
      "Orqelio қосылған жүйедегі қызметтерді, қызметкерлерді және бос уақыттарды тексереді.",
    "Books accurately": "Қатесіз жазады",
    "New requests can be handled in the evening, at night, and on weekends.":
      "Жаңа өтініштер кешке, түнде және демалыс күндері өңделе алады.",
    "Works around the clock": "Тәулік бойы жұмыс істейді",
    "Planned workflow": "Жоспарланған процесс",
    "How Orqelio will work": "Orqelio қалай жұмыс істейді",
    "These stages describe the planned process after the corresponding integrations are launched.":
      "Бұл кезеңдер тиісті интеграциялар іске қосылғаннан кейінгі жоспарланған процесті сипаттайды.",
    "Connect your booking system": "Жазылу жүйесін қосасыз",
    "Configure your business information": "Бизнес ақпаратын баптайсыз",
    "Connect a messaging channel": "Мессенджерді қосасыз",
    "Orqelio starts answering and booking clients":
      "Orqelio клиенттерге жауап беріп, оларды жаза бастайды",
    "Foundation available": "Негізі қолжетімді",
    "Planned": "Жоспарланған",
    "For service businesses": "Сервистік бизнеске арналған",
    "Built for teams that work by appointment":
      "Жазылу арқылы жұмыс істейтін командаларға арналған",
    "Beauty salons": "Сұлулық салондары",
    "Barbershops": "Барбершоптар",
    "Nail studios": "Тырнақ студиялары",
    "Cosmetology and clinics": "Косметология және клиникалар",
    "SPA and massage": "SPA және массаж",
    "Grooming and wellness": "Груминг және wellness",
    "Works with your existing system": "Қолданыстағы жүйеңізбен жұмыс істейді",
    "Does not replace your system — makes it smarter":
      "Жүйеңізді ауыстырмайды — оны ақылдырақ етеді",
    "Services, staff, schedules, and bookings stay in your booking platform. Orqelio works on top of it and takes care of client communication.":
      "Қызметтер, қызметкерлер, кесте және жазбалар booking-платформаңызда қалады. Orqelio оның үстінде жұмыс істеп, клиенттермен байланысты өз мойнына алады.",
    "Prepare your business for automatic client booking":
      "Бизнесті клиенттерді автоматты жазуға дайындаңыз",
    "Create an organization and connect your first booking system.":
      "Ұйым құрып, алғашқы жазылу жүйесін қосыңыз.",
    "Start setup": "Баптауды бастау",
    "AI administrator for appointment-based businesses in Kazakhstan.":
      "Қазақстандағы жазылу арқылы жұмыс істейтін бизнеске арналған ЖИ-әкімші.",
    "Home": "Басты бет",
    "Settings": "Баптаулар",
    "Owner": "Иесі",
    "Admin": "Әкімші",
    "Operational dashboard": "Жұмыс тақтасы",
    "Connect systems and prepare Orqelio to work with customers.":
      "Жүйелерді қосып, Orqelio-ны клиенттермен жұмыс істеуге дайындаңыз.",
    "Setup progress": "Баптау барысы",
    "steps completed": "кезең аяқталды",
    "Organization created": "Ұйым құрылды",
    "Altegio connected": "Altegio қосылды",
    "Services and staff imported": "Қызметтер мен қызметкерлер импортталды",
    "AI manager configured": "ЖИ-менеджер бапталды",
    "Messaging channel connected": "Хабар алмасу арнасы қосылды",
    "Orqelio launched": "Orqelio іске қосылды",
    "Soon": "Жақында",
    "Next available action": "Келесі қолжетімді әрекет",
    "Review your integration": "Интеграцияны тексеріңіз",
    "Altegio is connected. Future setup stages will become available as they are implemented.":
      "Altegio қосылды. Келесі баптау кезеңдері іске асырылғаннан кейін қолжетімді болады.",
    "Start with Altegio so Orqelio can use your existing business system when activation becomes available.":
      "Белсендіру қолжетімді болғанда Orqelio қолданыстағы бизнес жүйеңізді пайдалана алуы үшін Altegio-дан бастаңыз.",
    "Connected": "Қосылған",
    "Connection error": "Қосылым қатесі",
    "Connection incomplete": "Қосылым аяқталмаған",
    "Not connected": "Қосылмаған",
    "Paused": "Тоқтатылған",
    "A connected Altegio CRM record exists for this organization.":
      "Бұл ұйымда қосылған Altegio CRM жазбасы бар.",
    "The saved Altegio connection is marked with an error.":
      "Сақталған Altegio қосылымы қате күйінде белгіленген.",
    "The Altegio connection still requires setup.":
      "Altegio қосылымын әлі баптау қажет.",
    "Altegio has not been added to this organization.":
      "Altegio бұл ұйымға әлі қосылмаған.",
    "The saved Altegio connection is marked as disconnected.":
      "Сақталған Altegio қосылымы ажыратылған деп белгіленген.",
    "Continue connection": "Қосылымды жалғастыру",
    "Status reflects the saved CRM connection only and does not claim live API health.":
      "Күй тек сақталған CRM қосылымын көрсетеді және API қолжетімділігін растамайды.",
    "Organization summary": "Ұйым туралы мәлімет",
    "Organization": "Ұйым",
    "Your role": "Сіздің рөліңіз",
    "Team members": "Ұйым қатысушылары",
    "Altegio status": "Altegio күйі",
    "Quick actions": "Жылдам әрекеттер",
    "Open the organization areas available today.":
      "Қазір қолжетімді ұйым бөлімдеріне өтіңіз.",
    "Manage CRM connections and provider setup.":
      "CRM қосылымдары мен провайдер баптауларын басқарыңыз.",
    "Invite and manage organization administrators.":
      "Ұйым әкімшілерін шақырыңыз және басқарыңыз.",
    "Only the organization owner can manage administrators.":
      "Әкімшілерді тек ұйым иесі басқара алады.",
    "Update the organization name and workspace address.":
      "Ұйым атауы мен жұмыс кеңістігінің мекенжайын өзгертіңіз.",
    "AI manager": "ЖИ-менеджер",
    "Activity history": "Әрекеттер тарихы",
    "Configure AI manager": "ЖИ-менеджерді баптау",
    "Configure communication and human handoff rules.":
      "Сөйлесу және диалогты адамға беру ережелерін баптаңыз.",
    "Altegio and AI manager settings are ready. Review your integration when needed.":
      "Altegio мен ЖИ-менеджер баптаулары дайын. Қажет болса, интеграцияны тексеріңіз.",
    "Add business context and handoff rules before Orqelio starts working with customers.":
      "Orqelio клиенттермен жұмыс істей бастағанға дейін бизнес контексті мен диалогты беру ережелерін қосыңыз.",
    "Messages": "Хабарламалар",
    "Analytics": "Аналитика",
    "Language": "Тіл",
    "Русский": "Орысша",
    "Қазақша": "Қазақша",
  },
};

export function translate(locale: Locale, key: string): string {
  return translations[locale][key] ?? translations[DEFAULT_LOCALE][key] ?? key;
}
