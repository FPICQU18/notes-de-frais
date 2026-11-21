"""Tests du modèle UserSession : nommage, export et index sur user_id."""

import sqlalchemy as sa

import app.models as models
from app.models import UserSession


def test_export_user_session_sans_session():
    assert models.UserSession is UserSession
    assert "UserSession" in models.__all__
    assert "Session" not in models.__all__
    assert not hasattr(models, "Session")


def test_user_session_vit_dans_user_session_py():
    import app.models.user_session as module

    assert module.UserSession is UserSession


def test_user_session_nom_de_table_sessions():
    assert UserSession.__tablename__ == "sessions"


def test_user_session_user_id_indexe():
    assert UserSession.__table__.c.user_id.index is True
    index_names = {ix.name for ix in UserSession.__table__.indexes}
    assert "ix_sessions_user_id" in index_names


def test_index_user_id_existe_en_base(db_session):
    """Après création du schéma, l'index ix_sessions_user_id existe sur user_id."""
    row = db_session.execute(
        sa.text(
            "SELECT indexname FROM pg_indexes "
            "WHERE tablename = 'sessions' AND indexname = 'ix_sessions_user_id'"
        )
    ).scalar_one_or_none()
    assert row == "ix_sessions_user_id"
