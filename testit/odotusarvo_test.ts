import { assertAlmostEquals, assertEquals } from "jsr:@std/assert@1.0.8";
import { hintanimi, odotusarvo, todennakoisyys } from "../supabase/functions/_jaettu/odotusarvo.ts";
import { kassa } from "../supabase/functions/_jaettu/projekti.ts";

Deno.test("harvinaisuudet tulkitaan wikin muodoista", () => {
  assertEquals(todennakoisyys("Always"), 1);
  assertAlmostEquals(todennakoisyys("10/131")!, 10 / 131, 1e-12);
  assertAlmostEquals(todennakoisyys("1/1,397.33")!, 1 / 1397.33, 1e-12);
  assertEquals(todennakoisyys("Varies"), null);
});

Deno.test("hintanimestä poistetaan noted ja wikin tarkenne", () => {
  assertEquals(hintanimi("Yew logs (noted)"), "Yew logs");
  assertEquals(hintanimi("Pendant of Ates#Inert"), "Pendant of Ates");
});

Deno.test("odotusarvo: todennäköisyys × keskimäärä × hinta × rullat", () => {
  const hinnat: Record<string, number> = { "Mole skin": 4000, "Blood rune": 400 };
  const o = odotusarvo([
    { "Dropped item": "Mole skin", Rarity: "Always", "Quantity Low": 1, "Quantity High": 3 }, // 2 × 4000
    { "Dropped item": "Blood rune (noted)", Rarity: "1/10", "Quantity Low": 100, "Quantity High": 100, Rolls: 2 }, // 0.1 × 100 × 400 × 2
    { "Dropped item": "Coins", Rarity: "1/2", "Quantity Low": 1000, "Quantity High": 3000 }, // 0.5 × 2000 × 1
    { "Dropped item": "Baby mole", Rarity: "1/3000", "Quantity Low": 1, "Quantity High": 1 }, // ei hintaa
  ], (n) => hinnat[n] ?? null);
  assertEquals(o.gpTappo, 8000 + 8000 + 1000);
  assertEquals(o.erittely.map((e) => e.nimi), ["Mole skin", "Blood rune", "Coins"]);
});

Deno.test("kassa: tavoite 3000 × odotusarvo ja tuuri samoilla tapoilla", () => {
  const bossit = [
    { id: "a", nimi: "A", lootti: { tappoja: 10, arvo: 300_000, perTappo: 30_000, arvio3000: 0, alku: "", parhaat: [] } },
    { id: "b", nimi: "B" },
  ];
  const k = kassa(bossit, [{ bossi: "a", gpTappo: 20_000, erittely: [] }, { bossi: "b", gpTappo: 10_000, erittely: [] }]);
  assertEquals([k.gp, k.tavoite, k.odotettu, k.tuuri], [300_000, 90_000_000, 200_000, 1.5]);
  assertAlmostEquals(k.osuus, 300_000 / 90_000_000, 1e-12);
  // Puuttuva odotusarvo: ei tavoitetta, mutta kertynyt GP näkyy.
  assertEquals(kassa(bossit, []).tavoite, null);
});
