import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";
import { signIn } from "@/auth";

export default function SignInPage() {
  const showDevCredentials = process.env.NODE_ENV !== "production";

  return (
    <Box
      sx={{
        minHeight: "100vh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        p: 3,
      }}
    >
      <Stack spacing={3} sx={{ width: "100%", maxWidth: 400 }}>
        <Typography variant="h5" component="h1" textAlign="center">
          Sign in to KnowledgeCore
        </Typography>

        <form
          action={async () => {
            "use server";
            await signIn("google", { redirectTo: "/" });
          }}
        >
          <Button type="submit" variant="contained" fullWidth size="large">
            Continue with Google
          </Button>
        </form>

        {showDevCredentials && (
          <>
            <Divider>or</Divider>
            <Card variant="outlined">
              <CardContent>
                <Stack spacing={2}>
                  <Stack direction="row" alignItems="center" justifyContent="space-between">
                    <Typography variant="subtitle1">
                      Dev sign-in (no OAuth required)
                    </Typography>
                    <Chip label="DEV ONLY" color="warning" size="small" />
                  </Stack>
                  <form
                    action={async (formData: FormData) => {
                      "use server";
                      const email = formData.get("email");
                      if (typeof email !== "string" || email.length === 0) return;
                      await signIn("credentials", { email, redirectTo: "/" });
                    }}
                  >
                    <Stack spacing={2}>
                      <TextField
                        name="email"
                        type="email"
                        label="Email"
                        placeholder="dev@example.com"
                        required
                        fullWidth
                        size="small"
                      />
                      <Button type="submit" variant="outlined" fullWidth>
                        Sign in
                      </Button>
                    </Stack>
                  </form>
                </Stack>
              </CardContent>
            </Card>
          </>
        )}
      </Stack>
    </Box>
  );
}
