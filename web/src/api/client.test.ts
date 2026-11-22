import { afterEach, expect, test, vi } from "vitest";

import {
  MESSAGE_GENERIQUE,
  MESSAGE_RESEAU,
  apiGet,
  apiPost,
} from "./client";

afterEach(() => {
  vi.restoreAllMocks();
});

test("apiGet extrait le message d'un détail chaîne (401)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ detail: "E-mail ou mot de passe incorrect." }), {
      status: 401,
    }),
  );

  await expect(apiGet("/v1/auth/me")).rejects.toMatchObject({
    status: 401,
    message: "E-mail ou mot de passe incorrect.",
  });
});

test("apiPost extrait le premier msg d'un détail tableau (422)", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(
      JSON.stringify({
        detail: [{ msg: "Le mot de passe est requis." }, { msg: "Autre" }],
      }),
      { status: 422 },
    ),
  );

  await expect(apiPost("/v1/auth/login", {})).rejects.toMatchObject({
    status: 422,
    message: "Le mot de passe est requis.",
  });
});

test("erreur réseau : message dédié", async () => {
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("réseau"));

  await expect(apiGet("/v1/auth/me")).rejects.toMatchObject({
    status: 0,
    message: MESSAGE_RESEAU,
  });
});

test("corps d'erreur non JSON : message générique", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response("<html>Erreur serveur</html>", { status: 500 }),
  );

  await expect(apiGet("/v1/auth/me")).rejects.toMatchObject({
    status: 500,
    message: MESSAGE_GENERIQUE,
  });
});

test("apiPost 204 (logout) ne tente pas de lire le corps", async () => {
  vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 204 }));

  await expect(apiPost("/v1/auth/logout")).resolves.toBeUndefined();
});

test("apiPost envoie du JSON avec Content-Type et credentials same-origin", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: 1 }), { status: 200 }),
  );

  await apiPost("/v1/auth/login", { email: "a@b.c", password: "x" });

  const [url, init] = fetchMock.mock.calls[0];
  expect(String(url)).toBe("/api/v1/auth/login");
  expect(init?.method).toBe("POST");
  expect(init?.credentials).toBe("same-origin");
  expect(init?.headers).toMatchObject({
    Accept: "application/json",
    "Content-Type": "application/json",
  });
  expect(JSON.parse(String(init?.body))).toEqual({ email: "a@b.c", password: "x" });
});

test("apiGet envoie credentials same-origin", async () => {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: 1 }), { status: 200 }),
  );

  await apiGet("/v1/auth/me");

  const [, init] = fetchMock.mock.calls[0];
  expect(init?.credentials).toBe("same-origin");
});
