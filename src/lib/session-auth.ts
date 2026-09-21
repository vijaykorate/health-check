// Reads the current authenticated user from the httpOnly cookie.
// (Next.js 16: cookies() is async.)
import { cookies } from "next/headers";
import {
  AUTH_COOKIE,
  getAuthSession,
  getUser,
  type Role,
  type User,
} from "./accounts";

export interface CurrentUser {
  user: User;
  role: Role;
  token: string;
}

/** Resolve the signed-in user, or null. */
export async function currentUser(): Promise<CurrentUser | null> {
  const store = await cookies();
  const token = store.get(AUTH_COOKIE)?.value;
  const session = getAuthSession(token);
  if (!session) return null;
  const user = getUser(session.userId);
  if (!user) return null;
  return { user, role: session.role, token: session.token };
}

/** Read the raw token from the request cookie (for route handlers). */
export async function currentToken(): Promise<string | undefined> {
  const store = await cookies();
  return store.get(AUTH_COOKIE)?.value;
}
