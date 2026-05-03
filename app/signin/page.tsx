import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Stack from "@mui/material/Stack";
import Typography from "@mui/material/Typography";
import { signIn } from "@/auth";

export default function SignInPage() {
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
      <Stack spacing={3} sx={{ width: "100%", maxWidth: 360, textAlign: "center" }}>
        <Typography variant="h5" component="h1">
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
      </Stack>
    </Box>
  );
}
