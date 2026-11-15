import { assert, assertAlmostEquals, assertEquals } from "jsr:@std/assert@1.0.8";
import { type Menetelma, tasoXp, tunnit, xpTasolle, xpTunneista, XP_99 } from "../supabase/functions/_jaettu/ehp.ts";
import { arvoKolmikko, type Skilli } from "../supabase/functions/_jaettu/arvonta.ts";
import { ennuste, kesto, taso, viikonAlku } from "../supabase/functions/_jaettu/eteneminen.ts";

const tasainen = (rate: number): Menetelma[] => [{ startExp: 0, rate, description: "" }];
const kaksiVaihetta: Menetelma[] = [
  { startExp: 0, rate: 50_000, description: "" },
  { startExp: 1_000_000, rate: 100_000, description: "" },
];

Deno.test("XP-taulukko vastaa pelin arvoja", () => {
  assertEquals(xpTasolle(2), 83);
  assertEquals(xpTasolle(92), 6_517_253);
  assertEquals(XP_99, 13_034_431);
  assertEquals(tasoXp(0), 1);
  assertEquals(tasoXp(6_517_252), 91);
  assertEquals(tasoXp(6_517_253), 92);
  assertEquals(tasoXp(200_000_000), 99);
});

Deno.test("tunnit lasketaan menetelmä kerrallaan", () => {
  assertEquals(tunnit(kaksiVaihetta, 900_000, 1_200_000), 100_000 / 50_000 + 200_000 / 100_000);
  assertEquals(tunnit(kaksiVaihetta, 5, 5), 0);
  assertEquals(tunnit(tasainen(0), 0, 100), null);
});

Deno.test("xpTunneista on tunnit-funktion käänteinen", () => {
  const loppu = xpTunneista(kaksiVaihetta, 900_000, 4)!;
  assertEquals(loppu, 1_200_000);
  assertAlmostEquals(tunnit(kaksiVaihetta, 900_000, loppu)!, 4);
});

const skillit: Skilli[] = [
  { nimi: "agility", xp: 1_287_283, menetelmat: tasainen(90_000) },
  { nimi: "runecrafting", xp: 667_095, menetelmat: tasainen(95_000) },
  { nimi: "cooking", xp: 6_601_245, menetelmat: tasainen(900_000) },
  { nimi: "sailing", xp: 353_273, menetelmat: tasainen(210_000) },
  { nimi: "magic", xp: 5_262_829, menetelmat: tasainen(0) }, // vain bonuksena
  { nimi: "strength", xp: 13_100_000, menetelmat: tasainen(100_000) }, // jo 99
];
const syote = (kaista: "skilli1" | "skilli2", siemen = 1) => ({
  kaista, skillit, kesto: [30, 45] as [number, number], lisapainot: {}, pois: [], siemen,
});

Deno.test("kolmikossa on kolme eri skilliä ilman maxattuja ja bonus-skillejä", () => {
  for (let siemen = 1; siemen <= 50; siemen++) {
    const k = arvoKolmikko(syote("skilli1", siemen));
    assertEquals(k.length, 3);
    assertEquals(new Set(k.map((e) => e.kohde)).size, 3);
    for (const e of k) assert(!["magic", "strength"].includes(e.kohde));
  }
});

Deno.test("sama siemen antaa saman kolmikon", () => {
  assertEquals(arvoKolmikko(syote("skilli1", 42)), arvoKolmikko(syote("skilli1", 42)));
});

Deno.test("tuntihaaste mahtuu tason kestoon ja pisteet ovat 10 tunnilta", () => {
  for (let siemen = 1; siemen <= 50; siemen++) {
    for (const e of arvoKolmikko(syote("skilli1", siemen)).filter((e) => e.ulottuvuus === "tunnit")) {
      assert(e.tunnit * 60 >= 25 && e.tunnit * 60 <= 50, `${e.kuvaus}`);
      assertEquals(e.pisteet, Math.max(1, Math.round(e.tunnit * 10)));
      assertEquals(e.mittari, `xp:${e.kohde}`);
    }
  }
});

Deno.test("pääskilli 2 tarjoaa aina heikoimman lenkin vähintään minimikeston verran", () => {
  const k = arvoKolmikko(syote("skilli2", 7));
  assertEquals(k[0].ulottuvuus, "heikoin");
  assertEquals(k[0].kohde, "sailing");
  const t = k[0].tavoitetaso!;
  assertEquals(k[0].tavoite, xpTasolle(t) - 353_273);
  // Pienin taso, joka vie vähintään 30 min: edellinen taso jäisi alle.
  assert(k[0].tunnit * 60 >= 30);
  assert((xpTasolle(t - 1) - 353_273) / 210_000 * 60 < 30);
});

Deno.test("farming ei tule arvontaan", () => {
  const kaikki = [...skillit, { nimi: "farming", xp: 1_060_808, menetelmat: tasainen(2_000_000) }];
  for (let siemen = 1; siemen <= 30; siemen++) {
    for (const kaista of ["skilli1", "skilli2"] as const) {
      assert(!arvoKolmikko({ ...syote(kaista, siemen), skillit: kaikki }).some((e) => e.kohde === "farming"));
    }
  }
});

Deno.test("pois-listan skilli ei tule arvontaan", () => {
  for (let siemen = 1; siemen <= 20; siemen++) {
    assert(!arvoKolmikko({ ...syote("skilli2", siemen), pois: ["sailing"] }).some((e) => e.kohde === "sailing"));
  }
});

Deno.test("skilli1 painottaa eniten tunteja vaativia", () => {
  const laskuri: Record<string, number> = {};
  for (let siemen = 1; siemen <= 300; siemen++) {
    const e = arvoKolmikko(syote("skilli1", siemen))[0];
    laskuri[e.kohde] = (laskuri[e.kohde] ?? 0) + 1;
  }
  assert((laskuri.agility ?? 0) > (laskuri.cooking ?? 0));
});

Deno.test("taso nousee 1 500 pisteen välein ja kesto sen mukana", () => {
  assertEquals([taso(0), taso(1499), taso(1500), taso(6000), taso(99999)], [1, 1, 2, 5, 5]);
  assertEquals(kesto(1), [30, 45]);
  assertEquals(kesto(5), [90, 90]);
});

Deno.test("viikko alkaa maanantaina klo 05 Suomen aikaa", () => {
  // Su 15.11.2026 klo 19 Suomessa → viikko alkoi ma 9.11. klo 05 (03 UTC, talviaika).
  assertEquals(viikonAlku(new Date("2026-11-15T17:00:00Z")).toISOString(), "2026-11-09T03:00:00.000Z");
  // Ma 16.11. klo 04.30 Suomessa kuuluu vielä edelliseen viikkoon.
  assertEquals(viikonAlku(new Date("2026-11-16T02:30:00Z")).toISOString(), "2026-11-09T03:00:00.000Z");
  assertEquals(viikonAlku(new Date("2026-11-16T03:30:00Z")).toISOString(), "2026-11-16T03:00:00.000Z");
});

Deno.test("ennuste odottaa kolme päivää historiaa", () => {
  const nyt = new Date("2026-11-15T17:00:00Z");
  const e = ennuste([{ aika: "2026-11-15T10:00:00Z", arvo: 223 }, { aika: "2026-11-15T16:00:00Z", arvo: 224 }], 822, nyt);
  assertEquals(e.tahtiViikossa, null);
  assertEquals(e.viikonTunnit, 1);
});

Deno.test("ennuste laskee tahdin ja max-päivän", () => {
  const nyt = new Date("2026-11-15T12:00:00Z");
  const e = ennuste([
    { aika: "2026-11-01T12:00:00Z", arvo: 200 },
    { aika: "2026-11-15T12:00:00Z", arvo: 220 },
  ], 700, nyt);
  assertEquals(e.tahtiViikossa, 10);
  assertEquals(e.maxPaiva, "2028-03-19"); // 70 viikkoa
});
