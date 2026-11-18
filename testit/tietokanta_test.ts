// Ajaa migraatiot PGlitessä (Postgres WASM:na): mittarit, vanhat max cape -taulut ja
// bossiprojekti, joka poistaa ne. Ajastusmigraatio jätetään pois: pg_cron, pg_net ja
// Vault ovat vain Supabasessa.

import { assertEquals } from "jsr:@std/assert@1.0.8";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const MIGRAATIOT = [
  "20261115000001_mittarit.sql",
  "20261115000003_haasteet.sql",
  "20261115000004_palkinnot.sql",
  "20261115000005_tauko.sql",
  "20261118000001_bossiprojekti.sql",
  "20261118000002_lootti.sql",
]
  .map((m) => new URL(`../supabase/migrations/${m}`, import.meta.url));

async function kanta() {
  const db = new PGlite();
  // Supabasen roolit, joihin migraation revoke viittaa.
  await db.exec("create role anon; create role authenticated;");
  for (const m of MIGRAATIOT) await db.exec(await Deno.readTextFile(m));
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

Deno.test("bossiprojekti poistaa max cape -taulut ja -funktiot", async () => {
  const db = await kanta();
  const t = await db.query<{ n: string }>(
    "select table_name as n from information_schema.tables where table_schema = 'public' order by 1",
  );
  assertEquals(t.rows.map((r) => r.n), ["droppi", "lahde", "lootti", "lootti_bossi", "lootti_esine", "mittari_nyt", "mittarilukema"]);
  const f = await db.query<{ n: string }>(
    "select routine_name as n from information_schema.routines where routine_schema = 'public' order by 1",
  );
  assertEquals(f.rows.map((r) => r.n), ["kirjaa_lukemat", "kirjaa_virhe"]);
  await db.close();
});

Deno.test("droppi sallii saman esineen monesti mutta ei negatiivista KC:ta", async () => {
  const db = await kanta();
  await db.exec(`insert into droppi (bossi, esine, kc) values
    ('mad_angel', 'Hallowfell', 40), ('mad_angel', 'Hallowfell', 200);`);
  const n = await db.query<{ n: number }>("select count(*)::int as n from droppi");
  assertEquals(n.rows[0].n, 2);
  let virhe = "";
  try { await db.exec("insert into droppi (bossi, esine, kc) values ('sarachnis', 'Jar of eyes', -1)"); }
  catch (e) { virhe = String(e); }
  assertEquals(virhe.includes("check"), true);
  await db.close();
});

Deno.test("lootin näkymät summaavat tapot ja esineet", async () => {
  const db = await kanta();
  await db.exec(`insert into lootti (bossi, kc, arvo, esineet) values
    ('giant_mole', 76, 2300, '[{"id":1,"nimi":"Big bones","maara":1,"hinta":300},{"id":2,"nimi":"Mole claw","maara":2,"hinta":1000}]'),
    ('giant_mole', 77, 1300, '[{"id":1,"nimi":"Big bones","maara":1,"hinta":300},{"id":2,"nimi":"Mole claw","maara":1,"hinta":1000}]');`);
  const b = await db.query<{ tappoja: number; arvo: string }>("select tappoja, arvo from lootti_bossi");
  assertEquals([b.rows[0].tappoja, Number(b.rows[0].arvo)], [2, 3600]);
  const e = await db.query<{ nimi: string; maara: string; arvo: string }>("select nimi, maara, arvo from lootti_esine order by nimi");
  assertEquals(e.rows.map((r) => [r.nimi, Number(r.maara), Number(r.arvo)]), [["Big bones", 2, 600], ["Mole claw", 3, 3000]]);
  await db.close();
});
