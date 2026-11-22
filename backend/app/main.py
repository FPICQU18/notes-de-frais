from fastapi import FastAPI, Request, status
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse

from app.api import auth, depenses, health, notes, users

app = FastAPI(
    title="Notes de frais",
    docs_url="/api/docs",
    openapi_url="/api/openapi.json",
    redoc_url=None,
)

app.include_router(health.router, prefix="/api")
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(depenses.router)
app.include_router(notes.router)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    """Renvoie 422 sans jamais recopier la valeur soumise (mot de passe compris).

    Le handler par défaut de FastAPI recopie `input` (la valeur reçue) et `ctx`
    dans le corps d'erreur, ce qui ferait fuiter un mot de passe ou tout autre
    secret. On les retire systématiquement, et on retire le préfixe anglais
    « Value error, » des messages pour qu'ils restent en français.
    """
    detail = []
    for error in exc.errors():
        error = {key: value for key, value in error.items() if key not in {"input", "ctx"}}
        message = error.get("msg")
        if isinstance(message, str):
            error["msg"] = message.removeprefix("Value error, ")
        detail.append(error)

    return JSONResponse(
        status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
        content={"detail": detail},
    )
