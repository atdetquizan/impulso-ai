export const AUTH_SESSION_HINT_KEY = "impulso.auth.sessionActive";
let inMemorySessionHint = false;

export function hasAuthSessionHint() {
  try {
    return inMemorySessionHint || localStorage.getItem(AUTH_SESSION_HINT_KEY) === "1";
  } catch {
    return inMemorySessionHint;
  }
}

export function saveAuthSessionHint() {
  inMemorySessionHint = true;
  try {
    localStorage.setItem(AUTH_SESSION_HINT_KEY, "1");
  } catch {
    // La cookie HttpOnly sigue siendo la única credencial válida.
  }
}

export function clearAuthSessionHint() {
  inMemorySessionHint = false;
  try {
    localStorage.removeItem(AUTH_SESSION_HINT_KEY);
  } catch {
    // No hay datos sensibles que limpiar fuera de la cookie HttpOnly.
  }
}
