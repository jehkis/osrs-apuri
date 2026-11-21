import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { SUPABASE_AVAIN, SUPABASE_URL, TUNNUS } from "./asetukset.js";

const supabase = createClient(SUPABASE_URL, SUPABASE_AVAIN);
const API = `${SUPABASE_URL}/functions/v1/api`;
const WIKI = "https://oldschool.runescape.wiki/w/";
const TAVOITE = 3000;
// $ on jQuery (ladataan index.html:ssä). Valitsimet ovat CSS-valitsimia: "#id", ".luokka".

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

// Ilmoitus näytetään Bootstrapin toastina. Teksti asetetaan jQuerylla, ja Bootstrapin
// JavaScript-olio (bootstrap.Toast) hoitaa näyttämisen ja piilotuksen 4 sekunnin päästä.
// Bootstrap haluaa tavallisen DOM-elementin, joten jQuery-oliosta otetaan [0].
function ilmoita(teksti) {
  const $toast = $("#ilmoitus");
  $toast.find(".toast-body").text(teksti);
  bootstrap.Toast.getOrCreateInstance($toast[0], { delay: 4000 }).show();
}

// ---------------------------------------------------------------- rajapinta

// Kaikki palvelinkutsut kulkevat tämän kautta. AJAX-pyyntö tehdään jQueryn $.ajaxilla.
// polku: esim. "/tilanne", valinnat: { method: "POST", body: JSON-merkkijono }.
async function kutsu(polku, valinnat = {}) {
  // Kirjautumisen tunniste (JWT) Supabasesta; palvelin tarkistaa sen joka pyynnöllä.
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error("kirjaudu sisään");
  try {
    // $.ajax palauttaa jqXHR-olion, jota voi odottaa awaitilla kuten Promisea.
    return await $.ajax({
      url: API + polku,
      method: valinnat.method ?? "GET",
      data: valinnat.body,               // lähetettävä data (valmiiksi JSON-merkkijono)
      contentType: "application/json",   // kertoo palvelimelle, että data on JSONia
      dataType: "json",                  // jQuery muuttaa vastauksen JS-olioksi itse
      headers: { Authorization: `Bearer ${data.session.access_token}` },
    });
  } catch (xhr) {
    // Toisin kuin fetch, jQuery hylkää virhestatukset (4xx/5xx), joten ne tulevat tänne.
    if (xhr.status === 401) {
      await supabase.auth.signOut();
      nayta(null);
      throw new Error("istunto vanheni, kirjaudu uudelleen");
    }
    // responseJSON on palvelimen virheviesti JSONina, jos sellainen tuli. Status 0 = ei yhteyttä.
    throw new Error(xhr.responseJSON?.virhe ?? (xhr.status ? `palvelin vastasi ${xhr.status}` : "ei yhteyttä palvelimeen"));
  }
}

// ---------------------------------------------------------------- piirto

function lukukortti(nimi, arvo, lisa, luokka = "") {
  return el("div", { class: `kortti luku ${luokka}` },
    el("div", { class: "nimi" }, nimi), el("div", { class: "arvo" }, arvo), lisa && el("div", { class: "lisa" }, lisa));
}

function piirraLuvut(y) {
  // empty() tyhjentää vanhan sisällön, append() lisää uudet elementit.
  $("#luvut").empty().append(
    lukukortti("Yhteensä", [luku(y.kc), el("small", {}, `/ ${luku(y.tavoite)}`)],
      `${prosentti(y.osuus)} · projektissa +${luku(y.projektissa)}`, "korostus"),
    lukukortti("Tahti", y.viikossa === null ? "–" : [luku(y.viikossa, y.viikossa < 10 ? 1 : 0), el("small", {}, "KC/vko")],
      y.viikossa === null ? "Lasketaan, kun historiaa on 3 päivää" : "Viiden bossin yhteistahti, 28 pv"),
    lukukortti("Valmis", y.valmistuu ? kuukausi(y.valmistuu) : "–",
      y.valmistuu ? `Hitain bossi, ${paiva(y.valmistuu)}` : "Joka bossilla pitää olla tahti"),
    lukukortti("Uniikit", [luku(y.uniikkejaSaatu), el("small", {}, `/ ${y.uniikkejaYhteensa}`)], "Eri uniikkia saatu"),
  );
}

// Kassa: kolikkokasa täyttyy alhaalta ylös, kun Dinkin lootti kertyy kohti
// viiden bossin 3000 tapon odotettua tuottoa.

function tarkkaProsentti(osuus) {
  if (osuus === 0) return "0 %";
  if (osuus < 0.001) return `${luku(osuus * 100, 3)} %`;
  return prosentti(osuus);
}

function piirraKassa(k, bossit) {
  const tuuri = k.tuuri === null ? null : k.tuuri - 1;
  const varit = new Map(bossit.map((b) => [b.id, b.lempinimi]));
  $("#kassa").empty().append(
    el("div", { class: "kolikot", role: "img", "aria-label": `Kassa ${tarkkaProsentti(k.osuus)} täynnä`, style: `--taytto:${k.osuus * 100}%` },
      el("img", { class: "kolikot-pohja", src: KOLIKOT, alt: "" }),
      el("div", { class: "kolikot-taytto" }, el("img", { src: KOLIKOT, alt: "" })),
      k.osuus > 0 && k.osuus < 1 && el("div", { class: "kolikot-raja" })),
    el("div", { class: "kassa-tiedot" },
      el("h2", {}, "Kassa"),
      el("div", { class: "kassa-summa" }, gp(k.gp), el("small", {}, k.tavoite ? ` / ${gp(k.tavoite)} gp` : " gp")),
      el("div", { class: "hiljainen" }, k.tavoite
        ? `${tarkkaProsentti(k.osuus)} viiden bossin 3000 tapon odotetusta tuotosta`
        : "Tavoite lasketaan wikin droppitaulukoista seuraavalla haulla"),
      tuuri !== null && el("div", { class: `tuuri ${tuuri >= 0 ? "plus" : "miinus"}` },
        `Tuuri ${tuuri >= 0 ? "+" : "−"}${luku(Math.abs(tuuri) * 100)} % odotukseen nähden (${gp(k.odotettu)} odotettu samoilla tapoilla)`),
      el("ul", { class: "kassa-bossit" }, k.bossit.map((r) =>
        el("li", { class: `b-${r.id}` },
          el("span", { class: "pallo" }),
          el("span", { class: "kb-nimi" }, varit.get(r.id) ?? r.nimi),
          el("span", { class: "kb-palkki" }, el("span", { style: `width:${r.tavoite ? Math.min(100, (r.gp / r.tavoite) * 100) : 0}%` })),
          el("span", { class: "numero kb-luvut" }, `${gp(r.gp)} / ${r.tavoite ? gp(r.tavoite) : "–"}`),
          el("span", { class: "numero hiljainen kb-ev", title: "Odotusarvo per tappo wikin droppitaulukosta ja GE-hinnoista" },
            r.gpTappo ? `${gp(r.gpTappo)}/tappo` : "")))),
    ),
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

// Wikin kuvat: esineet täysikokoisina, bossit 120 px:n esikatseluna.
const KUVAT = "https://oldschool.runescape.wiki/images/";
const tiedosto = (f) => encodeURIComponent(f.replaceAll(" ", "_"));
const esineKuva = (f) => KUVAT + tiedosto(f);
const bossiKuva = (f) => `${KUVAT}thumb/${tiedosto(f)}/120px-${tiedosto(f)}`;
const KOLIKOT = `${KUVAT}thumb/Coins_detail.png/320px-Coins_detail.png`;

// Valittu uniikki (`${bossi}|${esine}`). Säilyy uudelleenpiirrossa.
let valittu = null;

function valitse(avain) {
  valittu = valittu === avain ? null : avain;
  piirra(viimeisin);
}

// ---------------------------------------------------------------- kirjaus (Bootstrap-modaali)

// Mitä ollaan kirjaamassa: { b: bossi, u: uniikki }. Asetetaan, kun modaali avataan.
let kirjattava = null;
const kirjausIkkuna = () => bootstrap.Modal.getOrCreateInstance($("#kirjaus")[0]);
const kirjausAuki = () => $("#kirjaus").hasClass("show");

// Täyttää modaalin esineen tiedoilla jQuerylla ja avaa sen.
function avaaKirjaus(b, u) {
  kirjattava = { b, u };
  $("#kirjaus-otsikko").text(u.nimi);
  $("#kirjaus-kuva").attr("src", esineKuva(u.kuva));
  $("#kirjaus-kc").val(b.kc);
  $("#kirjaus-ohje").text(`${b.nimi}, nykyinen KC ${luku(b.kc)}`);
  kirjausIkkuna().show();
}

// Kun modaali on avautunut, kursori KC-kenttään. shown.bs.modal on Bootstrapin oma tapahtuma.
$("#kirjaus").on("shown.bs.modal", () => $("#kirjaus-kc").trigger("focus").trigger("select"));

// Lomakkeen lähetys: tarkistus, AJAX-kutsu ja modaalin sulkeminen.
$("#kirjaus-lomake").on("submit", async function (ev) {
  ev.preventDefault();
  const { b, u } = kirjattava;
  const kc = Number($("#kirjaus-kc").val());
  if (!Number.isInteger(kc) || kc < 0) return ilmoita("KC:n pitää olla kokonaisluku.");
  const $nappi = $(this).find("button[type=submit]").prop("disabled", true);
  try {
    piirra(await kutsu("/droppi", { method: "POST", body: JSON.stringify({ bossi: b.id, esine: u.nimi, kc }) }));
    kirjausIkkuna().hide();
    ilmoita(u.pet ? `${u.nimi}! Pet tuli KC:lla ${kc}.` : `${u.nimi} kirjattu KC:lla ${kc}. Grats!`);
  } catch (e) {
    ilmoita(`Kirjaus epäonnistui: ${e.message}`);
  } finally {
    $nappi.prop("disabled", false);
  }
});


// Collection log -ruutu: saamaton harmaa, saatu värillinen. Punainen piste = dry yli raten.
function ruutu(b, u) {
  const avain = `${b.id}|${u.nimi}`;
  const saatu = u.saadut.length > 0;
  const luokat = ["ruutu", saatu && "saatu", valittu === avain && "valittu", !saatu && u.kertaa >= 1 && "yli"].filter(Boolean);
  return el("button", {
    class: luokat.join(" "),
    title: `${u.nimi} · ${harvinaisuus(u.harvinaisuus)}${saatu ? ` · saatu ${u.saadut.length}×` : ""}`,
    "aria-label": `${u.nimi}, ${saatu ? `saatu ${u.saadut.length} kertaa` : "ei saatu"}`,
    "aria-pressed": valittu === avain ? "true" : "false",
    "data-avain": avain, // delegoitu kuuntelija lukee tämän: $(this).data("avain")
  },
  el("img", { src: esineKuva(u.kuva), alt: "", loading: "lazy", decoding: "async" }),
  u.pet && el("span", { class: "ruutu-pet" }, "pet"),
  u.saadut.length > 1 && el("span", { class: "ruutu-maara" }, `×${u.saadut.length}`));
}

function uniikkiTiedot(b, u) {
  const saatu = u.saadut.length > 0;
  const kuivaLuokka = u.kertaa >= 2 ? "kuiva yli" : u.kertaa >= 1 ? "kuiva raja" : "kuiva";
  return el("div", { class: "tiedot-paneeli" },
    el("div", { class: "tiedot-otsikko" },
      el("img", { src: esineKuva(u.kuva), alt: "" }),
      el("div", {},
        el("a", { class: "linkki tiedot-nimi", href: WIKI + encodeURIComponent(u.nimi.replaceAll(" ", "_")), target: "_blank", rel: "noopener" }, u.nimi),
        el("div", { class: "hiljainen" },
          `${harvinaisuus(u.harvinaisuus)}${u.pet ? " · pet" : ""}`, u.huomio && ` · ${u.huomio}`)),
      el("button", { class: "btn btn-sm btn-outline-warning kirjaa", "data-avain": `${b.id}|${u.nimi}` }, saatu ? "+1" : "Sain")),
    u.kuivana > 0 && el("div", { class: kuivaLuokka },
      `${saatu ? "Viime dropista" : "Dry"} ${luku(u.kuivana)} KC · ${luku(u.kertaa, 2)}× rate · ${prosentti(u.todennakoisyys)} olisi jo saanut`),
    saatu && el("div", { class: "saadut" },
      u.saadut.map((d) => el("span", { class: "saatu-kc" }, `KC ${luku(d.kc)}`,
        el("button", { class: "poista", title: "Poista kirjaus", "aria-label": `Poista ${u.nimi} KC ${d.kc}`, "data-id": d.id }, "×")))),
  );
}

function uniikit(b) {
  const ryhmat = new Map();
  for (const u of b.uniikit) {
    const r = u.ryhma ?? "";
    ryhmat.set(r, [...(ryhmat.get(r) ?? []), u]);
  }
  const avattu = b.uniikit.find((u) => valittu === `${b.id}|${u.nimi}`);
  const saatuja = b.uniikit.filter((u) => u.saadut.length).length;
  return el("div", { class: "kokoelma" },
    el("div", { class: "kokoelma-otsikko" },
      el("span", {}, "Uniikit"), el("span", { class: "numero" }, `${saatuja}/${b.uniikit.length}`)),
    el("div", { class: ryhmat.size > 1 ? "sarjat" : "" },
      [...ryhmat].map(([nimi, lista]) => el("div", { class: "uniikkiryhma" },
        nimi && el("h4", {}, nimi, el("span", { class: "hiljainen" }, ` ${lista.filter((u) => u.saadut.length).length}/${lista.length}`)),
        el("div", { class: "ruudukko" }, lista.map((u) => ruutu(b, u)))))),
    avattu && uniikkiTiedot(b, avattu));
}

// Bossin otsikko: kuva, nimi, lempinimi ja KC. Yhteinen kompaktille kortille ja bossinäkymälle.
// wikiin: nimi on linkki wikiin (vain bossinäkymässä, koska kompaktin kortin klikkaus avaa näkymän).
function bossiOtsikko(b, wikiin) {
  return el("header", { class: "bossi-otsikko" },
    el("div", { class: "bossi-kuva" }, el("img", { src: bossiKuva(b.kuva), alt: "", loading: "lazy", decoding: "async" })),
    el("div", { class: "bossi-nimi" },
      el("h3", {}, wikiin ? el("a", { class: "linkki", href: WIKI + b.wiki, target: "_blank", rel: "noopener" }, b.nimi) : b.nimi),
      el("p", { class: "hiljainen" }, b.lempinimi)),
    // kc-luku omassa spanissaan, jotta juhlinnan laskuri voi animoida pelkän luvun.
    el("div", { class: "kc" }, el("span", { class: "kc-luku", "data-bossi": b.id }, luku(b.kc)), el("small", {}, ` / ${luku(TAVOITE)}`)));
}

// Seuraava virstanpylväs ja tahti yhdellä rivillä.
function bossiTiedot(b) {
  const valmis = b.kc >= TAVOITE;
  const v = b.virstanpylvaat;
  const tahti = b.tahti.viikossa === null
    ? "Tahti lasketaan, kun historiaa on 3 päivää"
    : `${luku(b.tahti.viikossa, b.tahti.viikossa < 10 ? 1 : 0)} KC/vko${b.valmistuu && !valmis ? ` · valmis ${kuukausi(b.valmistuu)}` : ""}`;
  return el("div", { class: "bossi-tiedot" },
    el("span", {}, valmis ? "3000 KC valmis!" : `Seuraava ${luku(v.seuraava)}: ${luku(v.puuttuu)} KC`),
    el("span", {}, tahti));
}

// Yleisnäkymän tiivis kortti. Koko kortti on klikattava (delegoitu kuuntelija alempana),
// ja data-bossi kertoo kuuntelijalle, mikä bossi avataan.
function bossiKompakti(b) {
  const valmis = b.kc >= TAVOITE;
  const saatuja = b.uniikit.filter((u) => u.saadut.length).length;
  return el("article", {
    class: `kortti bossi kompakti b-${b.id} ${valmis ? "valmis" : ""}`,
    id: `bossi-${b.id}`, "data-bossi": b.id, tabindex: "0", role: "link", "aria-label": `Avaa ${b.nimi}`,
  },
  bossiOtsikko(b, false),
  palkki(b.osuus, valmis ? "valmis" : "bossin"),
  bossiTiedot(b),
  el("div", { class: "mini-uniikit", "aria-hidden": "true" },
    b.uniikit.map((u) => el("img", { class: u.saadut.length ? "saatu" : "", src: esineKuva(u.kuva), alt: "", loading: "lazy" }))),
  el("div", { class: "kompakti-ala" },
    el("span", {}, `Uniikit ${saatuja}/${b.uniikit.length}${b.lootti ? ` · ${gp(b.lootti.arvo)} gp` : ""}`),
    el("span", { class: "avaa" }, "Avaa →")));
}

// Bossinäkymän aktiivinen välilehti. Säilyy, kun sivu piirretään uudelleen (5 min välein).
let valilehti = "uniikit";

// Bootstrapin välilehdet (nav-tabs + tab-content). Bootstrapin JavaScript vaihtaa välilehteä
// data-bs-toggle="tab" -napeista; app.js vain piirtää rakenteen.
function valilehdet(b) {
  const lehdet = [
    ["uniikit", "Uniikit", uniikit(b)],
    ["kayra", "KC-käyrä", el("div", { class: "kayra" },
      el("canvas", { id: "kc-kaavio", role: "img", "aria-label": `${b.nimi}: KC:n kehitys viimeiset 28 päivää` }))],
    ["lootti", "Lootti", lootti(b)],
  ];
  return el("div", { class: "valilehdet" },
    el("ul", { class: "nav nav-tabs", role: "tablist" }, lehdet.map(([id, nimi]) =>
      el("li", { class: "nav-item", role: "presentation" },
        el("button", {
          class: `nav-link ${valilehti === id ? "active" : ""}`, type: "button", role: "tab",
          "data-bs-toggle": "tab", "data-bs-target": `#vl-${id}`, "data-valilehti": id,
          "aria-controls": `vl-${id}`, "aria-selected": valilehti === id ? "true" : "false",
        }, nimi)))),
    el("div", { class: "tab-content" }, lehdet.map(([id, , sisalto]) =>
      el("div", { class: `tab-pane fade ${valilehti === id ? "show active" : ""}`, id: `vl-${id}`, role: "tabpanel" }, sisalto))));
}

// Yhden bossin näkymä: kaikki tiedot ja välilehdet.
function bossiTarkka(b) {
  const valmis = b.kc >= TAVOITE;
  return el("div", {},
    el("a", { class: "takaisin", href: "#" }, "← Kaikki bossit"),
    el("article", { class: `kortti bossi b-${b.id} ${valmis ? "valmis" : ""}` },
      bossiOtsikko(b, true),
      palkki(b.osuus, valmis ? "valmis" : "bossin"),
      bossiTiedot(b),
      kcLahde(b),
      virstanpylvaat(b),
      b.id === "lunar_chests" && el("p", { class: "huomio" }, "KC = avatut arkut. Haarniskasarjassa ei tule tuplia, ennen kuin sarja on täysi."),
      valilehdet(b)));
}

// ---------------------------------------------------------------- KC-käyrä (Chart.js)

// Nykyinen Chart-olio. Vanha pitää tuhota (destroy) ennen uutta, muuten Chart.js varoittaa,
// että canvas on jo käytössä, ja vanhat tapahtumakuuntelijat jäävät muistiin.
let kaavio = null;

// Piirtää bossin KC:n kehityksen viivakaaviona. Data tulee palvelimelta (b.kayra: [{ aika, kc }]).
// animoi = false automaattisessa päivityksessä, jotta kaavio ei "hyppää" 5 minuutin välein.
function piirraKaavio(b, animoi) {
  kaavio?.destroy();
  kaavio = null;
  const $canvas = $("#kc-kaavio");
  if (!b || !$canvas.length) return;
  // ?? [] suojaa, jos palvelin on vanhempi versio eikä vielä palauta käyrää.
  if ((b.kayra ?? []).length < 2) {
    $canvas.parent().empty().append(el("p", { class: "huomio" }, "Käyrä piirretään, kun KC-historiaa kertyy."));
    return;
  }
  // Värit CSS-muuttujista, jotta kaavio seuraa bossin väriä sekä vaaleaa ja tummaa teemaa.
  const css = getComputedStyle($canvas.closest(".bossi")[0]);
  const vari = (nimi) => css.getPropertyValue(nimi).trim();
  const bossinVari = vari("--bossi");
  const pisteet = b.kayra.map((p) => ({ x: Date.parse(p.aika), y: p.kc }));
  const seuraava = b.virstanpylvaat.seuraava;
  const ensimmainen = pisteet[0].x;
  const viimeinen = pisteet.at(-1).x;
  const pvm = (ms) => new Date(ms).toLocaleDateString("fi-FI", { day: "numeric", month: "numeric" });

  kaavio = new Chart($canvas[0], {
    type: "line",
    data: {
      datasets: [
        {
          label: "KC",
          data: pisteet,
          borderColor: bossinVari,
          backgroundColor: `${bossinVari}26`, // sama väri läpinäkyvänä (hex + alfa)
          fill: true,
          stepped: true,                       // KC nousee portaittain tapoista
          pointRadius: 0,
          pointHitRadius: 8,
          borderWidth: 2,
        },
        // Katkoviiva seuraavan virstanpylvään kohdalla: näkee, kuinka paljon on matkaa.
        seuraava && {
          label: `Seuraava virstanpylväs ${luku(seuraava)}`,
          data: [{ x: ensimmainen, y: seuraava }, { x: viimeinen, y: seuraava }],
          borderColor: vari("--kulta"),
          borderDash: [6, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
        },
      ].filter(Boolean),
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,              // korkeus tulee CSS:stä (.kayra)
      animation: animoi ? { duration: 700 } : false,
      interaction: { mode: "index", intersect: false },
      scales: {
        x: {
          type: "linear",                      // aika millisekunteina; päivämäärä muotoillaan itse
          min: ensimmainen,
          max: viimeinen,
          ticks: { callback: pvm, maxTicksLimit: 7, color: vari("--hiljainen") },
          grid: { color: vari("--reuna") },
        },
        y: {
          ticks: { precision: 0, color: vari("--hiljainen") },
          grid: { color: vari("--reuna") },
        },
      },
      plugins: {
        legend: { labels: { color: vari("--hiljainen"), boxWidth: 12 } },
        tooltip: {
          callbacks: {
            title: (rivit) => new Date(rivit[0].parsed.x).toLocaleString("fi-FI",
              { day: "numeric", month: "numeric", hour: "2-digit", minute: "2-digit" }),
            label: (rivi) => `${rivi.dataset.label}: ${luku(rivi.parsed.y)}`,
          },
        },
      },
    },
  });
}

// ---------------------------------------------------------------- näkymät (#bossi/<id>)

// Osoitteen #-osa kertoo näkymän: "#bossi/giant_mole" = bossinäkymä, muuten yleisnäkymä.
// Näin selaimen Takaisin-nappi toimii ja bossin näkymään voi linkittää suoraan.
const nykyinenBossi = () => location.hash.match(/^#bossi\/(.+)$/)?.[1] ?? null;
let edellinenBossi = null;

// Näyttää oikean näkymän. animoi = true, kun käyttäjä vaihtoi näkymää (ei 5 min päivityksessä).
function piirraNakyma(animoi) {
  if (!viimeisin) return;
  const id = nykyinenBossi();
  const b = viimeisin.bossit.find((x) => x.id === id);
  if (id && !b) {               // tuntematon bossi osoitteessa → yleisnäkymään
    location.hash = "";
    return;
  }
  if (b) $("#bossinakyma").empty().append(bossiTarkka(b));
  piirraKaavio(b, animoi); // canvas on nyt sivulla (tai poistui, jolloin vanha kaavio tuhotaan)
  const $nayta = b ? $("#bossinakyma") : $("#yleisnakyma");
  const $piilota = b ? $("#yleisnakyma") : $("#bossinakyma");
  if (!animoi) {
    $piilota.hide();
    $nayta.show();
    return;
  }
  // Jos edellinen vaihto on vielä kesken (nopea tuplaklikkaus), keskeytetään se. stop(true)
  // tyhjentää animaatiojonon EIKÄ aja kesken jääneen fadeOutin callbackia, joten vanha vaihto
  // ei enää näytä väärää näkymää.
  $("#yleisnakyma, #bossinakyma").stop(true);
  // fadeOut → (kun valmis) fadeIn.
  $piilota.fadeOut(150, () => {
    $nayta.fadeIn(200);
    // Takaisin yleisnäkymään: vieritä sen bossin kortin kohdalle, josta tultiin.
    const $kortti = !b && edellinenBossi ? $(`#bossi-${edellinenBossi}`) : $();
    window.scrollTo(0, $kortti.length ? $kortti.offset().top - 16 : 0);
    edellinenBossi = id;
  });
}

// hashchange: osoitteen #-osa muuttui (linkki, Takaisin-nappi tai location.hash = ...).
$(window).on("hashchange", () => {
  valittu = null;
  piirraNakyma(true);
});

// ---------------------------------------------------------------- delegoidut kuuntelijat
// Kortit ja ruudut piirretään uudelleen joka päivityksessä, joten kuuntelijat liitetään
// kerran vanhempaan (#bossit, #bossinakyma), joka pysyy. jQuery: .on(tapahtuma, valitsin, käsittelijä).

// Kompaktin kortin klikkaus tai Enter avaa bossinäkymän.
$("#bossit").on("click", ".bossi", function () {
  location.hash = `bossi/${$(this).data("bossi")}`;
});
$("#bossit").on("keydown", ".bossi", function (ev) {
  if (ev.key === "Enter" || ev.key === " ") {
    ev.preventDefault();
    $(this).trigger("click");
  }
});

// Etsii bossin ja uniikin avaimella "bossi|esine".
function etsiUniikki(avain) {
  const [bossi, esine] = avain.split("|");
  const b = viimeisin.bossit.find((x) => x.id === bossi);
  return { b, u: b?.uniikit.find((x) => x.nimi === esine) };
}

// Uniikkiruudun klikkaus avaa tai sulkee sen tiedot.
$("#bossinakyma").on("click", ".ruutu", function () {
  valitse(String($(this).data("avain")));
});

// "Sain" / "+1" avaa kirjausmodaalin.
$("#bossinakyma").on("click", ".kirjaa", function () {
  const { b, u } = etsiUniikki(String($(this).data("avain")));
  if (b && u) avaaKirjaus(b, u);
});

// "×" poistaa dropin kirjauksen.
$("#bossinakyma").on("click", ".poista", async function () {
  const $nappi = $(this).prop("disabled", true);
  try {
    piirra(await kutsu(`/droppi/${$nappi.data("id")}`, { method: "DELETE" }));
    ilmoita("Kirjaus poistettu.");
  } catch (e) {
    $nappi.prop("disabled", false);
    ilmoita(`Poisto epäonnistui: ${e.message}`);
  }
});

// Bootstrapin tapahtuma shown.bs.tab: muistetaan valittu välilehti.
$("#bossinakyma").on("shown.bs.tab", "[data-bs-toggle=tab]", function () {
  valilehti = $(this).data("valilehti");
});

// Viiden osan palkki: jokainen bossi on viidennes, täyttö on sen oma osuus 3000:sta.
function piirraOsat(bossit) {
  $("#osat").empty().append(
    el("div", { class: "osapalkki", role: "img", "aria-label": bossit.map((b) => `${b.lempinimi} ${prosentti(b.osuus)}`).join(", ") },
      bossit.map((b) => el("a", { class: `osa b-${b.id}`, href: `#bossi/${b.id}`, title: `${b.nimi}: ${luku(b.kc)} / ${luku(TAVOITE)}` },
        el("span", { class: "osa-taytto", style: `width:${Math.max(b.osuus > 0 ? 1.5 : 0, b.osuus * 100)}%` })))),
    el("div", { class: "osaselite" },
      bossit.map((b) => el("a", { class: `selite b-${b.id}`, href: `#bossi/${b.id}` },
        el("span", { class: "pallo" }), el("span", {}, b.lempinimi), el("span", { class: "numero hiljainen" }, prosentti(b.osuus))))));
}

// Mistä KC tuli: Dink heti tapon jälkeen, WOM vasta uloskirjautumisen jälkeen.
function kcLahde(b) {
  const l = b.kcLahde;
  if (!l) return null;
  const dink = l.lahde === "events";
  return el("p", { class: "kc-lahde", title: dink ? "Dink lähetti KC:n heti tapon jälkeen" : "Virallisista hiscoreista WOM:n kautta (päivittyy uloskirjautuessa)" },
    el("span", { class: `lahde-merkki ${dink ? "dink" : "wom"}` }, dink ? "Dink" : "WOM"),
    ` KC päivittyi ${sitten(l.aika)}`);
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

function piirraDropit(lista, bossit) {
  const kuvat = new Map(bossit.flatMap((b) => b.uniikit.map((u) => [`${b.id}|${u.nimi}`, u.kuva])));
  // prop("hidden", true/false) piilottaa tai näyttää osion. (toggle() ei toimisi, koska
  // tyyli.css:n [hidden]-sääntö on !important ja voittaa jQueryn asettaman display-tyylin.)
  $("#dropit-osio").prop("hidden", lista.length === 0);
  $("#dropit").empty().append(lista.map((d) => el("li", { class: "kortti" },
    el("span", { class: "droppi-nimi" },
      kuvat.has(`${d.bossi}|${d.esine}`) && el("img", { src: esineKuva(kuvat.get(`${d.bossi}|${d.esine}`)), alt: "" }),
      el("strong", {}, d.esine), ` · ${d.bossiNimi}`),
    el("span", { class: "hiljainen numero" }, `KC ${luku(d.kc)} · ${paiva(d.aika)}`))));
}

function piirraLahteet(w) {
  $("#lahteet").empty().append([
    el("span", {}, `WOM päivitetty ${sitten(w.paivitetty)}`),
    w.virhe && el("span", { class: "virhe" }, `Viimeisin virhe: ${w.virhe}`),
    el("span", {}, "WOM tunnin välein, Dink heti tapon jälkeen. Kuvat: OSRS Wiki."),
  ].filter(Boolean));
}

// ---------------------------------------------------------------- juhlinta (jQuery-efektit)

// Mitä käyttäjä on jo nähnyt: KC, saavutetut virstanpylväät ja saatujen uniikkien määrät.
// Tallennetaan selaimen localStorageen, jotta juhlinta tulee myös silloin, kun Dink kirjasi
// dropin sivun ollessa kiinni. localStorage voi olla estetty (yksityinen ikkuna), joten try/catch.
const NAHTY = "osrs-apuri:nahty";

function tiivista(t) {
  return Object.fromEntries(t.bossit.map((b) => [b.id, {
    kc: b.kc,
    virstat: b.virstanpylvaat.saavutetut,
    uniikit: Object.fromEntries(b.uniikit.map((u) => [u.nimi, u.saadut.length])),
  }]));
}

function lueNahty() {
  try {
    return JSON.parse(localStorage.getItem(NAHTY));
  } catch {
    return null;
  }
}

function tallennaNahty(t) {
  try {
    localStorage.setItem(NAHTY, JSON.stringify(tiivista(t)));
  } catch {
    // ei tallennusta, juhlinta toimii silti saman käynnin aikana
  }
}

// Vertaa vanhaa ja uutta tilannetta: uudet uniikit ja uudet virstanpylväät.
function uudetSaavutukset(vanha, t) {
  if (!vanha) return []; // ensimmäinen käynti: ei juhlita koko historiaa
  const lista = [];
  for (const b of t.bossit) {
    const v = vanha[b.id];
    if (!v) continue;
    for (const u of b.uniikit) {
      if (u.saadut.length > (v.uniikit[u.nimi] ?? 0)) {
        const kc = Math.max(...u.saadut.map((d) => d.kc));
        lista.push({ b, kuva: esineKuva(u.kuva), otsikko: u.pet ? "Uusi pet!" : "Uusi uniikki!", teksti: `${u.nimi} · ${b.lempinimi} KC ${luku(kc)}` });
      }
    }
    for (const m of b.virstanpylvaat.saavutetut) {
      if (!v.virstat.includes(m)) {
        lista.push({ b, kuva: bossiKuva(b.kuva), otsikko: "Virstanpylväs!", teksti: `${b.nimi} ${luku(m)} KC` });
      }
    }
  }
  return lista;
}

// Näyttää saavutukset yksi kerrallaan. jQueryn animaatiojono hoitaa järjestyksen:
// queue() lisää jonoon oman vaiheen (sisällön vaihto), slideDown/delay/slideUp odottavat vuoroaan.
function juhli(saavutukset) {
  const $juhla = $("#juhla");
  for (const s of saavutukset) {
    $juhla
      .queue(function (seuraava) {
        $(this).find(".juhla-kuva").attr("src", s.kuva);
        $(this).find(".juhla-otsikko").text(s.otsikko);
        $(this).find(".juhla-teksti").text(s.teksti);
        hehku($(`.bossi.b-${s.b.id}`));
        seuraava(); // jatka jonon seuraavaan vaiheeseen
      })
      .slideDown(300)
      .delay(3500)
      .slideUp(300);
  }
}

// Kultainen hehku kortin ympärille. jQueryn animate() osaa animoida vain numeroita, joten
// animoidaan lukua 0 → 1 ja step-funktio muuttaa sen joka kuvassa box-shadow-tyyliksi.
function hehku($kortti) {
  if (!$kortti.length) return;
  const kulta = getComputedStyle(document.documentElement).getPropertyValue("--kulta").trim();
  $({ t: 0 }).animate({ t: 1 }, {
    duration: 2000,
    easing: "linear",
    step: (t) => {
      const voima = Math.abs(Math.sin(t * Math.PI * 3)) * (1 - t * 0.6); // kolme sykäystä, hiipuu
      $kortti.css("box-shadow", `0 0 ${Math.round(28 * voima)}px ${Math.round(6 * voima)}px ${kulta}`);
    },
    complete: () => $kortti.css("box-shadow", ""),
  });
}

// KC-luku laskee vanhasta uuteen (esim. 140 → 145) samalla animate()-tekniikalla.
function laskeKc(vanha, t) {
  if (!vanha) return;
  for (const b of t.bossit) {
    const alku = vanha[b.id]?.kc;
    if (alku === undefined || alku >= b.kc) continue;
    const $luvut = $(`.kc-luku[data-bossi="${b.id}"]`);
    $({ n: alku }).animate({ n: b.kc }, {
      duration: 1200,
      step: (n) => $luvut.text(luku(Math.round(n))),
      complete: () => $luvut.text(luku(b.kc)),
    });
  }
}

// ---------------------------------------------------------------- piirto ja lataus

let viimeisin = null;
function piirra(t) {
  // Vanha tilanne vertailuun: tämän käynnin edellinen data tai localStoragen viimeksi nähty.
  const vanha = viimeisin ? tiivista(viimeisin) : lueNahty();
  viimeisin = t;
  piirraLuvut(t.yhteenveto);
  piirraOsat(t.bossit);
  piirraKassa(t.kassa, t.bossit);
  $("#bossit").empty().append(t.bossit.map(bossiKompakti));
  piirraDropit(t.viimeisimmat, t.bossit);
  piirraLahteet(t.wom);
  piirraNakyma(false);
  laskeKc(vanha, t);
  juhli(uudetSaavutukset(vanha, t));
  tallennaNahty(t);
}

async function lataa() {
  try {
    piirra(await kutsu("/tilanne"));
  } catch (e) {
    ilmoita(`Lataus epäonnistui: ${e.message}`);
  }
}

// ---------------------------------------------------------------- tapahtumat

// .on("click", ...) liittää kuuntelijan. Tavallinen function (ei nuolifunktio), jotta
// this on klikattu nappi. $-alkuinen muuttujanimi kertoo, että se on jQuery-olio.
$("#paivita").on("click", async function () {
  const $nappi = $(this);
  $nappi.prop("disabled", true).text("Päivitetään…");
  try {
    const r = await kutsu("/paivita", { method: "POST" });
    piirra(r.tilanne);
    ilmoita(r.kirjattu > 0 ? `${r.kirjattu} mittaria päivittyi.` : "Ei uutta dataa.");
  } catch (e) {
    ilmoita(`Päivitys epäonnistui: ${e.message}`);
  } finally {
    $nappi.prop("disabled", false).text("Päivitä nyt");
  }
});

$("#kirjaudu").on("submit", async function (ev) {
  ev.preventDefault(); // estää selainta lähettämästä lomaketta ja lataamasta sivua uudelleen
  const $nappi = $(this).find("button[type=submit]");
  $nappi.prop("disabled", true);
  $("#kirjautumisvirhe").text("");
  // .val() lukee kentän arvon, .val("") tyhjentää sen.
  const { data, error } = await supabase.auth.signInWithPassword({ email: TUNNUS, password: $("#salasana").val() });
  $nappi.prop("disabled", false);
  if (error) {
    $("#kirjautumisvirhe").text("Väärä salasana.");
    return;
  }
  $("#salasana").val("");
  nayta(data.session);
});

$("#ulos").on("click", async () => {
  await supabase.auth.signOut();
  nayta(null);
});

let ajastin;
function nayta(istunto) {
  // prop("hidden", ...) asettaa HTML:n hidden-ominaisuuden: kirjautuminen tai sovellus näkyviin.
  $("#kirjautuminen").prop("hidden", !!istunto);
  $("#sovellus").prop("hidden", !istunto);
  clearInterval(ajastin);
  if (istunto) {
    lataa();
    // Pidä sivu ajan tasalla pelatessa, mutta älä päivitä, kun kirjausikkuna on auki.
    ajastin = setInterval(() => document.visibilityState === "visible" && !kirjausAuki() && lataa(), 5 * 60_000);
  }
}

$('input[name="username"]').val(TUNNUS);
const { data } = await supabase.auth.getSession();
nayta(data.session);
