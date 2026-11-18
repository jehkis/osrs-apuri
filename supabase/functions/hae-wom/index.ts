// Ajastettu WOM-haku: pg_cron kutsuu tätä tunnin välein (migraatio 20261115000002).
// Hakee tilin datan WOM:sta ja kirjaa muuttuneet mittarit.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { paivitaWom } from "../_jaettu/palvelu.ts";

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-avain") !== Deno.env.get("CRON_AVAIN")) {
    return new Response("ei oikeutta", { status: 401 });
  }
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const rsn = Deno.env.get("OSRS_RSN") ?? "zei_kill";
  try {
    return Response.json({ rsn, ...(await paivitaWom(db, rsn)) });
  } catch (e) {
    return Response.json({ rsn, virhe: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
});
