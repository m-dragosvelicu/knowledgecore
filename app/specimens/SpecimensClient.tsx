"use client";

// Dev-only gallery of the Slice 1 design-system components. Not wired into any
// real screen — purely a place to see each piece in rest + hover and confirm
// the wobble re-rolls, the skip loop draws without hatch, the solid arrow
// slides, inputs show the teal focus ring, chips read teal-soft/ghost, and the
// score badge is a rough ellipse.

import { useState } from "react";
import Box from "@mui/material/Box";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import Chip from "@mui/material/Chip";
import Container from "@mui/material/Container";
import Stack from "@mui/material/Stack";
import TextField from "@mui/material/TextField";
import Typography from "@mui/material/Typography";

import {
  SolidButton,
  WobbleButton,
  SkipButton,
  FeaturedCard,
  SearchPill,
  PillTextField,
  Eyebrow,
  SectionLabel,
  HeadlineUnderline,
  ScoreBadge,
} from "@/components/ui";

function Section({
  title,
  desc,
  children,
}: {
  title: string;
  desc?: string;
  children: React.ReactNode;
}) {
  return (
    <Card sx={{ borderRadius: "var(--r-lg)" }}>
      <CardContent sx={{ p: "26px 28px" }}>
        <Eyebrow>{title}</Eyebrow>
        {desc && (
          <Typography
            variant="body2"
            color="text.secondary"
            sx={{ mt: 0.5, mb: 2.5, maxWidth: "60ch" }}
          >
            {desc}
          </Typography>
        )}
        {children}
      </CardContent>
    </Card>
  );
}

export default function SpecimensClient() {
  const [search, setSearch] = useState("");

  return (
    <Container maxWidth="md" sx={{ py: 6, position: "relative", zIndex: 2 }}>
      <Stack spacing={1} sx={{ mb: 4 }}>
        <Eyebrow>Design system · Slice 1</Eyebrow>
        <HeadlineUnderline>
          <Typography variant="h3" component="span">
            Component gallery
          </Typography>
        </HeadlineUnderline>
        <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
          Dev-only. Hover the workbench and skip buttons to see the teal hand
          draw itself; it re-rolls a fresh wobble every time.
        </Typography>
      </Stack>

      <Stack spacing={3}>
        {/* ---- Buttons ---- */}
        <Section
          title="Solid · commit"
          desc="Decisive actions that move you forward. Filled pill, white label, a small lift and a sliding arrow on hover. No hand marks."
        >
          <Stack direction="row" spacing={2} flexWrap="wrap" useFlexGap>
            <SolidButton>Begin</SolidButton>
            <SolidButton tone="teal">Resume</SolidButton>
            <SolidButton arrow={false}>Lock it in</SolidButton>
          </Stack>
        </Section>

        <Section
          title="Workbench · explore"
          desc="Quiet at rest. On hover the teal hand draws the pill, then hatches in behind the label. Each hover re-rolls the wobble."
        >
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Stack spacing={0.5}>
              <WobbleButton>See the full path</WobbleButton>
              <SectionLabel>silhouette at rest</SectionLabel>
            </Stack>
            <Stack spacing={0.5}>
              <WobbleButton bare>View all journeys</WobbleButton>
              <SectionLabel>label at rest</SectionLabel>
            </Stack>
          </Stack>
        </Section>

        <Section
          title="Skip · lightest"
          desc="Lowest-stakes. Text only at rest; a loose freehand teal loop draws around it on hover — no hatch fill."
        >
          <Stack direction="row" spacing={3} flexWrap="wrap" useFlexGap>
            <Stack spacing={0.5}>
              <SkipButton>skip for now</SkipButton>
              <SectionLabel>freehand loop · no fill</SectionLabel>
            </Stack>
          </Stack>
        </Section>

        {/* ---- Inputs ---- */}
        <Section
          title="Inputs"
          desc="Pill text field and the hero search pill. Focus adds the teal-soft ring plus a teal border."
        >
          <Stack spacing={2.5}>
            <SearchPill
              value={search}
              onChange={setSearch}
              placeholder="Try: the ideas behind Art Nouveau"
              cta="Begin"
            />
            <PillTextField
              label="Single line"
              placeholder="A pill text field"
              fullWidth
            />
            <PillTextField
              label="Multiline"
              placeholder="Eighteen-pixel radius on multiline"
              multiline
              minRows={2}
              fullWidth
            />
          </Stack>
        </Section>

        {/* ---- Chips ---- */}
        <Section
          title="Chips"
          desc="Only two tones: teal-soft fill and ghost outline. No traffic-light status colors."
        >
          <Stack direction="row" spacing={1.5} flexWrap="wrap" useFlexGap>
            <Chip label="In progress" />
            <Chip label="Added for you" />
            <Chip label="Read" variant="outlined" />
            <Chip label="Build" variant="outlined" />
          </Stack>
        </Section>

        {/* ---- Type ---- */}
        <Section
          title="Type components"
          desc="The eyebrow, the quieter section label, and the self-drawing headline underline wrapper."
        >
          <Stack spacing={2}>
            <Box>
              <Eyebrow>Read · about 4 min</Eyebrow>
              <SectionLabel sx={{ mt: 1 }}>to next checkpoint</SectionLabel>
            </Box>
            <HeadlineUnderline>
              <Typography variant="h3" component="span">
                The ideas behind Art Nouveau
              </Typography>
            </HeadlineUnderline>
          </Stack>
        </Section>

        {/* ---- Score badge ---- */}
        <Section
          title="Score badge"
          desc="A roughened ellipse (not a perfect circle) with a Fraunces figure inside."
        >
          <Stack direction="row" spacing={3} alignItems="center">
            <ScoreBadge big="4" sub="of 5" />
            <ScoreBadge big="92" sub="score" />
          </Stack>
        </Section>

        {/* ---- Standard card vs featured ---- */}
        <Section
          title="Cards"
          desc="Standard card (surface fill, hairline border, soft shadow) and the featured card with the corner squiggle and recessed side panel that collapses at 820px."
        >
          <Stack spacing={3}>
            <Card sx={{ borderRadius: "var(--r-md)" }}>
              <CardContent>
                <Eyebrow>Standard card</Eyebrow>
                <Typography variant="h6" sx={{ mt: 0.5 }}>
                  A small surface
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Surface fill, one hairline line border, a soft directional
                  shadow, radius 18.
                </Typography>
              </CardContent>
            </Card>

            <FeaturedCard
              side={
                <>
                  <SectionLabel>to next checkpoint</SectionLabel>
                  <Typography
                    sx={{
                      fontFamily: "var(--font-display)",
                      fontVariationSettings: "var(--soft-ui)",
                      fontSize: 24,
                    }}
                  >
                    ~14 min
                  </Typography>
                  <Typography variant="body2" color="text.disabled">
                    goalpost 3 of 5
                  </Typography>
                </>
              }
            >
              <Eyebrow>In progress · goalpost 3 of 5</Eyebrow>
              <Box sx={{ my: 1.25 }}>
                <HeadlineUnderline>
                  <Typography variant="h3" component="span">
                    The ideas behind Art Nouveau
                  </Typography>
                </HeadlineUnderline>
              </Box>
              <Typography variant="body2" color="text.secondary">
                You are past the historical roots and into how the style shows
                up in objects.
              </Typography>
              <Box sx={{ mt: 2 }}>
                <SolidButton tone="teal">Resume</SolidButton>
              </Box>
            </FeaturedCard>
          </Stack>
        </Section>
      </Stack>
    </Container>
  );
}
