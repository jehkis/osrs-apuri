import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1.0.8";
import {
  BOSSIT, bossinTila, kcHetkella, kcKayra, kcLahde, onUniikki, tahti, uniikinTila, valmistuu, virstanpylvaat, yhteenveto,
} from "../supabase/functions/_jaettu/projekti.ts";

const PAIVA = 86_400_000;
const NYT = Date.parse("2026-12-18T12:00:00Z");
const pv = (n: number) => new Date(NYT - n * PAIVA).toISOString();

Deno.test("projektissa on viisi bossia WOM:n mittareilla", () => {
  assertEquals(BOSSIT.map((b) => b.id), ["giant_mole", "sarachnis", "lunar_chests", "mad_angel", "amoxliatl"]);
  // Jokaisella bossilla on uniikit, ja nimet ovat bossin sisällä yksikäsitteisiä.
  for (const b of BOSSIT) {
    const nimet = b.uniikit.map((u) => u.nimi);
    assertEquals(new Set(nimet).size, nimet.length, b.id);
  }
  assertEquals(BOSSIT.find((b) => b.id === "lunar_chests")!.uniikit.length, 12);
});

Deno.test("uniikki tunnistetaan vain oikealta bossilta", () => {
  assertEquals(onUniikki("mad_angel", "Aggy"), true);
  assertEquals(onUniikki("sarachnis", "Aggy"), false);
  assertEquals(onUniikki("zulrah", "Tanzanite fang"), false);
});

Deno.test("virstanpylväät: saavutetut ja seuraava", () => {
  assertEquals(virstanpylvaat(75), { saavutetut: [], seuraava: 100, puuttuu: 25 });
  assertEquals(virstanpylvaat(250), { saavutetut: [100, 250], seuraava: 500, puuttuu: 250 });
  assertEquals(virstanpylvaat(3100).seuraava, null);
});

Deno.test("KC hetkellä on viimeisin lukema ennen hetkeä", () => {
  const h = [{ arvo: 10, aika: pv(10) }, { arvo: 30, aika: pv(2) }];
  assertEquals(kcHetkella(h, NYT - 20 * PAIVA), null);
  assertEquals(kcHetkella(h, NYT - 5 * PAIVA), 10);
  assertEquals(kcHetkella(h, NYT), 30);
});

Deno.test("tahti odottaa kolme päivää historiaa", () => {
  assertEquals(tahti([{ arvo: 10, aika: pv(1) }], NYT).viikossa, null);
});

Deno.test("tahti lasketaan ikkunasta, vanhempi lukema antaa alun", () => {
  // 100 KC ikkunan alussa (lukema 40 pv sitten), 380 nyt: 280 KC 28 päivässä = 70/vko.
  const h = [{ arvo: 100, aika: pv(40) }, { arvo: 200, aika: pv(14) }, { arvo: 380, aika: pv(1) }];
  assertAlmostEquals(tahti(h, NYT).viikossa!, 70, 1e-9);
});

Deno.test("valmistumispäivä tahdista", () => {
  assertEquals(valmistuu(2930, 70, NYT), new Date(NYT + 7 * PAIVA).toISOString());
  assertEquals(valmistuu(100, 0, NYT), null);
  assertEquals(valmistuu(3000, null, NYT), new Date(NYT).toISOString());
});

Deno.test("dry-tilasto lasketaan viimeisimmästä samasta dropista", () => {
  const u = { nimi: "Hallowfell", harvinaisuus: 127 };
  const ilman = uniikinTila(u, 254, []);
  assertEquals([ilman.kuivana, ilman.kertaa], [254, 2]);
  assertAlmostEquals(ilman.todennakoisyys, 1 - Math.pow(126 / 127, 254), 1e-12);
  assertAlmostEquals(ilman.odotettu, 2, 1e-12);

  const d = [{ id: 1, bossi: "mad_angel", esine: "Hallowfell", kc: 200, aika: pv(3) }];
  const kanssa = uniikinTila(u, 254, d);
  assertEquals([kanssa.saadut.length, kanssa.kuivana], [1, 54]);
});

Deno.test("bossin tila ja yhteenveto", () => {
  const mole = BOSSIT[0];
  const h = [{ arvo: 75, aika: "2026-11-15T10:00:00Z" }, { arvo: 145, aika: pv(1) }];
  const t = bossinTila(mole, h, [], NYT);
  assertEquals([t.kc, t.alkuKc], [145, 75]);
  assertEquals(t.virstanpylvaat.saavutetut, [100]);

  const kaikki = BOSSIT.map((b) => bossinTila(b, b === mole ? h : [], [], NYT));
  const y = yhteenveto(kaikki, NYT);
  assertEquals([y.kc, y.tavoite, y.projektissa], [145, 15000, 70]);
  assertEquals(y.viikossa, null); // muilla ei historiaa
  assertEquals(y.uniikkejaYhteensa, 3 + 3 + 12 + 3 + 3);
});

Deno.test("hiscoren vanha lukema ei laske Dinkin tuoreempaa KC:ta", () => {
  // Dink kirjasi 80, sitten WOM toi uloskirjautumista odottavan hiscoren 75.
  const h = [{ arvo: 75, aika: pv(2) }, { arvo: 80, aika: pv(1) }, { arvo: 75, aika: pv(0.5) }];
  assertEquals(kcHetkella(h, NYT), 80);
});

Deno.test("KC:n lähde on lukema, joka nosti KC:n nykyiseen arvoon", () => {
  const h = [
    { arvo: 75, aika: pv(3), lahde: "wom" },
    { arvo: 127, aika: pv(1), lahde: "events" },
    { arvo: 127, aika: pv(0.5), lahde: "wom" },
  ];
  assertEquals(kcLahde(h, NYT), { lahde: "events", aika: pv(1) });
  assertEquals(kcLahde([], NYT), null);
});

Deno.test("KC-käyrä: nousevat pisteet, tunnin niputus, ikkunan alku ja nykyhetki", () => {
  const tunti = 3_600_000;
  const historia = [
    { arvo: 10, aika: pv(40) },                                   // ikkunaa vanhempi → ikkunan alkuun
    { arvo: 20, aika: pv(5) },
    { arvo: 21, aika: new Date(NYT - 5 * PAIVA + 60_000).toISOString() }, // sama tunti → yhdistetään
    { arvo: 15, aika: pv(3) },                                     // vanhentunut hiscore → ohitetaan
    { arvo: 30, aika: new Date(NYT - tunti).toISOString() },
  ];
  assertEquals(kcKayra(historia, NYT), [
    { aika: pv(28), kc: 10 },
    { aika: pv(5), kc: 21 },
    { aika: new Date(NYT - tunti).toISOString(), kc: 30 },
    { aika: new Date(NYT).toISOString(), kc: 30 },
  ]);
  assertEquals(kcKayra([], NYT), []);
});
