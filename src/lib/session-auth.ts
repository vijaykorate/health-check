// Reads the current authenticated user from the httpOnly cookie.
// (Next.js 16: cookies() is async.)
import { cookies } from "next/headers";
import { AUTH_COOKIE, getAuthSession, type Role, type User } from "./accounts";

export interface CurrentUser {
  user: User;
  role: Role;
  token: string;
  /** Pockit backend token for this technician, if signed in via real Pockit auth. */
  pockitToken?: string;
}

/** Resolve the signed-in user, or null. */
export async function currentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  const session = getAuthSession(token);
  if (!session) return null;
  // Build the user from the signed session — identity is the real Pockit
  // technician (id + name carried in the token).
  const user: User = {
    id: session.userId,
    name: session.name ?? "Technician",
    mobile: "",
    role: session.role,
    territories: [],
  };
  return { user, role: session.role, token: session.token, pockitToken: session.pk };
}

/** Read the raw token from the request cookie (for route handlers). */
export async function currentToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(AUTH_COOKIE)?.value;
}
