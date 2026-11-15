// Ajaa mittarimigraation PGlitessä (Postgres WASM:na) ja testaa kirjaa_lukemat-funktion.
// Ajastusmigraatio jätetään pois: pg_cron, pg_net ja Vault ovat vain Supabasessa.

import { assertEquals } from "jsr:@std/assert@1.0.8";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";

const MIGRAATIOT = ["20261115000001_mittarit.sql", "20261115000003_haasteet.sql"]
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

async function kolmikko(db: PGlite) {
  await db.exec(`
    insert into arvonta (kaista, siemen) values ('skilli1', 1);
    insert into haaste (kaista, arvonta, kohde, ulottuvuus, mittari, alkuarvo, tavoite, tavoitetaso, tunnit, pisteet, kuvaus) values
      ('skilli1', 1, 'agility',  'tunnit',      'xp:agility',  1000, 500, null, 0.5, 5, 'a'),
      ('skilli1', 1, 'mining',   'tasotavoite', 'xp:mining',   2000, 300, 80,   0.6, 6, 'b'),
      ('skilli1', 1, 'fishing',  'tunnit',      'xp:fishing',  3000, 700, null, 0.7, 7, 'c');`);
}

Deno.test("valinta aktivoi yhden, hylkää muut ja painottaa ohitettuja", async () => {
  const db = await kanta();
  await kolmikko(db);
  await db.query("select valitse_haaste(2, 2100)");
  const h = await db.query<{ id: number; tila: string; alkuarvo: string; tavoite: string }>(
    "select id, tila, alkuarvo, tavoite from haaste order by id");
  assertEquals(h.rows.map((r) => r.tila), ["hylatty", "aktiivinen", "hylatty"]);
  // Tasotavoite pysyy samassa absoluuttisessa XP:ssä (2300), vaikka XP nousi välissä.
  assertEquals([Number(h.rows[1].alkuarvo), Number(h.rows[1].tavoite)], [2100, 200]);
  const p = await db.query<{ kohde: string; lisa: string }>("select kohde, lisa from arvontapaino order by kohde");
  assertEquals(p.rows.map((r) => [r.kohde, Number(r.lisa)]), [["agility", 0.25], ["fishing", 0.25], ["mining", 0]]);
  const a = await db.query<{ valittu: boolean }>("select valittu is not null as valittu from arvonta");
  assertEquals(a.rows[0].valittu, true);
  await db.close();
});

Deno.test("tuntihaasteen alkuarvo päivittyy, tavoite pysyy", async () => {
  const db = await kanta();
  await kolmikko(db);
  await db.query("select valitse_haaste(1, 1200)");
  const r = await db.query<{ alkuarvo: string; tavoite: string }>("select alkuarvo, tavoite from haaste where id = 1");
  assertEquals([Number(r.rows[0].alkuarvo), Number(r.rows[0].tavoite)], [1200, 500]);
  await db.close();
});

Deno.test("valmistuminen kirjaa pisteet vain kerran", async () => {
  const db = await kanta();
  await kolmikko(db);
  await db.query("select valitse_haaste(3, 3000)");
  const eka = await db.query<{ ok: boolean }>("select merkitse_valmiiksi(3) as ok");
  const toka = await db.query<{ ok: boolean }>("select merkitse_valmiiksi(3) as ok");
  assertEquals([eka.rows[0].ok, toka.rows[0].ok], [true, false]);
  const p = await db.query<{ n: number; s: number }>("select count(*)::int as n, sum(pisteet)::int as s from pistetapahtuma");
  assertEquals(p.rows[0], { n: 1, s: 7 });
  await db.close();
});

Deno.test("jo valittua kolmikkoa ei voi valita uudelleen", async () => {
  const db = await kanta();
  await kolmikko(db);
  await db.query("select valitse_haaste(1, 1000)");
  let virhe = "";
  try { await db.query("select valitse_haaste(2, 2000)"); } catch (e) { virhe = String(e); }
  assertEquals(virhe.includes("ei ole tarjolla"), true);
  await db.close();
});
