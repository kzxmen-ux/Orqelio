create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron;

select cron.schedule(
  'orqelio-whatsapp-inbox-recovery',
  '*/5 * * * *',
  $cron$
  select net.http_get(
    url := 'https://orqelio.kz/api/internal/cron/whatsapp-inbox-recovery',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (
        select decrypted_secret
        from vault.decrypted_secrets
        where name = 'CRON_SECRET'
      )
    ),
    timeout_milliseconds := 10000
  ) as request_id;
  $cron$
);
