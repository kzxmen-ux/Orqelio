alter table public.organizations
  add column timezone text not null default 'Asia/Almaty',
  add constraint organizations_timezone_length
    check (char_length(timezone) between 1 and 100),
  add constraint organizations_timezone_trimmed
    check (timezone = btrim(timezone));
