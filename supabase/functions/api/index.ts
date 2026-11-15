// Käyttöliittymän rajapinta. Vaatii kirjautuneen käyttäjän; rekisteröityminen on
// suljettu, joten ainoa tunnus on omistajan.
//
//   GET  /api/tilanne          etusivun kaikki tiedot
//   POST /api/valitse {id}     valitse haaste kolmikosta
//   POST /api/paivita          hae WOM nyt ja tarkista haasteet

import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { paivitaWom, tilanne, valitse, varmistaKolmikot } from "../_jaettu/palvelu.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

const vastaa = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const token = req.headers.get("Authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const { data: kayttaja } = await db.auth.getUser(token);
  if (!kayttaja?.user) return vastaa({ virhe: "kirjaudu sisään" }, 401);

  const reitti = new URL(req.url).pathname.replace(/^.*\/api/, "") || "/";
  try {
    if (req.method === "GET" && reitti === "/tilanne") {
      await varmistaKolmikot(db);
      return vastaa(await tilanne(db));
    }
    if (req.method === "POST" && reitti === "/valitse") {
      const { id } = await req.json();
      if (!Number.isInteger(id)) return vastaa({ virhe: "id puuttuu" }, 400);
      await valitse(db, id);
      return vastaa(await tilanne(db));
    }
    if (req.method === "POST" && reitti === "/paivita") {
      const tulos = await paivitaWom(db, Deno.env.get("OSRS_RSN") ?? "zei_kill");
      return vastaa({ ...tulos, tilanne: await tilanne(db) });
    }
    return vastaa({ virhe: "tuntematon reitti" }, 404);
  } catch (e) {
    return vastaa({ virhe: e instanceof Error ? e.message : String(e) }, 500);
  }
});
