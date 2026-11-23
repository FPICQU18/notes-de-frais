import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Camera, ChevronRight, LogOut } from "lucide-react";

import { apiPost, type Depense, type Note, type UserRead } from "../api/client";
import { CarteDepense } from "../components/accueil/CarteDepense";
import {
  dateDuJour,
  formatMontant,
  initiales,
  moisCourant,
  nomMois,
  totalDepensesMois,
} from "../lib/format";
import { useApiGet } from "../lib/useApiGet";

interface HomePageProps {
  utilisateur: UserRead;
  onDeconnecte: () => void;
  onSessionExpiree: () => void;
  focusTitre: boolean;
  /** Sert de source de temps (mois courant, date du jour) ; par défaut `new Date()`. */
  maintenant?: Date;
}

export function HomePage({
  utilisateur,
  onDeconnecte,
  onSessionExpiree,
  focusTitre,
  maintenant,
}: HomePageProps) {
  const [deconnexionEnCours, setDeconnexionEnCours] = useState(false);
  const refTitre = useRef<HTMLHeadingElement>(null);

  const depenses = useApiGet<Depense[]>("/v1/depenses", onSessionExpiree);
  const aClasser = useApiGet<Depense[]>("/v1/depenses?a_classer=true", onSessionExpiree);
  const notes = useApiGet<Note[]>("/v1/notes", onSessionExpiree);

  useEffect(() => {
    if (focusTitre) {
      refTitre.current?.focus();
    }
  }, [focusTitre]);

  async function deconnecter() {
    if (deconnexionEnCours) return;
    setDeconnexionEnCours(true);
    try {
      await apiPost<void>("/v1/auth/logout");
    } catch {
      // L'échec de la déconnexion ne bloque pas le retour à l'écran de connexion.
    } finally {
      onDeconnecte();
    }
  }

  const aujourdhui = maintenant ?? new Date();
  const totalMois = totalDepensesMois(depenses.donnees ?? [], aujourdhui);
  const nbDossiersBrouillon = (notes.donnees ?? []).filter(
    (note) => note.statut === "brouillon",
  ).length;
  const nombreAClasser = aClasser.donnees?.length ?? 0;
  const recentes = (depenses.donnees ?? []).slice(0, 3);
  const chargementGeneral =
    depenses.chargement || aClasser.chargement || notes.chargement;

  return (
    <main className="ecran ecran--accueil" aria-busy={chargementGeneral || undefined}>
      <header className="accueil-entete">
        <span className="accueil-avatar" aria-hidden="true">
          {initiales(utilisateur.display_name)}
        </span>
        <div className="accueil-entete__identite">
          <p className="accueil-entete__date">{dateDuJour(aujourdhui)}</p>
          <h1 className="accueil-entete__titre" tabIndex={-1} ref={refTitre}>
            Bonjour {utilisateur.display_name}
          </h1>
        </div>
        <button
          type="button"
          className="accueil-deconnexion"
          onClick={deconnecter}
          disabled={deconnexionEnCours}
          aria-busy={deconnexionEnCours}
          aria-label="Se déconnecter"
        >
          <LogOut aria-hidden="true" strokeWidth={2} />
        </button>
      </header>

      <section className="accueil-bandeau" aria-label="Dépenses du mois">
        <p className="accueil-bandeau__libelle">
          Dépenses de {nomMois(moisCourant(aujourdhui).mois)}
        </p>
        <p className="accueil-bandeau__montant">{formatMontant(totalMois)}</p>
        <div className="accueil-pastilles">
          <Link className="accueil-pastille" to="/depenses">
            {nombreAClasser} à classer
          </Link>
          <Link className="accueil-pastille" to="/dossiers">
            {nbDossiersBrouillon}{" "}
            {nbDossiersBrouillon > 1
              ? "dossiers en brouillon"
              : "dossier en brouillon"}
          </Link>
        </div>
        <Link className="accueil-scanner" to="/depenses/nouvelle">
          <Camera aria-hidden="true" strokeWidth={2} />
          Scanner un ticket
        </Link>
      </section>

      <section className="accueil-recentes" aria-labelledby="titre-recentes">
        <div className="accueil-recentes__entete">
          <h2 id="titre-recentes" className="accueil-recentes__titre">
            Récentes
          </h2>
          <Link className="accueil-recentes__tout-voir" to="/depenses">
            Tout voir
            <ChevronRight aria-hidden="true" strokeWidth={2} />
          </Link>
        </div>

        {chargementGeneral && <p className="chargement">Chargement…</p>}

        {!chargementGeneral && depenses.erreur !== null && (
          <div className="accueil-erreur">
            <p className="alerte" role="alert">
              {depenses.erreur}
            </p>
            <button
              type="button"
              className="bouton bouton--primaire"
              onClick={depenses.reessayer}
            >
              Réessayer
            </button>
          </div>
        )}

        {!chargementGeneral && depenses.erreur === null && recentes.length === 0 && (
          <p className="accueil-vide">Aucune dépense ce mois-ci.</p>
        )}

        {!chargementGeneral && depenses.erreur === null && recentes.length > 0 && (
          <ul className="accueil-liste">
            {recentes.map((depense) => (
              <CarteDepense key={depense.id} depense={depense} />
            ))}
          </ul>
        )}
      </section>

      {aClasser.erreur !== null && (
        <section className="accueil-erreur-compacte" aria-label="À classer">
          <p className="accueil-erreur-compacte__texte" role="alert">
            À classer : {aClasser.erreur}
          </p>
          <button
            type="button"
            className="accueil-retenter"
            onClick={aClasser.reessayer}
          >
            Réessayer
          </button>
        </section>
      )}

      {notes.erreur !== null && (
        <section className="accueil-erreur-compacte" aria-label="Dossiers">
          <p className="accueil-erreur-compacte__texte" role="alert">
            Dossiers : {notes.erreur}
          </p>
          <button type="button" className="accueil-retenter" onClick={notes.reessayer}>
            Réessayer
          </button>
        </section>
      )}
    </main>
  );
}
