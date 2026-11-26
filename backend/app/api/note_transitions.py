"""Routes du circuit de validation des notes de frais (transitions de statut).

Chaque transition (`soumettre`, `valider`, `refuser`, `rouvrir`, `rembourser`)
respecte les règles d'AGENTS.md : les statuts évoluent dans un ordre fixe, le
propriétaire ne valide jamais son propre dossier, et chaque passage est
historisé dans `note_transitions` (qui, quand, ancien/nouveau statut, motif).

Ordre des contrôles, testé pour chaque route : 401 (session) → 403 (rôle) →
404 (dossier inexistant ou invisible) → 403 (acteur non autorisé) → 409
(transition ou contenu invalide). La ligne du dossier est chargée avec
`SELECT … FOR UPDATE` avant d'évaluer le statut, dans la même transaction que
l'écriture, pour empêcher la double validation ou la double soumission.
"""

from datetime import UTC, datetime
from typing import Annotated

import sqlalchemy as sa
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session as OrmSession

from app.auth.dependencies import get_current_user, require_role
from app.db import get_db
from app.models import Depense, Note, NoteTransition, User
from app.schemas.note import NoteRead, NoteRefus, TransitionActeur, TransitionRead

router = APIRouter(prefix="/api/v1/notes", tags=["notes"])

DbSession = Annotated[OrmSession, Depends(get_db)]
CurrentUser = Annotated[User, Depends(get_current_user)]
Valideur = Annotated[User, Depends(require_role("valideur"))]
Admin = Annotated[User, Depends(require_role("admin"))]

_NOTE_INTROUVABLE = "Note introuvable."
_TRANSITION_INVALIDE = "Transition non autorisée depuis le statut actuel."
_SOUMISSION_SANS_DEPENSE = "Le dossier doit contenir au moins une dépense pour être soumis."
_RESERVE_PROPRIETAIRE = "Accès refusé : réservé au propriétaire du dossier."
_AUTO_VALIDATION_INTERDITE = (
    "Accès refusé : le propriétaire ne peut pas valider son propre dossier."
)
_AUTO_REFUS_INTERDIT = "Accès refusé : le propriétaire ne peut pas refuser son propre dossier."

_ROLES_VALIDEUR = ("valideur", "admin")


def _stmt_note_for_update(note_id: int):
    """Instruction de verrouillage du dossier : `SELECT … FOR UPDATE`."""
    return select(Note).where(Note.id == note_id).with_for_update()


def _charger_note(db: OrmSession, note_id: int, *, for_update: bool) -> Note | None:
    """Charge un dossier, sous verrou `FOR UPDATE` si demandé, sinon lecture simple."""
    stmt = _stmt_note_for_update(note_id) if for_update else select(Note).where(Note.id == note_id)
    return db.execute(stmt).scalar_one_or_none()


def _note_visible(note: Note | None, current_user: User) -> Note:
    """Lève 404 si le dossier est inexistant ou invisible pour l'appelant.

    Un utilisateur ne voit que ses dossiers ; un valideur et un admin voient en
    plus les dossiers non `brouillon` des autres comptes. Un `brouillon`
    d'autrui renvoie 404, jamais 403 (aucune fuite d'existence).
    """
    if note is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOTE_INTROUVABLE)
    if note.user_id == current_user.id:
        return note
    if note.statut == "brouillon" or current_user.role not in _ROLES_VALIDEUR:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=_NOTE_INTROUVABLE)
    return note


def _exiger_proprietaire(note: Note, current_user: User) -> None:
    """Lève 403 si l'appelant n'est pas le propriétaire du dossier."""
    if note.user_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=_RESERVE_PROPRIETAIRE)


def _interdire_proprietaire(note: Note, current_user: User, detail: str) -> None:
    """Lève 403 si l'appelant est le propriétaire (auto-validation / auto-refus)."""
    if note.user_id == current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=detail)


def _exiger_statut(note: Note, attendu: str) -> None:
    """Lève 409 si le dossier n'est pas au statut attendu par la transition."""
    if note.statut != attendu:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_TRANSITION_INVALIDE)


def _compter_depenses(db: OrmSession, note_id: int) -> int:
    return db.execute(
        select(sa.func.count(Depense.id)).where(Depense.note_id == note_id)
    ).scalar_one()


def _note_read(db: OrmSession, note: Note) -> NoteRead:
    """Construit un `NoteRead` à partir du dossier et de ses totaux calculés."""
    total_centimes, nb_depenses, derniere_depense_le = db.execute(
        select(
            sa.func.coalesce(sa.func.sum(Depense.montant_centimes), 0),
            sa.func.count(Depense.id),
            sa.func.max(Depense.date_depense),
        ).where(Depense.note_id == note.id)
    ).one()
    return NoteRead(
        id=note.id,
        libelle=note.libelle,
        statut=note.statut,
        total_centimes=total_centimes,
        nb_depenses=nb_depenses,
        derniere_depense_le=derniere_depense_le,
        created_at=note.created_at,
        updated_at=note.updated_at,
    )


def _transiter(
    db: OrmSession,
    note: Note,
    *,
    nouveau_statut: str,
    acteur: User,
    motif: str | None = None,
) -> None:
    """Historise la transition puis change le statut, dans la transaction courante."""
    db.add(
        NoteTransition(
            note_id=note.id,
            acteur_id=acteur.id,
            ancien_statut=note.statut,
            nouveau_statut=nouveau_statut,
            motif=motif,
        )
    )
    note.statut = nouveau_statut
    if nouveau_statut == "soumise":
        note.soumise_at = datetime.now(UTC)
    db.commit()
    db.refresh(note)


@router.post("/{note_id}/soumettre", response_model=NoteRead)
def soumettre_note(note_id: int, db: DbSession, current_user: CurrentUser) -> NoteRead:
    """Soumet un dossier `brouillon` (propriétaire, au moins une dépense)."""
    note = _note_visible(_charger_note(db, note_id, for_update=True), current_user)
    _exiger_proprietaire(note, current_user)
    _exiger_statut(note, "brouillon")
    if _compter_depenses(db, note.id) == 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=_SOUMISSION_SANS_DEPENSE)
    _transiter(db, note, nouveau_statut="soumise", acteur=current_user)
    return _note_read(db, note)


@router.post("/{note_id}/valider", response_model=NoteRead)
def valider_note(note_id: int, db: DbSession, current_user: Valideur) -> NoteRead:
    """Valide un dossier `soumise` (valideur/admin autre que le propriétaire)."""
    note = _note_visible(_charger_note(db, note_id, for_update=True), current_user)
    _interdire_proprietaire(note, current_user, _AUTO_VALIDATION_INTERDITE)
    _exiger_statut(note, "soumise")
    _transiter(db, note, nouveau_statut="validee", acteur=current_user)
    return _note_read(db, note)


@router.post("/{note_id}/refuser", response_model=NoteRead)
def refuser_note(
    note_id: int, payload: NoteRefus, db: DbSession, current_user: Valideur
) -> NoteRead:
    """Refuse un dossier `soumise` (valideur/admin autre que le propriétaire, motif)."""
    note = _note_visible(_charger_note(db, note_id, for_update=True), current_user)
    _interdire_proprietaire(note, current_user, _AUTO_REFUS_INTERDIT)
    _exiger_statut(note, "soumise")
    _transiter(db, note, nouveau_statut="refusee", acteur=current_user, motif=payload.motif)
    return _note_read(db, note)


@router.post("/{note_id}/rouvrir", response_model=NoteRead)
def rouvrir_note(note_id: int, db: DbSession, current_user: CurrentUser) -> NoteRead:
    """Rouvre un dossier `refusee` en `brouillon` (propriétaire, pour corriger)."""
    note = _note_visible(_charger_note(db, note_id, for_update=True), current_user)
    _exiger_proprietaire(note, current_user)
    _exiger_statut(note, "refusee")
    _transiter(db, note, nouveau_statut="brouillon", acteur=current_user)
    return _note_read(db, note)


@router.post("/{note_id}/rembourser", response_model=NoteRead)
def rembourser_note(note_id: int, db: DbSession, current_user: Admin) -> NoteRead:
    """Rembourse un dossier `validee` (admin)."""
    note = _note_visible(_charger_note(db, note_id, for_update=True), current_user)
    _exiger_statut(note, "validee")
    _transiter(db, note, nouveau_statut="remboursee", acteur=current_user)
    return _note_read(db, note)


@router.get("/{note_id}/historique", response_model=list[TransitionRead])
def historique_note(note_id: int, db: DbSession, current_user: CurrentUser) -> list[TransitionRead]:
    """Renvoie l'historique des transitions d'un dossier visible, ordre chronologique."""
    note = _note_visible(_charger_note(db, note_id, for_update=False), current_user)
    rows = db.execute(
        select(NoteTransition, User)
        .join(User, User.id == NoteTransition.acteur_id)
        .where(NoteTransition.note_id == note.id)
        .order_by(NoteTransition.created_at.asc(), NoteTransition.id.asc())
    ).all()
    return [
        TransitionRead(
            id=transition.id,
            acteur=TransitionActeur(id=acteur.id, display_name=acteur.display_name),
            ancien_statut=transition.ancien_statut,
            nouveau_statut=transition.nouveau_statut,
            motif=transition.motif,
            created_at=transition.created_at,
        )
        for transition, acteur in rows
    ]
