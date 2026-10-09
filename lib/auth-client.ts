import { createAuthClient } from "better-auth/react";

export const authClient = createAuthClient(); // talks to /api/auth on whatever address the page was opened at
