import { assertEquals } from "jsr:@std/assert@1.0.8";
import { tulkitse } from "../supabase/functions/_jaettu/dink.ts";
import { loottiTila } from "../supabase/functions/_jaettu/projekti.ts";

const loot = (source: string, items: { name: string; quantity: number; priceEach: number }[], killCount: number | null = 120) => ({
  type: "LOOT",
  playerName: "Zei Kill",
  extra: { source, category: "NPC", killCount, items: items.map((i, n) => ({ id: n + 1, ...i })) },
});

Deno.test("projektin bossin lootti kirjataan arvoineen", () => {
  const t = tulkitse(loot("Giant Mole", [
    { name: "Big bones", quantity: 1, priceEach: 300 },
    { name: "Mole claw", quantity: 2, priceEach: 1000 },
  ]), "zei_kill");
  assertEquals(t.tyyppi, "lootti");
  if (t.tyyppi !== "lootti") return;
  assertEquals([t.bossi, t.kc, t.arvo, t.uniikit], ["giant_mole", 120, 2300, []]);
});

Deno.test("uniikki tunnistetaan pelin kirjoitusasusta", () => {
  const t = tulkitse(loot("Lunar Chest", [{ name: "Blood moon helm", quantity: 1, priceEach: 5_000_000 }], 40), "zei_kill");
  if (t.tyyppi !== "lootti") throw new Error(t.tyyppi);
  assertEquals([t.bossi, t.uniikit], ["lunar_chests", ["Blood Moon helm"]]);
});

Deno.test("muiden bossien lootti ja toisen pelaajan viesti ohitetaan", () => {
  assertEquals(tulkitse(loot("Zulrah", []), "zei_kill").tyyppi, "ohita");
  assertEquals(tulkitse({ ...loot("Giant Mole", []), playerName: "Joku Muu" }, "zei_kill").tyyppi, "ohita");
});

Deno.test("puuttuva KC on null", () => {
  const t = tulkitse(loot("Sarachnis", [{ name: "Sarachnis cudgel", quantity: 1, priceEach: 1 }], null), "zei_kill");
  if (t.tyyppi !== "lootti") throw new Error(t.tyyppi);
  assertEquals([t.kc, t.uniikit], [null, ["Sarachnis cudgel"]]);
});

Deno.test("projektin pet tunnistetaan bossilleen", () => {
  const t = tulkitse({ type: "PET", playerName: "zei_kill", extra: { petName: "Baby mole" } }, "zei_kill");
  assertEquals(t, { tyyppi: "pet", bossi: "giant_mole", esine: "Baby mole" });
  assertEquals(tulkitse({ type: "PET", playerName: "zei_kill", extra: { petName: "Ikkle hydra" } }, "zei_kill").tyyppi, "ohita");
});

Deno.test("lootin tila: GP/tappo ja arvio 3000 tapolle", () => {
  assertEquals(loottiTila(null, []), null);
  const l = loottiTila({ bossi: "amoxliatl", tappoja: 10, arvo: 500_000, alku: "2026-11-18T10:00:00Z" }, [
    { nimi: "a", maara: 1, arvo: 10 }, { nimi: "b", maara: 1, arvo: 300 }, { nimi: "c", maara: 1, arvo: 20 },
  ], 2)!;
  assertEquals([l.perTappo, l.arvio3000, l.parhaat.map((p) => p.nimi)], [50_000, 150_000_000, ["b", "c"]]);
});
