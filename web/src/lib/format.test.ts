import { describe, expect, test } from "vitest";

import {
  dateDuJour,
  dateIsoParis,
  formatDateAnnee,
  formatDateCourte,
  formatDateCourteHorodatage,
  formatDateHeure,
  formatMontant,
  initiales,
  moisCourant,
  nomMois,
  numeroSemaineIso,
  totalDepensesMois,
} from "./format";

describe("formatMontant", () => {
  test("formate les centimes en euros fr-FR (espaces insécables)", () => {
    expect(formatMontant(15845)).toBe("158,45\u00A0€");
    expect(formatMontant(0)).toBe("0,00\u00A0€");
    expect(formatMontant(1234567)).toBe("12\u202F345,67\u00A0€");
  });
});

describe("formatDateCourte", () => {
  test("renvoie « 18 nov. »", () => {
    expect(formatDateCourte("2026-11-18")).toBe("18 nov.");
  });

  test("ne conserve pas de zéro initial sur le jour", () => {
    expect(formatDateCourte("2026-11-05")).toBe("5 nov.");
  });
});

describe("formatDateAnnee", () => {
  test("renvoie « 18 nov. 2026 » avec l'année", () => {
    expect(formatDateAnnee("2026-11-18")).toBe("18 nov. 2026");
  });

  test("ne conserve pas de zéro initial sur le jour", () => {
    expect(formatDateAnnee("2026-11-05")).toBe("5 nov. 2026");
  });
});

describe("formatDateCourteHorodatage", () => {
  test("renvoie la date courte au fuseau Europe/Paris", () => {
    expect(formatDateCourteHorodatage("2026-11-21T09:30:00Z")).toBe("21 nov.");
  });

  test("bascule au lendemain quand Paris dépasse minuit (UTC+1)", () => {
    // 2026-11-21T23:30:00Z = 2026-11-22 00:30 à Paris.
    expect(formatDateCourteHorodatage("2026-11-21T23:30:00Z")).toBe("22 nov.");
  });
});

describe("formatDateHeure", () => {
  test("date et heure fr-FR converties au fuseau Europe/Paris", () => {
    expect(formatDateHeure("2026-11-18T14:30:00Z")).toBe("18 nov. 2026 à 15:30");
  });
});

describe("numeroSemaineIso", () => {
  test("2026-11-17 est en semaine 47", () => {
    expect(numeroSemaineIso("2026-11-17")).toBe(47);
  });

  test("2026-11-11 est en semaine 46", () => {
    expect(numeroSemaineIso("2026-11-11")).toBe(46);
  });

  test("2026-01-01 est en semaine 1", () => {
    expect(numeroSemaineIso("2026-01-01")).toBe(1);
  });

  test("2026-12-31 est en semaine 53 (année à 53 semaines)", () => {
    expect(numeroSemaineIso("2026-12-31")).toBe(53);
  });
});

describe("moisCourant / nomMois", () => {
  test("novembre 2026 depuis le fuseau Europe/Paris", () => {
    expect(moisCourant(new Date("2026-11-15T12:00:00Z"))).toEqual({
      annee: 2026,
      mois: 11,
    });
    expect(nomMois(11)).toBe("novembre");
  });
});

describe("dateDuJour", () => {
  test("« Dimanche 15 novembre » avec initiale majuscule", () => {
    expect(dateDuJour(new Date("2026-11-15T12:00:00Z"))).toBe(
      "Dimanche 15 novembre",
    );
  });
});

describe("totalDepensesMois", () => {
  const maintenant = new Date("2026-11-15T12:00:00Z");

  test("somme uniquement les dépenses du mois courant", () => {
    expect(
      totalDepensesMois(
        [
          { date_depense: "2026-11-05", montant_centimes: 1000 },
          { date_depense: "2026-11-10", montant_centimes: 2500 },
          { date_depense: "2026-11-20", montant_centimes: 12345 },
          { date_depense: "2026-10-28", montant_centimes: 9999 },
        ],
        maintenant,
      ),
    ).toBe(15845);
  });

  test("bornes incluses : le 1er et le dernier jour du mois comptent", () => {
    expect(
      totalDepensesMois(
        [
          { date_depense: "2026-11-01", montant_centimes: 100 },
          { date_depense: "2026-11-30", montant_centimes: 200 },
          { date_depense: "2026-12-01", montant_centimes: 400 },
          { date_depense: "2026-10-31", montant_centimes: 800 },
        ],
        maintenant,
      ),
    ).toBe(300);
  });

  test("aucune dépense dans le mois → 0 (jamais vide ni NaN)", () => {
    expect(
      totalDepensesMois(
        [{ date_depense: "2026-10-28", montant_centimes: 5000 }],
        maintenant,
      ),
    ).toBe(0);
    expect(totalDepensesMois([], maintenant)).toBe(0);
  });
});

describe("dateIsoParis", () => {
  test("à 00 h 30 heure de Paris, renvoie la date du jour (pas la veille)", () => {
    // 2026-11-23T23:30:00Z = 2026-11-24 00:30 en heure de Paris (UTC+1)
    expect(dateIsoParis(new Date("2026-11-23T23:30:00Z"))).toBe("2026-11-24");
  });

  test("en pleine journée UTC, renvoie la date de Paris", () => {
    expect(dateIsoParis(new Date("2026-11-23T10:00:00Z"))).toBe("2026-11-23");
  });

  test("en été (UTC+2), 22 h 30 UTC est le lendemain à Paris", () => {
    // 2026-07-15T22:30:00Z = 2026-07-16 00:30 en heure de Paris (UTC+2)
    expect(dateIsoParis(new Date("2026-07-15T22:30:00Z"))).toBe("2026-07-16");
  });
});

describe("initiales", () => {
  test("deux mots → deux initiales", () => {
    expect(initiales("Camille Martin")).toBe("CM");
  });

  test("un seul mot → une initiale", () => {
    expect(initiales("Camille")).toBe("C");
  });

  test("espaces superflus ignorés ; nom vide → « ? »", () => {
    expect(initiales("  Camille   Martin  ")).toBe("CM");
    expect(initiales("")).toBe("?");
  });
});
