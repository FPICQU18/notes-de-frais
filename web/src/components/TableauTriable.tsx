import { useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

/**
 * Tableau triable du mode bureau (≥ 1024 px, US-044) : carte blanche avec
 * en-têtes de colonnes triables (`aria-sort`, indicateur flèche announced),
 * et lignes entières cliquables (lien « stretched » sur toute la ligne).
 *
 * Le tri se fait côté client sur les données déjà chargées, sans appel API ;
 * par défaut (`tri === null`) l'ordre du serveur est conservé. `Array.sort`
 * étant stable, les valeurs égales gardent leur ordre relatif (tri stable).
 */

/** Colonne triable : en-tête cliquable, alternance ascendant/descendant. */
export type ColonneTriable<T> = {
  cle: string;
  libelle: string;
  triable: true;
  /** Valeur de tri de la ligne (nombre, ou chaîne ISO pour les dates). */
  valeurTri: (ligne: T) => number | string;
  /** Classe de largeur appliquée à l'en-tête (ex. `w-[170px]`). */
  classe?: string;
  cellule: (ligne: T) => ReactNode;
};

/** Colonne fixe (non triable). */
export type ColonneFixe<T> = {
  cle: string;
  libelle: string;
  triable?: false;
  classe?: string;
  cellule: (ligne: T) => ReactNode;
};

export type ColonneTableau<T> = ColonneTriable<T> | ColonneFixe<T>;

type Props<T> = {
  /** Titre de la carte (ex. « Tous les dossiers »), aussi libellé du tableau. */
  titre: string;
  colonnes: ColonneTableau<T>[];
  lignes: T[];
  /** Clé React stable d'une ligne. */
  cleLigne: (ligne: T) => string | number;
  /** Chemin de détail d'une ligne : la ligne entière devient ce lien. */
  vers: (ligne: T) => string;
  /** Libellé accessible du lien de la ligne (ex. « Ouvrir le dossier X »). */
  etiquetteLigne: (ligne: T) => string;
};

function estTriable<T>(colonne: ColonneTableau<T>): colonne is ColonneTriable<T> {
  return colonne.triable === true;
}

export function TableauTriable<T,>({
  titre,
  colonnes,
  lignes,
  cleLigne,
  vers,
  etiquetteLigne,
}: Props<T>) {
  const idTitre = useId();
  // `null` = aucun tri actif : ordre du serveur (date décroissante) conservé.
  const [cleTri, setCleTri] = useState<string | null>(null);
  const [sensTri, setSensTri] = useState<"asc" | "desc">("asc");

  const lignesTriees = useMemo(() => {
    if (cleTri === null) return lignes;
    const colonne = colonnes.find((c) => c.cle === cleTri);
    if (!colonne || !estTriable(colonne)) return lignes;
    const facteur = sensTri === "asc" ? 1 : -1;
    return [...lignes].sort((a, b) => {
      const va = colonne.valeurTri(a);
      const vb = colonne.valeurTri(b);
      const comparaison =
        typeof va === "number" && typeof vb === "number"
          ? va - vb
          : String(va).localeCompare(String(vb), "fr");
      return comparaison * facteur;
    });
  }, [lignes, colonnes, cleTri, sensTri]);

  function auClicEntete(colonne: ColonneTableau<T>) {
    if (!estTriable(colonne)) return;
    if (cleTri !== colonne.cle) {
      // Nouvelle colonne : premier clic = ascendant.
      setCleTri(colonne.cle);
      setSensTri("asc");
    } else {
      // Colonne déjà active : on inverse le sens.
      setSensTri((sens) => (sens === "asc" ? "desc" : "asc"));
    }
  }

  return (
    <div className="overflow-hidden rounded-[24px] bg-[var(--card)] shadow-[var(--ombre-carte)]">
      <div className="flex items-center gap-5 border-b border-black/5 px-6 py-5">
        <h2 id={idTitre} className="m-0 flex-1 text-[20px] font-extrabold">
          {titre}
        </h2>
        <span role="status" className="text-[13px] text-[var(--muted-foreground)]">
          {lignes.length} résultat{lignes.length > 1 ? "s" : ""}
        </span>
      </div>
      <table aria-labelledby={idTitre} className="w-full border-collapse">
        <thead>
          <tr className="border-b border-black/5">
            {colonnes.map((colonne) => {
              const actif = cleTri === colonne.cle;
              return (
                <th
                  key={colonne.cle}
                  scope="col"
                  aria-sort={
                    actif ? (sensTri === "asc" ? "ascending" : "descending") : undefined
                  }
                  className={`px-6 py-3 text-left text-[13px] font-bold uppercase tracking-wide text-[var(--muted-foreground)] ${colonne.classe ?? ""}`}
                >
                  {estTriable(colonne) ? (
                    <button
                      type="button"
                      onClick={() => auClicEntete(colonne)}
                      className="-mx-2 flex min-h-[44px] items-center gap-1 rounded-[8px] px-2 text-[13px] font-bold uppercase tracking-wide text-[var(--muted-foreground)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    >
                      <span>{colonne.libelle}</span>
                      {actif ? (
                        sensTri === "asc" ? (
                          <ArrowUp aria-hidden strokeWidth={2} className="h-4 w-4" />
                        ) : (
                          <ArrowDown aria-hidden strokeWidth={2} className="h-4 w-4" />
                        )
                      ) : (
                        <ChevronsUpDown
                          aria-hidden
                          strokeWidth={2}
                          className="h-4 w-4 opacity-50"
                        />
                      )}
                      <span className="sr-only">
                        {actif
                          ? sensTri === "asc"
                            ? ", tri croissant"
                            : ", tri décroissant"
                          : ", non trié"}
                      </span>
                    </button>
                  ) : (
                    <span className="flex min-h-[44px] items-center">{colonne.libelle}</span>
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {lignesTriees.map((ligne) => (
            <tr
              key={cleLigne(ligne)}
              className="relative border-b border-black/5 last:border-b-0 hover:bg-[rgba(91,61,245,0.04)] focus-within:bg-[rgba(91,61,245,0.04)]"
            >
              {colonnes.map((colonne, index) => (
                <td key={colonne.cle} className={`px-6 py-[18px] ${colonne.classe ?? ""}`}>
                  {index === 0 ? (
                    // Lien « stretched » : le pseudo `after:inset-0` ancré sur la
                    // ligne (relative) rend toute la ligne cliquable.
                    <Link
                      to={vers(ligne)}
                      aria-label={etiquetteLigne(ligne)}
                      className="after:absolute after:inset-0 rounded-[8px] text-inherit no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--primary)]"
                    >
                      {colonne.cellule(ligne)}
                    </Link>
                  ) : (
                    colonne.cellule(ligne)
                  )}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
