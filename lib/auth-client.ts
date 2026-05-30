import { createAuthClient } from "better-auth/react";

// Same-origin client; baseURL is inferred from the current origin.
export const authClient = createAuthClient();

export const { signIn, signUp, signOut, useSession } = authClient;
