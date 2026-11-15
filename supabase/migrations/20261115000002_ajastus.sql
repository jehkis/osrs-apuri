-- Tunnin välein ajettava WOM-haku: pg_cron kutsuu Edge Functionia pg_netillä.
-- Osoite ja avain luetaan Vaultista, jotta ne eivät päädy repoon. Ne asetetaan
-- kerran käyttöönoton yhteydessä (ks. README, "Käyttöönotto").

create extension if not exists pg_cron;
create extension if not exists pg_net;

create function kutsu_funktiota(nimi text)
returns bigint
language sql
security definer
set search_path = public
as $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'projekti_url')
               || '/functions/v1/' || nimi,
    headers := jsonb_build_object(
                 'Content-Type', 'application/json',
                 'x-cron-avain', (select decrypted_secret from vault.decrypted_secrets where name = 'cron_avain')),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
$$;

revoke all on function kutsu_funktiota(text) from public, anon, authenticated;

-- Minuutilla 7, ettei osuta tasatunnin ruuhkaan WOM:ssa.
select cron.schedule('hae-wom', '7 * * * *', $$ select public.kutsu_funktiota('hae-wom') $$);
