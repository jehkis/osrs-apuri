// Hakee tilin tuoreen datan Wise Old Manista ja kirjaa muuttuneet mittarit.
// pg_cron kutsuu tätä tunnin välein (ks. migraatio 20261115000002_ajastus.sql).

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { type WomPelaaja, womAika, womMittareiksi } from "../_jaettu/wom.ts";

const WOM = "https://api.wiseoldman.net/v2";
const OTSAKKEET = { "User-Agent": "osrs-apuri", "Content-Type": "application/json" };

async function haePelaaja(rsn: string): Promise<WomPelaaja> {
  const nimi = encodeURIComponent(rsn);
  // POST päivittää datan hiscoreista. WOM torjuu päivityksen, jos edellisestä on
  // alle minuutti, joten silloin luetaan viimeisin tallennettu tila GET:llä.
  const paivitys = await fetch(`${WOM}/players/${nimi}`, { method: "POST", headers: OTSAKKEET });
  if (paivitys.ok) return await paivitys.json();

  const luku = await fetch(`${WOM}/players/${nimi}`, { headers: OTSAKKEET });
  if (!luku.ok) {
    throw new Error(`WOM vastasi ${paivitys.status} (päivitys) ja ${luku.status} (luku)`);
  }
  return await luku.json();
}

Deno.serve(async (req) => {
  if (req.headers.get("x-cron-avain") !== Deno.env.get("CRON_AVAIN")) {
    return new Response("ei oikeutta", { status: 401 });
  }

  const db = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const rsn = Deno.env.get("OSRS_RSN") ?? "zei_kill";

  try {
    const pelaaja = await haePelaaja(rsn);
    const { data, error } = await db.rpc("kirjaa_lukemat", {
      p_lahde: "wom",
      p_aika: womAika(pelaaja),
      lukemat: womMittareiksi(pelaaja),
    });
    if (error) throw new Error(`tietokanta: ${error.message}`);
    return Response.json({ rsn, kirjattu: data });
  } catch (e) {
    const viesti = e instanceof Error ? e.message : String(e);
    await db.rpc("kirjaa_virhe", { p_lahde: "wom", p_viesti: viesti });
    return Response.json({ rsn, virhe: viesti }, { status: 502 });
  }
});
