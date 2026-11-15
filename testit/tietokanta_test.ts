// Ajaa mittarimigraation PGlitessä (Postgres WASM:na) ja testaa kirjaa_lukemat-funktion.
// Ajastusmigraatio jätetään pois: pg_cron, pg_net ja Vault ovat vain Supabasessa.

import { assertEquals } from "jsr:@std/assert@1.0.8";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const MIGRAATIO = new URL("../supabase/migrations/20261115000001_mittarit.sql", import.meta.url);

async function kanta() {
  const db = new PGlite();
  // Supabasen roolit, joihin migraation revoke viittaa.
  await db.exec("create role anon; create role authenticated;");
  await db.exec(await Deno.readTextFile(MIGRAATIO));
  return db;
}

async function kirjaa(db: PGlite, aika: string, lukemat: unknown[]) {
  const r = await db.query<{ n: number }>(
    "select kirjaa_lukemat('wom', $1, $2::jsonb) as n",
    [aika, JSON.stringify(lukemat)],
  );
  return r.rows[0].n;
}

Deno.test("vain muuttuneet lukemat kirjataan", async () => {
  const db = await kanta();
  const a = { mittari: "xp:mining", arvo: 100 };
  const b = { mittari: "kc:zulrah", arvo: 49 };

  assertEquals(await kirjaa(db, "2026-11-15T10:00:00Z", [a, b]), 2);
  assertEquals(await kirjaa(db, "2026-11-15T11:00:00Z", [a, b]), 0);
  assertEquals(await kirjaa(db, "2026-11-15T12:00:00Z", [{ ...a, arvo: 150 }, b]), 1);

  const nyt = await db.query<{ mittari: string; arvo: string }>(
    "select mittari, arvo from mittari_nyt order by mittari",
  );
  assertEquals(nyt.rows.map((r) => [r.mittari, Number(r.arvo)]), [["kc:zulrah", 49], ["xp:mining", 150]]);
  await db.close();
});

Deno.test("varmuuden muutos kirjataan, vaikka arvo pysyy", async () => {
  const db = await kanta();
  await kirjaa(db, "2026-11-15T10:00:00Z", [{ mittari: "kc:nex", arvo: 0, varmuus: "alle_rajan" }]);
  assertEquals(await kirjaa(db, "2026-11-15T11:00:00Z", [{ mittari: "kc:nex", arvo: 0, varmuus: "tarkka" }]), 1);
  await db.close();
});

Deno.test("sama tilannekuva kahdesti ei kaadu eikä tuplaa", async () => {
  const db = await kanta();
  const l = [{ mittari: "xp:mining", arvo: 100 }];
  await kirjaa(db, "2026-11-15T10:00:00Z", l);
  assertEquals(await kirjaa(db, "2026-11-15T10:00:00Z", [{ mittari: "xp:mining", arvo: 120 }]), 0);
  const n = await db.query<{ n: number }>("select count(*)::int as n from mittarilukema");
  assertEquals(n.rows[0].n, 1);
  await db.close();
});

Deno.test("onnistunut haku päivittää lähteen ja nollaa virheen", async () => {
  const db = await kanta();
  await db.query("select kirjaa_virhe('wom', 'WOM vastasi 500')");
  await kirjaa(db, "2026-11-15T10:00:00Z", [{ mittari: "xp:mining", arvo: 1 }]);
  const r = await db.query<{ virhe: string | null; ok: boolean }>(
    "select virhe, paivitetty is not null as ok from lahde where id = 'wom'",
  );
  assertEquals(r.rows[0], { virhe: null, ok: true });
  await db.close();
});
