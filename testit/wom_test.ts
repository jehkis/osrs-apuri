import { assertEquals, assertThrows } from "jsr:@std/assert@1.0.8";
import { type WomPelaaja, womAika, womMittareiksi } from "../supabase/functions/_jaettu/wom.ts";

function pelaaja(): WomPelaaja {
  return {
    username: "testi",
    ehp: 223.321812,
    ehb: 21.44624,
    ttm: 822.62187,
    combatLevel: 111,
    updatedAt: "2026-11-15T17:36:21.638Z",
    latestSnapshot: {
      createdAt: "2026-11-15T17:36:21.000Z",
      data: {
        skills: {
          mining: { metric: "mining", experience: 1886917, level: 79 },
          sailing: { metric: "sailing", experience: -1, level: 1 },
        },
        bosses: {
          zulrah: { metric: "zulrah", kills: 49 },
          vorkath: { metric: "vorkath", kills: 0 },
          nex: { metric: "nex", kills: -1 },
        },
        activities: {
          guardians_of_the_rift: { metric: "guardians_of_the_rift", score: 38 },
        },
      },
    },
  };
}

Deno.test("skillit, bossit ja aktiviteetit saavat omat mittarinsa", () => {
  const l = womMittareiksi(pelaaja());
  const arvo = (m: string) => l.find((x) => x.mittari === m);
  assertEquals(arvo("xp:mining"), { mittari: "xp:mining", arvo: 1886917, varmuus: "tarkka" });
  assertEquals(arvo("kc:zulrah"), { mittari: "kc:zulrah", arvo: 49, varmuus: "tarkka" });
  assertEquals(arvo("akt:guardians_of_the_rift")?.arvo, 38);
});

Deno.test("−1 tallennetaan alle rajan -tietona, nolla on tarkka", () => {
  const l = womMittareiksi(pelaaja());
  const arvo = (m: string) => l.find((x) => x.mittari === m);
  assertEquals(arvo("kc:nex"), { mittari: "kc:nex", arvo: 0, varmuus: "alle_rajan" });
  assertEquals(arvo("xp:sailing")?.varmuus, "alle_rajan");
  assertEquals(arvo("kc:vorkath"), { mittari: "kc:vorkath", arvo: 0, varmuus: "tarkka" });
});

Deno.test("WOM:n laskelmat ovat arvioita ja pyöristetään", () => {
  const l = womMittareiksi(pelaaja());
  assertEquals(l.find((x) => x.mittari === "tili:ehp"), { mittari: "tili:ehp", arvo: 223.322, varmuus: "arvio" });
  assertEquals(l.find((x) => x.mittari === "tili:ttm")?.arvo, 822.622);
  assertEquals(l.find((x) => x.mittari === "tili:combat")?.arvo, 111);
});

Deno.test("mittarien nimet ovat yksikäsitteisiä", () => {
  const nimet = womMittareiksi(pelaaja()).map((x) => x.mittari);
  assertEquals(new Set(nimet).size, nimet.length);
});

Deno.test("aikaleima tulee tilannekuvasta", () => {
  assertEquals(womAika(pelaaja()), "2026-11-15T17:36:21.000Z");
});

Deno.test("puuttuva tilannekuva on virhe", () => {
  assertThrows(() => womMittareiksi({ ...pelaaja(), latestSnapshot: null }));
});
