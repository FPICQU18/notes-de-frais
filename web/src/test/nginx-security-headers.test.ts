import { describe, expect, test } from "vitest";

import nginxConf from "../../nginx.conf?raw";

// Test de garde — US-038 : les 6 en-têtes de sécurité doivent être servis sur
// toutes les réponses de toutes les locations nginx, avec le paramètre « always »
// (pour couvrir aussi les 404 et erreurs 4xx/5xx). Règle nginx : les add_header
// du niveau server ne sont hérités que par les locations qui n'en définissent
// aucun, donc chaque location qui a déjà un add_header (Cache-Control, ou /api/)
// doit répéter les 6 en-têtes. On lit nginx.conf tel qu'écrit (import ?raw),
// comme pwa-config.test.ts le fait pour vite.config.ts.

interface Bloc {
  nom: string; // ex. "server", "location = /sw.js"
  addHeaders: string[]; // lignes add_header normalisées (espaces simples) du bloc
}

// Découpe la configuration en blocs (server, map, location …) en suivant la
// profondeur des accolades ; les commentaires sont ignorés.
const analyser = (conf: string): Bloc[] => {
  const blocs: Bloc[] = [];
  const pile: Bloc[] = [];
  for (const ligneBrute of conf.split("\n")) {
    const ligne = ligneBrute.replace(/#.*$/, "").trim();
    if (!ligne) continue;
    const ouverture = ligne.match(/^(location|server|map)\s*(.*?)\s*\{$/);
    if (ouverture) {
      const bloc: Bloc = {
        nom: ouverture[2] ? `${ouverture[1]} ${ouverture[2]}` : ouverture[1],
        addHeaders: [],
      };
      blocs.push(bloc);
      pile.push(bloc);
      continue;
    }
    if (ligne === "}") {
      pile.pop();
      continue;
    }
    const courant = pile[pile.length - 1];
    if (courant && ligne.startsWith("add_header ")) {
      courant.addHeaders.push(ligne.replace(/\s+/g, " "));
    }
  }
  return blocs;
};

const ENTETES_SECURITE: Record<string, string> = {
  "Strict-Transport-Security": "max-age=31536000",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), geolocation=(), microphone=()",
  "Content-Security-Policy":
    "default-src 'self'; img-src 'self' blob: data:; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
};

const LOCATIONS_ATTENDUES = [
  "location = /sw.js",
  "location = /manifest.webmanifest",
  "location /assets/",
  "location /api/",
  "location /",
];

// Cache-Control préexistants à conserver tels quels dans leur location.
const CACHE_CONTROL_ATTENDUS: Record<string, string> = {
  "location = /sw.js": "no-cache",
  "location = /manifest.webmanifest": "no-cache",
  "location /assets/": "public, max-age=31536000, immutable",
  "location /": "no-cache",
};

interface EnteteTrouve {
  valeur: string;
  toujours: boolean;
}

const enTetesDe = (bloc: Bloc): Map<string, EnteteTrouve> => {
  const trouves = new Map<string, EnteteTrouve>();
  for (const ligne of bloc.addHeaders) {
    const m = ligne.match(/^add_header\s+(\S+)\s+"([^"]*)"\s*(always)?\s*;$/);
    if (m) trouves.set(m[1], { valeur: m[2], toujours: m[3] === "always" });
  }
  return trouves;
};

// Liste des problèmes d'un bloc : en-tête absent, valeur incorrecte ou sans
// « always ». Une liste vide = bloc conforme.
const problemesSecurite = (bloc: Bloc): string[] => {
  const trouves = enTetesDe(bloc);
  const problemes: string[] = [];
  for (const [nom, valeur] of Object.entries(ENTETES_SECURITE)) {
    const t = trouves.get(nom);
    if (!t) problemes.push(`${nom} absent de « ${bloc.nom} »`);
    else if (t.valeur !== valeur)
      problemes.push(`${nom} a la valeur "${t.valeur}" au lieu de "${valeur}" dans « ${bloc.nom} »`);
    else if (!t.toujours) problemes.push(`${nom} sans « always » dans « ${bloc.nom} »`);
  }
  return problemes;
};

const blocDe = (blocs: Bloc[], nom: string): Bloc => {
  const bloc = blocs.find((b) => b.nom === nom);
  expect(bloc, `bloc « ${nom} » introuvable dans nginx.conf`).toBeDefined();
  return bloc!;
};

const blocs = analyser(nginxConf);

describe("nginx.conf : en-têtes de sécurité sur toutes les réponses (US-038)", () => {
  test("les 5 locations attendues sont présentes", () => {
    const noms = blocs.filter((b) => b.nom.startsWith("location ")).map((b) => b.nom);
    expect([...noms].sort()).toEqual([...LOCATIONS_ATTENDUES].sort());
  });

  test("le niveau server déclare les 6 en-têtes avec « always » et les bonnes valeurs", () => {
    expect(problemesSecurite(blocDe(blocs, "server"))).toEqual([]);
  });

  test.each(LOCATIONS_ATTENDUES)(
    "la location « %s » répète les 6 en-têtes avec « always » et les bonnes valeurs",
    (nom) => {
      expect(problemesSecurite(blocDe(blocs, nom))).toEqual([]);
    },
  );

  test.each(Object.entries(CACHE_CONTROL_ATTENDUS))(
    "la location « %s » conserve son Cache-Control « %s »",
    (nom, valeur) => {
      const trouves = enTetesDe(blocDe(blocs, nom));
      expect(trouves.get("Cache-Control")?.valeur).toBe(valeur);
    },
  );

  // Cas refusés : le guard doit continuer d'échouer si quelqu'un retire un
  // en-tête ou le « always » plus tard. On mute la configuration en mémoire,
  // en ciblant l'occurrence située DANS la location visée (pas celle du bloc
  // server, qui reste en place).
  const retirerDansLocation = (conf: string, nomLocation: string, ligne: string): string => {
    const debut = conf.indexOf(nomLocation);
    expect(debut).toBeGreaterThanOrEqual(0);
    const debutBloc = conf.indexOf("{", debut);
    const finBloc = conf.indexOf("\n    }", debutBloc);
    const zone = conf.slice(debutBloc, finBloc);
    const dansZone = zone.indexOf(ligne);
    expect(dansZone).toBeGreaterThanOrEqual(0);
    const abs = debutBloc + dansZone;
    const finLigne = conf.indexOf("\n", abs);
    return conf.slice(0, abs) + conf.slice(finLigne + 1);
  };

  test.each(Object.keys(ENTETES_SECURITE))(
    "échec si « %s » est retiré de la location = /sw.js",
    (nom) => {
      const mute = retirerDansLocation(nginxConf, "location = /sw.js {", `add_header ${nom} `);
      const bloc = blocDe(analyser(mute), "location = /sw.js");
      expect(problemesSecurite(bloc).some((p) => p.startsWith(`${nom} absent`))).toBe(true);
    },
  );

  test("échec si un en-tête perd son « always » dans une location", () => {
    const ligneAvec = 'add_header X-Content-Type-Options "nosniff" always;';
    const ligneSans = 'add_header X-Content-Type-Options "nosniff";';
    const debut = nginxConf.indexOf("location = /sw.js {");
    const debutBloc = nginxConf.indexOf("{", debut);
    const finBloc = nginxConf.indexOf("\n    }", debutBloc);
    const zone = nginxConf.slice(debutBloc, finBloc);
    const dansZone = zone.indexOf(ligneAvec);
    expect(dansZone).toBeGreaterThanOrEqual(0);
    const mute =
      nginxConf.slice(0, debutBloc + dansZone) +
      ligneSans +
      nginxConf.slice(debutBloc + dansZone + ligneAvec.length);
    const bloc = blocDe(analyser(mute), "location = /sw.js");
    expect(problemesSecurite(bloc).some((p) => p.includes("sans « always »"))).toBe(true);
  });

  test("échec si la location = /sw.js perd son Cache-Control", () => {
    const mute = retirerDansLocation(
      nginxConf,
      "location = /sw.js {",
      'add_header Cache-Control "no-cache";',
    );
    const bloc = blocDe(analyser(mute), "location = /sw.js");
    expect(enTetesDe(bloc).get("Cache-Control")).toBeUndefined();
  });
});
