// Bossin lootin odotusarvo (GP per tappo) wikin droppitaulukosta ja GE-hinnoista.
// Puhdas funktio: wikin rivit ja hintahaku annetaan sisään.
//
// Wikin bucket('dropsline') antaa jokaiselle dropille harvinaisuuden, määrän ja
// rullat. Sen "Drop Value" on alch-arvo, joten hinnat tulevat erikseen
// prices.runescape.wikin GE-hinnoista.

export interface WikiDroppi {
  "Dropped item": string;
  Rarity: string;
  "Quantity Low": number | string;
  "Quantity High": number | string;
  Rolls?: number;
}

// "Always" → 1, "10/131" → 10/131, "1/1,397.33" → 1/1397.33. Muut ("Varies", "Rare") ohitetaan.
export function todennakoisyys(r: string): number | null {
  if (r === "Always") return 1;
  const m = r.replaceAll(",", "").match(/^\s*([\d.]+)\s*\/\s*([\d.]+)\s*$/);
  if (!m) return null;
  const p = Number(m[1]) / Number(m[2]);
  return Number.isFinite(p) && p > 0 && p <= 1 ? p : null;
}

// Hintahaun nimi: "Pure essence (noted)" → "Pure essence", "Pendant of Ates#Inert" → "Pendant of Ates".
export const hintanimi = (n: string) => n.replace(/\s*\(noted\)$/i, "").replace(/#.*$/, "").trim();

export function odotusarvo(rivit: WikiDroppi[], hinta: (nimi: string) => number | null) {
  const osat = new Map<string, number>();
  for (const r of rivit) {
    const p = todennakoisyys(r.Rarity);
    const lo = Number(r["Quantity Low"]), hi = Number(r["Quantity High"]);
    if (p === null || !Number.isFinite(lo) || !Number.isFinite(hi)) continue;
    const nimi = hintanimi(r["Dropped item"]);
    const h = nimi.toLowerCase() === "coins" ? 1 : hinta(nimi);
    if (!h) continue; // ei kaupattava (petit, avaimet, clue scrollit)
    const arvo = p * ((lo + hi) / 2) * h * (r.Rolls ?? 1);
    osat.set(nimi, (osat.get(nimi) ?? 0) + arvo);
  }
  const gpTappo = [...osat.values()].reduce((s, v) => s + v, 0);
  const erittely = [...osat].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([nimi, gp]) => ({ nimi, gp: Math.round(gp) }));
  return { gpTappo: Math.round(gpTappo), erittely };
}
