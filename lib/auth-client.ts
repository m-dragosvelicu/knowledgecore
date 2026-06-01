import { createAuthClient } from "better-auth/react";
import { anonymousClient } from "better-auth/client/plugins";

// Same-origin client; baseURL is inferred from the current origin. The anonymous
// client exposes authClient.signIn.anonymous() for the first-visit guest
// bootstrap (landing-flow plan, section 2a).
export const authClient = createAuthClient({
  plugins: [anonymousClient()],
});

export const { signIn, signUp, signOut, useSession } = authClient;
