import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_AVAIN, SUPABASE_URL, TUNNUS } from "./asetukset.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_AVAIN);
const API = `${SUPABASE_URL}/functions/v1/api`;
const WIKI = "https://oldschool.runescape.wiki/w/";
const TAVOITE = 3000;
const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------- apurit

const luku = (n, desimaalit = 0) =>
  n.toLocaleString("fi-FI", { minimumFractionDigits: desimaalit, maximumFractionDigits: desimaalit });

const prosentti = (osuus) => `${luku(osuus * 100, osuus < 0.1 ? 1 : 0)} %`;

const harvinaisuus = (r) => `1/${luku(r, r % 1 ? 1 : 0)}`;

// GP lyhyesti: 950 k, 12,3 M, 1,25 B.
function gp(n) {
  if (n >= 1e9) return `${luku(n / 1e9, 2)} B`;
  if (n >= 1e6) return `${luku(n / 1e6, n >= 1e8 ? 0 : 1)} M`;
  if (n >= 1e3) return `${luku(n / 1e3, 0)} k`;
  return luku(n);
}

const lyhytKc = (v) => (v >= 1000 ? `${luku(v / 1000, v % 1000 ? 1 : 0)}k` : String(v));

function sitten(iso) {
  if (!iso) return "ei vielä";
  const min = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (min < 1) return "juuri nyt";
  if (min < 60) return `${min} min sitten`;
  const h = Math.round(min / 60);
  return h < 24 ? `${h} h sitten` : `${Math.round(h / 24)} pv sitten`;
}

const paiva = (iso) => new Date(iso).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric", year: "numeric" });
const kuukausi = (iso) => new Date(iso).toLocaleDateString("fi-FI", { month: "short", year: "numeric" });

function el(tag, attrs = {}, ...lapset) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? "" : v);
  }
  for (const l of lapset.flat()) if (l != null && l !== false) e.append(l);
  return e;
}

const palkki = (osuus, luokka = "") =>
  el("div", { class: `palkki ${luokka}` }, el("span", { style: `width:${Math.min(100, Math.max(0, osuus * 100))}%` }));

let ilmoitusAjastin;
function ilmoita(teksti) {
  const i = $("ilmoitus");
  i.textContent = teksti;
  i.hidden = false;
  clearTimeout(ilmoitusAjastin);
  ilmoitusAjastin = setTimeout(() => (i.hidden = true), 4000);
}

// ---------------------------------------------------------------- rajapinta

async function kutsu(polku, valinnat = {}) {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("kirjaudu sisään");
  const v = await fetch(`${API}${polku}`, {
    ...valinnat,
    headers: { Authorization: `Bearer ${data.session.access_token}`, "Content-Type": "application/json" },
  });
  const json = await v.json().catch(() => ({}));
  if (v.status === 401) {
    await supabase.auth.signOut();
    nayta(null);
    throw new Error("istunto vanheni, kirjaudu uudelleen");
  }
  if (!v.ok) throw new Error(json.virhe ?? `palvelin vastasi ${v.status}`);
  return json;
}

// ---------------------------------------------------------------- piirto

function lukukortti(nimi, arvo, lisa, luokka = "") {
  return el("div", { class: `kortti luku ${luokka}` },
    el("div", { class: "nimi" }, nimi), el("div", { class: "arvo" }, arvo), lisa && el("div", { class: "lisa" }, lisa));
}

function piirraLuvut(y) {
  $("luvut").replaceChildren(
    lukukortti("Yhteensä", [luku(y.kc), el("small", {}, `/ ${luku(y.tavoite)}`)],
      [palkki(y.osuus), el("span", {}, `${prosentti(y.osuus)} · projektissa +${luku(y.projektissa)}`)], "korostus"),
    lukukortti("Tahti", y.viikossa === null ? "–" : [luku(y.viikossa, y.viikossa < 10 ? 1 : 0), el("small", {}, "KC/vko")],
      y.viikossa === null ? "Lasketaan, kun historiaa on 3 päivää" : "Viiden bossin yhteistahti, 28 pv"),
    lukukortti("Valmis", y.valmistuu ? kuukausi(y.valmistuu) : "–",
      y.valmistuu ? `Hitain bossi, ${paiva(y.valmistuu)}` : "Joka bossilla pitää olla tahti"),
    lukukortti("Uniikit", [luku(y.uniikkejaSaatu), el("small", {}, `/ ${y.uniikkejaYhteensa}`)], "Eri uniikkia saatu"),
    lukukortti("Lootti", y.gpBosseja ? [gp(y.gp), el("small", {}, "gp")] : "–",
      y.gpBosseja
        ? `3000 tapolla ~${gp(y.gpArvio)} gp${y.gpBosseja < 5 ? ` (${y.gpBosseja}/5 bossista dataa)` : ""}`
        : "Kertyy, kun Dink lähettää ensimmäisen lootin"),
  );
}

function virstanpylvaat(b) {
  const lista = [100, 250, 500, 1000, 1500, 2000, 2500, 3000];
  return el("ol", { class: "virstat", "aria-label": "Virstanpylväät" },
    lista.map((v) => {
      const tehty = b.virstanpylvaat.saavutetut.includes(v);
      const seuraava = b.virstanpylvaat.seuraava === v;
      return el("li", { class: tehty ? "tehty" : seuraava ? "seuraava" : "", title: `${v} KC` }, lyhytKc(v));
    }));
}

// Avoinna oleva kirjauslomake: `${bossi}|${esine}`, säilyy uudelleenpiirrossa.
let avoinLomake = null;

function kirjauslomake(b, u) {
  const syote = el("input", { type: "number", min: "0", step: "1", value: b.kc, "aria-label": "KC dropin kohdalla" });
  return el("form", {
    class: "kirjaus",
    onsubmit: async (ev) => {
      ev.preventDefault();
      const kc = Number(syote.value);
      if (!Number.isInteger(kc) || kc < 0) return ilmoita("KC:n pitää olla kokonaisluku.");
      const nappi = ev.submitter;
      nappi.disabled = true;
      try {
        avoinLomake = null;
        piirra(await kutsu("/droppi", { method: "POST", body: JSON.stringify({ bossi: b.id, esine: u.nimi, kc }) }));
        ilmoita(u.pet ? `${u.nimi}! Pet tuli KC:lla ${kc}.` : `${u.nimi} kirjattu KC:lla ${kc}. Grats!`);
      } catch (e) {
        nappi.disabled = false;
        ilmoita(`Kirjaus epäonnistui: ${e.message}`);
      }
    },
  },
  el("label", {}, "KC", syote),
  el("button", { type: "submit" }, "Tallenna"),
  el("button", { type: "button", class: "haamu", onclick: () => { avoinLomake = null; piirra(viimeisin); } }, "Peru"));
}

async function poista(d, nappi) {
  nappi.disabled = true;
  try {
    piirra(await kutsu(`/droppi/${d.id}`, { method: "DELETE" }));
    ilmoita("Kirjaus poistettu.");
  } catch (e) {
    nappi.disabled = false;
    ilmoita(`Poisto epäonnistui: ${e.message}`);
  }
}

function uniikkirivi(b, u) {
  const avain = `${b.id}|${u.nimi}`;
  const saatu = u.saadut.length > 0;
  const kuivuus = u.kuivana === 0 ? null : el("span", { class: u.kertaa >= 1 ? "kuiva yli" : "kuiva" },
    `${saatu ? "Viime dropista" : "Dry"} ${luku(u.kuivana)} KC · ${luku(u.kertaa, 2)}× rate · ${prosentti(u.todennakoisyys)} olisi jo saanut`);
  return el("li", { class: `uniikki ${saatu ? "saatu" : ""}` },
    el("div", { class: "uniikki-rivi" },
      el("span", { class: "tila", "aria-hidden": "true" }, saatu ? "✓" : ""),
      el("a", { class: "uniikki-nimi linkki", href: WIKI + encodeURIComponent(u.nimi.replaceAll(" ", "_")), target: "_blank", rel: "noopener" },
        u.nimi),
      u.pet && el("span", { class: "merkinta kulta" }, "pet"),
      el("span", { class: "rate", title: u.huomio ?? `Keskimäärin ${harvinaisuus(u.harvinaisuus)} per tappo` },
        harvinaisuus(u.harvinaisuus)),
      avoinLomake === avain ? null : el("button", {
        class: "pieni toissijainen",
        onclick: () => { avoinLomake = avain; piirra(viimeisin); },
      }, saatu ? "+1" : "Sain")),
    u.saadut.length > 0 && el("div", { class: "saadut" },
      u.saadut.map((d) => el("span", { class: "saatu-kc" }, `KC ${luku(d.kc)}`,
        el("button", { class: "poista", title: "Poista kirjaus", "aria-label": `Poista ${u.nimi} KC ${d.kc}`, onclick: (ev) => poista(d, ev.currentTarget) }, "×")))),
    kuivuus && el("div", { class: "kuivuus" }, kuivuus),
    avoinLomake === avain && kirjauslomake(b, u));
}

function uniikit(b) {
  const ryhmat = new Map();
  for (const u of b.uniikit) {
    const r = u.ryhma ?? "";
    ryhmat.set(r, [...(ryhmat.get(r) ?? []), u]);
  }
  return [...ryhmat].map(([nimi, lista]) => el("div", { class: "uniikkiryhma" },
    nimi && el("h4", {}, nimi, el("span", { class: "hiljainen" }, ` ${lista.filter((u) => u.saadut.length).length}/${lista.length}`)),
    el("ul", { class: "uniikit" }, lista.map((u) => uniikkirivi(b, u)))));
}

function bossikortti(b) {
  const valmis = b.kc >= TAVOITE;
  const v = b.virstanpylvaat;
  const tahti = b.tahti.viikossa === null
    ? "Tahti lasketaan, kun historiaa on 3 päivää"
    : `${luku(b.tahti.viikossa, b.tahti.viikossa < 10 ? 1 : 0)} KC/vko${b.valmistuu && !valmis ? ` · valmis ${kuukausi(b.valmistuu)}` : ""}`;
  const ryhmitelty = b.uniikit.some((u) => u.ryhma);
  return el("article", { class: `kortti bossi ${valmis ? "valmis" : ""} ${ryhmitelty ? "levea" : ""}` },
    el("header", { class: "bossi-otsikko" },
      el("div", {},
        el("h3", {}, el("a", { class: "linkki", href: WIKI + b.wiki, target: "_blank", rel: "noopener" }, b.nimi)),
        el("p", { class: "hiljainen" }, b.lempinimi)),
      el("div", { class: "kc" }, luku(b.kc), el("small", {}, ` / ${luku(TAVOITE)}`))),
    palkki(b.osuus, valmis ? "valmis" : ""),
    el("div", { class: "bossi-tiedot" },
      el("span", {}, valmis ? "3000 KC valmis!" : `Seuraava ${luku(v.seuraava)}: ${luku(v.puuttuu)} KC`),
      el("span", {}, tahti)),
    virstanpylvaat(b),
    b.id === "lunar_chests" && el("p", { class: "huomio" }, "KC = avatut arkut. Haarniskasarjassa ei tule tuplia, ennen kuin sarja on täysi."),
    lootti(b),
    ryhmitelty ? el("div", { class: "sarjat" }, uniikit(b)) : uniikit(b));
}

function lootti(b) {
  const l = b.lootti;
  if (!l) return el("p", { class: "huomio" }, "Lootti: ei vielä Dink-dataa.");
  return el("div", { class: "lootti" },
    el("div", { class: "lootti-luvut" },
      el("span", {}, el("strong", {}, `${gp(l.arvo)} gp`), ` · ${luku(l.tappoja)} ${b.id === "lunar_chests" ? "arkkua" : "tappoa"}`),
      el("span", {}, `${gp(l.perTappo)}/kpl · 3000: ~${gp(l.arvio3000)}`)),
    el("ul", { class: "lootti-parhaat" }, l.parhaat.map((e) =>
      el("li", {}, el("span", {}, `${e.nimi}${e.maara > 1 ? ` ×${luku(e.maara)}` : ""}`), el("span", { class: "numero" }, gp(e.arvo))))));
}

function piirraDropit(lista) {
  $("dropit-osio").hidden = lista.length === 0;
  $("dropit").replaceChildren(...lista.map((d) => el("li", { class: "kortti" },
    el("span", {}, el("strong", {}, d.esine), ` · ${d.bossiNimi}`),
    el("span", { class: "hiljainen numero" }, `KC ${luku(d.kc)} · ${paiva(d.aika)}`))));
}

function piirraLahteet(w) {
  $("lahteet").replaceChildren(...[
    el("span", {}, `WOM päivitetty ${sitten(w.paivitetty)}`),
    w.virhe && el("span", { class: "virhe" }, `Viimeisin virhe: ${w.virhe}`),
    el("span", {}, "Haku tunnin välein. Dropit kirjataan käsin."),
  ].filter(Boolean));
}

let viimeisin = null;
function piirra(t) {
  viimeisin = t;
  piirraLuvut(t.yhteenveto);
  $("bossit").replaceChildren(...t.bossit.map(bossikortti));
  piirraDropit(t.viimeisimmat);
  piirraLahteet(t.wom);
}

async function lataa() {
  try {
    piirra(await kutsu("/tilanne"));
  } catch (e) {
    ilmoita(`Lataus epäonnistui: ${e.message}`);
  }
}

// ---------------------------------------------------------------- tapahtumat

$("paivita").addEventListener("click", async (ev) => {
  const nappi = ev.currentTarget;
  nappi.disabled = true;
  nappi.textContent = "Päivitetään…";
  try {
    const r = await kutsu("/paivita", { method: "POST" });
    piirra(r.tilanne);
    ilmoita(r.kirjattu > 0 ? `${r.kirjattu} mittaria päivittyi.` : "Ei uutta dataa.");
  } catch (e) {
    ilmoita(`Päivitys epäonnistui: ${e.message}`);
  } finally {
    nappi.disabled = false;
    nappi.textContent = "Päivitä nyt";
  }
});

$("kirjaudu").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const nappi = ev.submitter;
  nappi.disabled = true;
  $("kirjautumisvirhe").textContent = "";
  const { data, error } = await supabase.auth.signInWithPassword({ email: TUNNUS, password: $("salasana").value });
  nappi.disabled = false;
  if (error) {
    $("kirjautumisvirhe").textContent = "Väärä salasana.";
    return;
  }
  $("salasana").value = "";
  nayta(data.session);
});

$("ulos").addEventListener("click", async () => {
  await supabase.auth.signOut();
  nayta(null);
});

let ajastin;
function nayta(istunto) {
  $("kirjautuminen").hidden = !!istunto;
  $("sovellus").hidden = !istunto;
  clearInterval(ajastin);
  if (istunto) {
    lataa();
    // Pidä sivu ajan tasalla pelatessa, mutta älä sotke auki olevaa kirjauslomaketta.
    ajastin = setInterval(() => document.visibilityState === "visible" && !avoinLomake && lataa(), 5 * 60_000);
  }
}

document.querySelector('input[name="username"]').value = TUNNUS;
const { data } = await supabase.auth.getSession();
nayta(data.session);
