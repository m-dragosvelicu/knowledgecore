import { redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import AppBar from "@mui/material/AppBar";
import Toolbar from "@mui/material/Toolbar";
import Typography from "@mui/material/Typography";
import Stack from "@mui/material/Stack";
import Button from "@mui/material/Button";
import { auth, getCurrentSession } from "@/lib/auth";

// Shared top bar used by the dashboard, account, and the journey wizard. Server
// component: it reads the session itself and owns the sign-out server action so
// callers do not have to thread email/handlers through.
export default async function AppHeader() {
  const session = await getCurrentSession();
  const email = session?.user?.email ?? "";

  return (
    <AppBar position="static" color="default" elevation={1}>
      <Toolbar>
        <Typography
          variant="h6"
          component={Link}
          href="/"
          sx={{ flexGrow: 1, textDecoration: "none", color: "inherit" }}
        >
          KnowledgeCore
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          {email && (
            <Typography variant="body2" color="text.secondary">
              {email}
            </Typography>
          )}
          <Button component={Link} href="/account" size="small" variant="text">
            Account
          </Button>
          <form
            action={async () => {
              "use server";
              await auth.api.signOut({ headers: await headers() });
              redirect("/signin");
            }}
          >
            <Button type="submit" size="small" variant="outlined">
              Sign out
            </Button>
          </form>
        </Stack>
      </Toolbar>
    </AppBar>
  );
}
