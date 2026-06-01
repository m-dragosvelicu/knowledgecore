"use client";

// KnowledgeCore — account menu (the profile-icon dropdown).
//
// Replaces the inline "Account" (wobble) + "Sign out" (skip) actions that used
// to sit in the nav bar. The avatar is now the only affordance up top: clicking
// it opens a calm dropdown CARD anchored to the avatar with exactly two items —
// "Profile" (-> /account) and "Sign out" (the existing Better Auth sign-out
// server action, threaded in from the server AppHeader as a hidden <form>).
//
// Styled to the design system: --surface paper card, 1px --line hairline border,
// the soft warm directional shadow (var(--shadow)), --r-md rounding, calm ink
// type in Hanken. The avatar keeps its concrete-plumbing look: ink circle, 2px
// teal ring + quiet lift on hover, plus an active/open ring so the trigger reads
// as pressed while the menu is open. Keyboard-accessible and dismisses on
// outside-click / escape (MUI Menu handles both).

import { useId, useRef, useState } from "react";
import Box from "@mui/material/Box";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import Link from "next/link";

export default function AccountMenu({
  initial,
  signOut,
}: {
  /** First-letter avatar glyph derived server-side from the name/email. */
  initial: string;
  /** The sign-out server action, bound on the server (AppHeader). */
  signOut: () => Promise<void>;
}) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const menuId = useId();
  const buttonId = useId();
  const signOutFormRef = useRef<HTMLFormElement>(null);

  const itemSx = {
    fontFamily: "var(--font-body)",
    fontSize: 14.5,
    fontWeight: 500,
    color: "var(--ink)",
    px: "16px",
    py: "10px",
    borderRadius: "10px",
    mx: "6px",
    minHeight: "auto",
    transition: "background-color .15s, color .15s",
    "&:hover": { backgroundColor: "var(--surface-2)", color: "var(--teal-deep)" },
    "&.Mui-focusVisible": { backgroundColor: "var(--surface-2)" },
  } as const;

  return (
    <>
      {/* Avatar — the only top-right affordance now; opens the dropdown. */}
      <Box
        component="button"
        type="button"
        id={buttonId}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-controls={open ? menuId : undefined}
        aria-expanded={open}
        onClick={(e: React.MouseEvent<HTMLButtonElement>) =>
          setAnchorEl(e.currentTarget)
        }
        sx={{
          width: 46,
          height: 46,
          ml: "10px",
          p: 0,
          borderRadius: "50%",
          bgcolor: "var(--ink)",
          color: "var(--surface)",
          display: "grid",
          placeContent: "center",
          fontFamily: "var(--font-body)",
          fontWeight: 600,
          fontSize: 15,
          cursor: "pointer",
          flex: "none",
          border: "2px solid transparent",
          transition: ".25s",
          "&:hover": {
            borderColor: "var(--teal)",
            transform: "translateY(-1px)",
          },
          // Keep the ring while the menu is open so the trigger reads as pressed.
          ...(open ? { borderColor: "var(--teal)" } : {}),
        }}
      >
        {initial}
      </Box>

      {/* Sign-out lives in a hidden form so the server action runs on submit;
          the menu item just submits it. */}
      <Box component="form" ref={signOutFormRef} action={signOut} sx={{ display: "none" }} />

      <Menu
        id={menuId}
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        MenuListProps={{ "aria-labelledby": buttonId, sx: { py: "8px" } }}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
        slotProps={{
          paper: {
            elevation: 0,
            sx: {
              mt: "10px",
              minWidth: 188,
              bgcolor: "var(--surface)",
              border: "1px solid var(--line)",
              borderRadius: "var(--r-md)",
              boxShadow: "var(--shadow)",
              backgroundImage: "none",
              overflow: "visible",
            },
          },
        }}
      >
        <MenuItem
          component={Link}
          href="/account"
          onClick={() => setAnchorEl(null)}
          sx={itemSx}
        >
          Profile
        </MenuItem>
        <MenuItem
          onClick={() => {
            setAnchorEl(null);
            signOutFormRef.current?.requestSubmit();
          }}
          sx={itemSx}
        >
          Sign out
        </MenuItem>
      </Menu>
    </>
  );
}
