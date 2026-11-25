"""Sérialisation CSV (compatible Excel) d'un dossier de notes de frais.

Format retenu pour Excel en français : séparateur `;`, fins de ligne CRLF,
marque d'ordre des octets UTF-8 (BOM) en tête, en-tête
`Date;Catégorie;Libellé;Montant`, montants en euros à deux décimales avec une
virgule et sans séparateur de milliers ni symbole (ex. `24,50`, `1234,56`).
L'échappement des champs contenant `;`, `"`, une tabulation ou un saut de ligne
est celui du module `csv` standard en `QUOTE_MINIMAL` (champ entouré de guillemets
doubles, guillemets internes doublés), étendu à la tabulation : le fichier reste
lisible par Excel et par `csv.reader(delimiter=";")`.

Neutralisation des formules (injection CSV/Excel) : tout champ texte (libellé,
catégorie) qui commence par `=`, `+`, `-`, `@`, une tabulation ou un retour
chariot est préfixé d'une apostrophe `'` (voir `neutraliser_formule`).
"""

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

# Préfixes qui déclenchent une interprétation comme formule par Excel/LibreOffice.
_CARACTERES_FORMULE = ("=", "+", "-", "@", "\t", "\r", "\n")

# Caractères qui imposent de citer le champ (guillemets doubles autour).
_CARACTERES_A_CITER = (";", '"', "\t", "\r", "\n")


def neutraliser_formule(texte: str) -> str:
    """Préfixe d'une apostrophe `'` tout texte commençant par un caractère de formule.

    Excel et LibreOffice interprètent une cellule commençant par `=`, `+`, `-`,
    `@`, une tabulation ou un retour chariot comme une formule : un libellé saisi
    par un utilisateur pourrait ainsi exécuter un calcul malveillant à l'ouverture
    du fichier. L'apostrophe en tête force le traitement en texte.
    """
    if texte.startswith(_CARACTERES_FORMULE):
        return "'" + texte
    return texte


def _echapper_champ(texte: str) -> str:
    """Échappement `QUOTE_MINIMAL` du module csv, étendu à la tabulation.

    `csv.writer` cite un champ contenant le séparateur, un guillemet ou un saut
    de ligne, mais pas une simple tabulation : on cite aussi celle-ci pour que
    le champ soit bien délimité (guillemets internes doublés, tabulation et
    saut de ligne conservés tels quels à l'intérieur des guillemets).
    """
    if any(caractere in texte for caractere in _CARACTERES_A_CITER):
        return '"' + texte.replace('"', '""') + '"'
    return texte


def _champ_csv(texte: str) -> str:
    """Champ texte neutralisé contre les formules, puis échappé pour le CSV."""
    return _echapper_champ(neutraliser_formule(texte))


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
    tampon.write(";".join(ENTETE_CSV) + "\r\n")
    for depense in depenses:
        champs = [
            depense.date_depense.isoformat(),
            _champ_csv(libelle_categorie(depense.categorie)),
            _champ_csv(depense.libelle),
            _format_montant(depense.montant_centimes),
        ]
        tampon.write(";".join(champs) + "\r\n")
    return tampon.getvalue()
