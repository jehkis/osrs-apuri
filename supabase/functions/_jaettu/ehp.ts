// XP-taulukko ja EHP-tahdit: kuinka monta tehokasta tuntia XP-väli vie.
// Tahdit tulevat WOM:n tehokkuustaulukosta (/efficiency/rates?metric=ehp&type=main).
// Bonus-XP (esim. Hitpoints combat-treenistä) jätetään tässä huomiotta.

export interface Menetelma {
  startExp: number;
  rate: number; // XP tunnissa tästä XP-määrästä alkaen
  description: string;
}

export const MAX_XP = 200_000_000;

const XP_TAULU: number[] = (() => {
  const t = [0, 0]; // indeksi = taso
  let summa = 0;
  for (let taso = 1; taso < 127; taso++) {
    summa += Math.floor(taso + 300 * Math.pow(2, taso / 7));
    t.push(Math.floor(summa / 4));
  }
  return t;
})();

export const XP_99 = XP_TAULU[99]; // 13 034 431

export function xpTasolle(taso: number): number {
  if (taso < 1 || taso > 126) throw new RangeError(`taso ${taso}`);
  return XP_TAULU[taso];
}

export function tasoXp(xp: number): number {
  let taso = 1;
  while (taso < 99 && XP_TAULU[taso + 1] <= xp) taso++;
  return taso;
}

function jarjestetty(m: Menetelma[]): Menetelma[] {
  return [...m].sort((a, b) => a.startExp - b.startExp);
}

// Tunnit XP-määrästä alku toiseen loppu. null, jos välille ei ole tahtia
// (skilli nousee vain bonuksena, esim. Magic ja Hitpoints).
export function tunnit(menetelmat: Menetelma[], alku: number, loppu: number): number | null {
  if (loppu <= alku) return 0;
  const m = jarjestetty(menetelmat);
  let h = 0;
  for (let i = 0; i < m.length; i++) {
    const ala = Math.max(alku, m[i].startExp);
    const yla = Math.min(loppu, i + 1 < m.length ? m[i + 1].startExp : Infinity);
    if (yla <= ala) continue;
    if (m[i].rate <= 0) return null;
    h += (yla - ala) / m[i].rate;
  }
  // Ensimmäistä menetelmää edeltävä väli on tahditon.
  if (m.length === 0 || alku < m[0].startExp) return null;
  return h;
}

// Käänteisesti: mihin XP-määrään päästään annetussa ajassa.
export function xpTunneista(menetelmat: Menetelma[], alku: number, h: number): number | null {
  const m = jarjestetty(menetelmat);
  if (m.length === 0 || alku < m[0].startExp) return null;
  let xp = alku;
  let jaljella = h;
  for (let i = 0; i < m.length && jaljella > 0; i++) {
    const yla = i + 1 < m.length ? m[i + 1].startExp : MAX_XP;
    if (yla <= xp) continue;
    if (m[i].rate <= 0) return null;
    const vali = Math.min(yla - xp, m[i].rate * jaljella);
    xp += vali;
    jaljella -= vali / m[i].rate;
  }
  return Math.min(xp, MAX_XP);
}
