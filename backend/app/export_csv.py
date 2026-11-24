"""Sérialisation CSV (compatible Excel) d'un dossier de notes de frais.

Format retenu pour Excel en français : séparateur `;`, fins de ligne CRLF,
marque d'ordre des octets UTF-8 (BOM) en tête, en-tête
`Date;Catégorie;Libellé;Montant`, montants en euros à deux décimales avec une
virgule et sans séparateur de milliers ni symbole (ex. `24,50`, `1234,56`).
L'échappement des champs contenant `;`, `"` ou un saut de ligne est celui du
module `csv` standard (champ entouré de guillemets doubles, guillemets internes
doublés) : le fichier reste lisible par Excel et par `csv.reader(delimiter=";")`.
"""

import csv
import io

from app.models import Depense

# Libellés français des catégories, identiques à `web/src/lib/categories.ts`.
CATEGORIE_LIBELLES = {
    "transport": "Transport",
    "repas": "Repas",
    "hebergement": "Hébergement",
    "carburant": "Carburant",
    "peage_parking": "Péage/Parking",
    "fournitures": "Fournitures",
    "autre": "Autre",
}

ENTETE_CSV = ["Date", "Catégorie", "Libellé", "Montant"]

_BOM = "\ufeff"


def libelle_categorie(categorie: str) -> str:
    """Libellé français d'une catégorie (repli sur la valeur brute si inconnue)."""
    return CATEGORIE_LIBELLES.get(categorie, categorie)


def _format_montant(montant_centimes: int) -> str:
    """Montant en euros : deux décimales, virgule, sans séparateur de milliers."""
    signe = "-" if montant_centimes < 0 else ""
    valeur = abs(montant_centimes)
    return f"{signe}{valeur // 100},{valeur % 100:02d}"


def depenses_to_csv(depenses: list[Depense]) -> str:
    """Sérialise les dépenses (déjà triées date puis id) en CSV avec BOM UTF-8.

    Le résultat commence par le BOM, puis une ligne d'en-tête, puis une ligne
    par dépense — rien d'autre (ni total, ni ligne vide finale).
    """
    tampon = io.StringIO(newline="")
    tampon.write(_BOM)
    writer = csv.writer(tampon, delimiter=";", lineterminator="\r\n")
    writer.writerow(ENTETE_CSV)
    for depense in depenses:
        writer.writerow(
            [
                depense.date_depense.isoformat(),
                libelle_categorie(depense.categorie),
                depense.libelle,
                _format_montant(depense.montant_centimes),
            ]
        )
    return tampon.getvalue()
