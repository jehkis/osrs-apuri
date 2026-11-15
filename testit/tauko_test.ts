import { assert, assertEquals } from "jsr:@std/assert@1.0.8";
import { bossitTaskeista, sallittuTier, womAvain, type WikiTaski } from "../supabase/functions/_jaettu/bossit.ts";
import {
  arvoTauko, opettelupolku, opetteluHaaste, osaamistaso, type TaukoBossi, type TaukoSyote, vaatimusTaytetty,
} from "../supabase/functions/_jaettu/tauko.ts";
import { wikiSyncMittareiksi } from "../supabase/functions/_jaettu/wikisync.ts";

const WOM = ["vorkath", "zulrah", "barrows_chests", "kreearra", "the_hueycoatl", "tempoross", "giant_mole", "nex"];

const t = (id: number, monster: string, tier: string, type = "Kill Count"): WikiTaski =>
  ({ id, name: `T${id}`, monster, tier, type, task: `tee ${id}` });

Deno.test("wikin nimet yhdistyvät WOM:n mittareihin", () => {
  assertEquals(womAvain("Kree'arra", WOM), "kreearra");
  assertEquals(womAvain("Barrows", WOM), "barrows_chests");
  assertEquals(womAvain("The Hueycoatl", WOM), "the_hueycoatl");
  assertEquals(womAvain("Aberrant Spectre", WOM), null);
});

Deno.test("porras tulee CA-tierien mediaanista ja minipelit eivät ole opeteltavia", () => {
  const { bossit, taskit } = bossitTaskeista([
    t(1, "Vorkath", "Medium"), t(2, "Vorkath", "Master"), t(3, "Vorkath", "Master"),
    t(4, "Tempoross", "Easy"), t(5, "Aberrant Spectre", "Easy"), t(6, "Zulrah", "Grandmaster"),
  ], WOM);
  const b = Object.fromEntries(bossit.map((x) => [x.id, x]));
  assertEquals(b.vorkath.porras, 4);
  assertEquals(b.vorkath.vaatimus, { quest: "Dragon Slayer II" });
  assertEquals(b.tempoross.porras, 1);
  assertEquals(b.tempoross.opeteltava, false);
  assertEquals(b.zulrah.porras, 5);
  assertEquals(taskit.length, 5); // Aberrant Spectrellä ei ole KC-mittaria
});

Deno.test("tason sallima CA-tier", () => {
  assertEquals([1, 2, 3, 4, 5].map(sallittuTier), [1, 2, 3, 4, 5]);
});

Deno.test("vaatimukset: slayer-taso ja valmis quest", () => {
  assert(vaatimusTaytetty(null, 1, {}));
  assert(!vaatimusTaytetty({ slayer: 91 }, 88, {}));
  assert(vaatimusTaytetty({ slayer: 85 }, 88, {}));
  assert(!vaatimusTaytetty({ quest: "Desert Treasure II - The Fallen Empire" }, 99, { "Desert Treasure II - The Fallen Empire": 1 }));
  assert(vaatimusTaytetty({ quest: "Regicide" }, 99, { Regicide: 2 }));
});

const bossi = (id: string, porras: number, kc: number, muuta: Partial<TaukoBossi> = {}): TaukoBossi => ({
  id, nimi: id, porras, vaikeus: porras, opeteltava: true, vaatimus: null, kc, vaatimusOk: true, ...muuta,
});

function syote(siemen = 1): TaukoSyote {
  return {
    bossit: [
      bossi("giant_mole", 1, 68), bossi("nex", 4, 79), bossi("zulrah", 3, 49),
      bossi("royal_titans", 1, 0), bossi("vorkath", 4, 0), bossi("kreearra", 3, 1),
      bossi("tempoross", 1, 2, { opeteltava: false }),
      bossi("vardorvis", 4, 1, { vaatimusOk: false }),
    ],
    taskit: [
      { id: 10, nimi: "Nopea", bossi: "zulrah", tier: 1, tyyppi: "Speed", kuvaus: "nopeasti", tehty: false },
      { id: 11, nimi: "Ilman", bossi: "nex", tier: 3, tyyppi: "Restriction", kuvaus: "ilman", tehty: false },
      { id: 12, nimi: "Vaikea", bossi: "nex", tier: 5, tyyppi: "Perfection", kuvaus: "täydellinen", tehty: false },
      { id: 13, nimi: "Tehty", bossi: "giant_mole", tier: 0, tyyppi: "Kill Count", kuvaus: "x", tehty: true },
    ],
    tapotTunnissa: { giant_mole: 100, nex: 10, zulrah: 46 },
    taso: 1,
    kesto: [30, 45],
    lisapainot: {},
    siemen,
  };
}

Deno.test("opettelupolku: alle 10 KC, osaamistasosta alkaen, ei minipelejä", () => {
  // Nex (porras 4, 79 KC) → osaamistaso 4, polku portaasta 3: royal_titans (porras 1) jää pois.
  assertEquals(opettelupolku(syote().bossit).map((b) => b.id), ["kreearra", "vardorvis", "vorkath"]);
  // Ilman Nexiä osaamistaso on 3 (Zulrah), polku portaasta 2.
  assertEquals(osaamistaso(syote().bossit.filter((b) => b.id !== "nex")), 3);
  assertEquals(opettelupolku([bossi("giant_mole", 1, 68), bossi("royal_titans", 1, 0)]).map((b) => b.id), ["royal_titans"]);
});

Deno.test("wildyn ja F2P-avainbossit eivät ole opeteltavia", () => {
  const { bossit } = bossitTaskeista([t(1, "Callisto", "Hard"), t(2, "Obor", "Easy"), t(3, "Vorkath", "Elite")],
    ["callisto", "obor", "vorkath"]);
  assertEquals(Object.fromEntries(bossit.map((b) => [b.id, b.opeteltava])), { callisto: false, obor: false, vorkath: true });
});

Deno.test("opetteluhaaste: ensimmäinen kill tai varmuus 10 KC:hen", () => {
  const eka = opetteluHaaste(bossi("vorkath", 4, 0));
  assertEquals([eka.mittari, eka.alkuarvo, eka.tavoite, eka.pisteet], ["kc:vorkath", 0, 1, 30]);
  const toka = opetteluHaaste(bossi("kreearra", 3, 1));
  assertEquals([toka.tavoite, toka.pisteet, toka.kuvaus], [9, 37, "Varmuus: 1 → 10 KC"]);
});

Deno.test("taukokolmikossa on aina opettelu ja kolme eri bossia", () => {
  for (let siemen = 1; siemen <= 60; siemen++) {
    const k = arvoTauko(syote(siemen));
    assertEquals(k.length, 3);
    assertEquals(k[0].ulottuvuus, "opettelu");
    assert(["kreearra", "vorkath"].includes(k[0].kohde), k[0].kohde); // vardorvis: vaatimus puuttuu
    assertEquals(new Set(k.map((e) => e.kohde)).size, 3);
    for (const e of k.slice(1)) assert(["giant_mole", "nex", "zulrah"].includes(e.kohde));
  }
});

Deno.test("tason ylittävät ja tehdyt CA-taskit eivät tule", () => {
  for (let siemen = 1; siemen <= 60; siemen++) {
    for (const e of arvoTauko(syote(siemen))) assert(!["ca:11", "ca:12", "ca:13"].includes(e.mittari), e.mittari);
  }
  const taso4 = Array.from({ length: 60 }, (_, i) => arvoTauko({ ...syote(i + 1), taso: 4 })).flat();
  assert(taso4.some((e) => e.mittari === "ca:11"));
  assert(!taso4.some((e) => e.mittari === "ca:12")); // Grandmaster vasta tasolla 5
});

Deno.test("määrähaaste mitoitetaan tunnissa tapettavista ja antaa vähemmän kuin skillaus", () => {
  const maarat = Array.from({ length: 60 }, (_, i) => arvoTauko(syote(i + 1))).flat().filter((e) => e.ulottuvuus === "maara");
  assert(maarat.length > 0);
  for (const e of maarat) {
    assert(e.tunnit * 60 >= 25 && e.tunnit * 60 <= 50, `${e.kohde} ${e.tunnit}`);
    assert(e.pisteet <= Math.round(e.tunnit * 10));
  }
});

Deno.test("ilman opeteltavaa kolmikko tulee tutuista", () => {
  const s = syote(3);
  s.bossit = s.bossit.filter((b) => b.kc >= 10);
  const k = arvoTauko(s);
  assertEquals(k.length, 3);
  assert(!k.some((e) => e.ulottuvuus === "opettelu"));
});

Deno.test("WikiSync: tehdyt CA:t, questit ja diaryt mittareiksi", () => {
  const l = wikiSyncMittareiksi({
    username: "x", timestamp: "2026-11-15T18:29:45.398Z",
    quests: { ".": 0, "Regicide": 2, "Desert Treasure II - The Fallen Empire": 1 },
    achievement_diaries: { Ardougne: { Easy: { complete: true }, Hard: { complete: false } } },
    combat_achievements: [0, 4],
  });
  const m = Object.fromEntries(l.map((x) => [x.mittari, x.arvo]));
  assertEquals(m["ca:0"], 1);
  assertEquals(m["ca:4"], 1);
  assertEquals(m["tili:ca_tehty"], 2);
  assertEquals(m["quest:Regicide"], 2);
  assertEquals(m["quest:."], undefined);
  assertEquals(m["diary:Ardougne:Easy"], 1);
  assertEquals(m["diary:Ardougne:Hard"], 0);
});
