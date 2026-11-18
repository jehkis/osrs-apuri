// Dink-pluginin webhook: RuneLite lähettää tänne jokaisen lootin ja petin.
// Osoite on muotoa .../functions/v1/dink?avain=<DINK_AVAIN>. Dink lähettää
// multipart-lomakkeen (payload_json + kuva) tai pelkän JSONin.

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { kirjaaDink } from "../_jaettu/palvelu.ts";
import type { DinkViesti } from "../_jaettu/dink.ts";

async function lue(req: Request): Promise<DinkViesti> {
  const tyyppi = req.headers.get("content-type") ?? "";
  if (tyyppi.includes("multipart/form-data")) {
    const lomake = await req.formData();
    const json = lomake.get("payload_json");
    if (typeof json !== "string") throw new Error("payload_json puuttuu");
    return JSON.parse(json);
  }
  return await req.json();
}

Deno.serve(async (req) => {
  const avain = Deno.env.get("DINK_AVAIN");
  if (!avain || new URL(req.url).searchParams.get("avain") !== avain) {
    return new Response("ei oikeutta", { status: 401 });
  }
  if (req.method !== "POST") return new Response("vain POST", { status: 405 });
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  try {
    const tulos = await kirjaaDink(db, await lue(req), Deno.env.get("OSRS_RSN") ?? "zei_kill");
    return Response.json(tulos);
  } catch (e) {
    console.error("dink:", e);
    return Response.json({ virhe: e instanceof Error ? e.message : String(e) }, { status: 400 });
  }
});
