import { assert, assertEquals, assertNotEquals } from "jsr:@std/assert@1.0.8";
import { PGlite } from "npm:@electric-sql/pglite@0.2.17";
import {
  arvoPalkinnot, avauskynnykset, avausvali, PALKINNOT, pelipaiva, pelipaivanLoppu,
} from "../supabase/functions/_jaettu/eteneminen.ts";
import { jokeriHaaste } from "../supabase/functions/_jaettu/arvonta.ts";

// ---------------------------------------------------------------- laskenta

Deno.test("avausväli kasvaa tason mukana", () => {
  assertEquals([1, 2, 3, 4, 5, 9].map(avausvali), [50, 75, 100, 125, 150, 150]);
});

Deno.test("avauskynnykset: 50 välein tasolla 1, laskuri jatkuu tasorajan yli", () => {
  assertEquals(avauskynnykset(0), { saavutetut: [], seuraava: 50, edellinen: 0 });
  assertEquals(avauskynnykset(120).saavutetut, [50, 100]);
  const k = avauskynnykset(1600);
  // Tasolla 1 (0–1 499) väli on 50: kynnykset 50…1500. 1500 on jo tasoa 2, joten sieltä +75.
  assertEquals(k.saavutetut.length, 31);
  assertEquals(k.saavutetut.slice(-3), [1450, 1500, 1575]);
  assertEquals(k.seuraava, 1650);
});

Deno.test("palkintoarvonta: kolme eri palkintoa, toistettava", () => {
  for (let s = 1; s <= 40; s++) {
    const p = arvoPalkinnot(s);
    assertEquals(p.length, 3);
    assertEquals(new Set(p).size, 3);
    for (const x of p) assert(PALKINNOT.includes(x));
  }
  assertEquals(arvoPalkinnot(7), arvoPalkinnot(7));
  const kaikki = new Set(Array.from({ length: 40 }, (_, s) => arvoPalkinnot(s).join()));
  assert(kaikki.size > 4);
});

Deno.test("pelipäivä vaihtuu klo 05 Suomen aikaa", () => {
  assertEquals(pelipaiva(new Date("2026-11-16T01:30:00Z")), "2026-11-15"); // ma 03.30
  assertEquals(pelipaiva(new Date("2026-11-16T03:30:00Z")), "2026-11-16"); // ma 05.30
  assertEquals(pelipaivanLoppu(new Date("2026-11-15T18:00:00Z")).toISOString(), "2026-11-16T03:00:00.000Z");
});

Deno.test("jokeri tekee tuntihaasteen tason keskikestolla, ei farmingille", () => {
  const m = [{ startExp: 0, rate: 60_000, description: "" }];
  const e = jokeriHaaste({ nimi: "agility", xp: 1_287_283, menetelmat: m }, [30, 45])!;
  assertEquals(e.ulottuvuus, "tunnit");
  assert(Math.abs(e.tunnit * 60 - 40) <= 2, `${e.tunnit * 60}`);
  assertEquals(jokeriHaaste({ nimi: "farming", xp: 1_000_000, menetelmat: m }, [30, 45]), null);
});

// ---------------------------------------------------------------- tietokanta

const MIGRAATIOT = [
  "20261115000001_mittarit.sql", "20261115000003_haasteet.sql", "20261115000004_palkinnot.sql",
].map((m) => new URL(`../supabase/migrations/${m}`, import.meta.url));

async function kanta() {
  const db = new PGlite();
  await db.exec("create role anon; create role authenticated;");
  for (const m of MIGRAATIOT) await db.exec(await Deno.readTextFile(m));
  await db.exec(`
    insert into arvonta (kaista, siemen) values ('skilli1', 1);
    insert into haaste (kaista, arvonta, kohde, ulottuvuus, mittari, alkuarvo, tavoite, tunnit, pisteet, kuvaus) values
      ('skilli1', 1, 'agility', 'tunnit', 'xp:agility', 1000, 500, 0.5, 5, 'a'),
      ('skilli1', 1, 'mining',  'tunnit', 'xp:mining',  2000, 300, 0.6, 6, 'b'),
      ('skilli1', 1, 'fishing', 'tunnit', 'xp:fishing', 3000, 700, 0.7, 7, 'c');`);
  return db;
}

const yksi = async <T>(db: PGlite, sql: string) => (await db.query<T>(sql)).rows[0];
async function virhe(db: PGlite, sql: string): Promise<string> {
  try { await db.query(sql); return ""; } catch (e) { return String(e); }
}

Deno.test("vaihto vie 100 p saldosta mutta ei kertyneistä", async () => {
  const db = await kanta();
  await db.exec("insert into pistetapahtuma (pisteet, syy) values (130, 'testi')");
  await db.query("select vaihda_kolmikko('skilli1', false)");
  assertEquals((await yksi<{ s: number }>(db, "select saldo() as s")).s, 30);
  assertEquals((await yksi<{ s: number }>(db, "select sum(pisteet)::int as s from pistetapahtuma")).s, 130);
  const h = await db.query<{ tila: string }>("select distinct tila from haaste");
  assertEquals(h.rows.map((r) => r.tila), ["hylatty"]);
  assertEquals((await yksi<{ s: string }>(db, "select suljettu_syy as s from arvonta")).s, "vaihto");
  // Ohitetut eivät saa lisäpainoa vaihdossa.
  assertEquals((await yksi<{ n: number }>(db, "select count(*)::int as n from arvontapaino")).n, 0);
  await db.close();
});

Deno.test("vaihto ei onnistu ilman saldoa eikä ilman kolmikkoa", async () => {
  const db = await kanta();
  await db.exec("insert into pistetapahtuma (pisteet, syy) values (99, 'testi')");
  assert((await virhe(db, "select vaihda_kolmikko('skilli1', false)")).includes("saldo ei riitä"));
  assert((await virhe(db, "select vaihda_kolmikko('skilli2', false)")).includes("ei ole vaihdettavaa"));
  assertEquals((await yksi<{ n: number }>(db, "select count(*)::int as n from pistekulu")).n, 0);
  await db.close();
});

Deno.test("ilmainen vaihto käyttää palkinnon eikä pisteitä", async () => {
  const db = await kanta();
  assert((await virhe(db, "select vaihda_kolmikko('skilli1', true)")).includes("ei käyttämätöntä"));
  await db.exec(`insert into palkintoarvonta (kynnys, siemen, vaihtoehdot) values (50, 1, '{vaihto,jokeri,vapaapaiva}');
                 select valitse_palkinto(1, 'vaihto');`);
  await db.query("select vaihda_kolmikko('skilli1', true)");
  assertEquals((await yksi<{ s: number }>(db, "select saldo() as s")).s, 0);
  assertEquals((await yksi<{ k: boolean }>(db, "select kaytetty is not null as k from palkinto")).k, true);
  await db.close();
});

Deno.test("palkinnon voi valita vain vaihtoehdoista ja vain kerran", async () => {
  const db = await kanta();
  await db.exec("insert into palkintoarvonta (kynnys, siemen, vaihtoehdot) values (50, 1, '{vaihto,jokeri,vapaapaiva}')");
  assert((await virhe(db, "select valitse_palkinto(1, 'bossi_ilta')")).includes("ei ole vaihtoehtojen"));
  await db.query("select valitse_palkinto(1, 'jokeri')");
  assert((await virhe(db, "select valitse_palkinto(1, 'vaihto')")).includes("ei ole avoinna"));
  assertEquals((await yksi<{ n: number }>(db, "select count(*)::int as n from palkinto")).n, 1);
  await db.close();
});

Deno.test("jokeri sulkee kolmikon ja aktivoi valitun skillin", async () => {
  const db = await kanta();
  await db.exec(`insert into palkinto (tyyppi) values ('jokeri')`);
  await db.query(`select kayta_jokeri('skilli1', '{"kohde":"runecrafting","ulottuvuus":"tunnit","mittari":"xp:runecrafting",
    "alkuarvo":667095,"tavoite":40000,"tavoitetaso":null,"tunnit":0.6,"pisteet":6,"kuvaus":"rc"}'::jsonb)`);
  const a = await yksi<{ kohde: string; tila: string }>(db, "select kohde, tila from haaste where tila = 'aktiivinen'");
  assertEquals(a, { kohde: "runecrafting", tila: "aktiivinen" });
  assertEquals((await yksi<{ n: number }>(db, "select count(*)::int as n from haaste where tila = 'tarjolla'")).n, 0);
  assertEquals((await yksi<{ s: string }>(db, "select suljettu_syy as s from arvonta")).s, "jokeri");
  // Toinen jokeri ei mene läpi, kun kaistalla on jo aktiivinen haaste.
  await db.exec(`insert into palkinto (tyyppi) values ('jokeri')`);
  assert((await virhe(db, `select kayta_jokeri('skilli1', '{"kohde":"mining"}'::jsonb)`)).includes("jo aktiivinen"));
  assertEquals((await yksi<{ n: number }>(db, "select count(*)::int as n from palkinto where kaytetty is null")).n, 1);
  await db.close();
});

Deno.test("bossi-ilta hyvittää vain uuden EHB:n ja päättyy", async () => {
  const db = await kanta();
  await db.exec(`insert into palkinto (tyyppi, kaytetty, kaytto) values
    ('bossi_ilta', now(), '{"ehb_alku": 21.4, "annettu": 0}')`);
  assertEquals((await yksi<{ n: number }>(db, "select hyvita_bossi_ilta(1, 21.9, false) as n")).n, 5);
  assertEquals((await yksi<{ n: number }>(db, "select hyvita_bossi_ilta(1, 21.9, false) as n")).n, 0);
  assertEquals((await yksi<{ n: number }>(db, "select hyvita_bossi_ilta(1, 22.65, true) as n")).n, 7);
  assertEquals((await yksi<{ n: number }>(db, "select hyvita_bossi_ilta(1, 30, true) as n")).n, 0); // jo päättynyt
  assertEquals((await yksi<{ s: number }>(db, "select sum(pisteet)::int as s from pistetapahtuma")).s, 12);
  await db.close();
});
