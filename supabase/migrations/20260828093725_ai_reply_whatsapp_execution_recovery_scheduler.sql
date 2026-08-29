select cron.schedule(
  'orqelio-ai-reply-whatsapp-execution-recovery',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://orqelio.kz/api/internal/cron/ai-reply-whatsapp-execution-recovery',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'CRON_SECRET'
        limit 1
      )
    ),
    timeout_milliseconds := 30000
  ) as request_id;
  $$
);
