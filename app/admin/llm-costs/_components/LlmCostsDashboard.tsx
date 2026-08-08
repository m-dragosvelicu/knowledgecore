"use client";

import { useEffect, useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Stack from "@mui/material/Stack";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import CircularProgress from "@mui/material/CircularProgress";
import type { LlmCostsResponse } from "@/app/api/admin/llm-costs/route";

// Plain internal-ops styling only: no design-system hand marks/animation, just
// the color tokens so it doesn't look foreign inside the app shell.
const CARD_SX = {
  border: "1px solid var(--line)",
  borderRadius: "10px",
  p: "18px 20px",
  bgcolor: "rgba(255,255,255,.5)",
};

const LABEL_SX = { fontSize: 12, color: "var(--ink-3)", textTransform: "uppercase" as const, letterSpacing: ".04em" };
const VALUE_SX = { fontSize: 26, color: "var(--ink)", fontWeight: 600, mt: "4px" };

// The journey/user breakdown tables only render this many rows (independent
// of BREAKDOWN_LIMIT, the server's 200-row fetch cap) — the truncation
// notices below must state THIS number, not the length of the fetched array.
const TABLE_ROW_LIMIT = 30;

function formatUsd(microUsd: number): string {
  const usd = microUsd / 1_000_000;
  if (usd === 0) return "$0.00";
  if (usd < 0.01) return `$${usd.toFixed(5)}`;
  if (usd < 1) return `$${usd.toFixed(4)}`;
  return `$${usd.toFixed(2)}`;
}

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}k`;
  return String(n);
}

function isoDateInput(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function StatCard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <Box sx={CARD_SX}>
      <Box sx={LABEL_SX}>{label}</Box>
      <Box sx={VALUE_SX}>{value}</Box>
      {sub && <Box sx={{ fontSize: 13, color: "var(--ink-2)", mt: "2px" }}>{sub}</Box>}
    </Box>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Box
      component="h2"
      sx={{
        m: 0,
        mb: "10px",
        fontFamily: "var(--font-display)",
        fontWeight: 500,
        fontSize: 18,
        color: "var(--ink)",
      }}
    >
      {children}
    </Box>
  );
}

/** Simple horizontal bar as a proportional-width Box; no charting dependency. */
function BarCell({ value, max }: { value: number; max: number }) {
  const pct = max > 0 ? Math.max(2, Math.round((value / max) * 100)) : 0;
  return (
    <Box sx={{ display: "flex", alignItems: "center", gap: "8px", minWidth: 160 }}>
      <Box sx={{ flex: 1, height: 8, bgcolor: "var(--line)", borderRadius: "4px", overflow: "hidden" }}>
        <Box sx={{ width: `${pct}%`, height: "100%", bgcolor: "var(--teal)" }} />
      </Box>
    </Box>
  );
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) {
    return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  }
  return sorted[base];
}

export default function LlmCostsDashboard() {
  const [from, setFrom] = useState(() => isoDateInput(new Date(Date.now() - 30 * 86_400_000)));
  const [to, setTo] = useState(() => isoDateInput(new Date()));
  const [data, setData] = useState<LlmCostsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const params = new URLSearchParams({ from, to });
    fetch(`/api/admin/llm-costs?${params.toString()}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(
            typeof body?.error === "string" ? body.error : `request failed (${res.status})`,
          );
        }
        return res.json() as Promise<LlmCostsResponse>;
      })
      .then((body) => {
        if (!cancelled) setData(body);
      })
      .catch((err) => {
        if (!cancelled) setError((err as Error).message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [from, to]);

  const journeyStats = useMemo(() => {
    if (!data || data.byJourney.length === 0) return null;
    const costs = data.byJourney.map((j) => j.costMicroUsd).sort((a, b) => a - b);
    const total = costs.reduce((a, b) => a + b, 0);
    return {
      count: costs.length,
      avg: total / costs.length,
      median: quantile(costs, 0.5),
      p90: quantile(costs, 0.9),
      max: costs[costs.length - 1],
      min: costs[0],
    };
  }, [data]);

  const maxDayCost = useMemo(
    () => (data ? Math.max(1, ...data.byDay.map((d) => d.costMicroUsd)) : 1),
    [data],
  );
  const maxPurposeCost = useMemo(
    () => (data ? Math.max(1, ...data.byPurpose.map((p) => p.costMicroUsd)) : 1),
    [data],
  );

  return (
    <Box>
      <Stack direction={{ xs: "column", sm: "row" }} spacing="12px" sx={{ mb: "24px" }} alignItems={{ sm: "flex-end" }}>
        <Box>
          <Box sx={LABEL_SX}>From</Box>
          <input
            type="date"
            value={from}
            max={to}
            onChange={(e) => setFrom(e.target.value)}
            style={{ font: "inherit", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6 }}
          />
        </Box>
        <Box>
          <Box sx={LABEL_SX}>To</Box>
          <input
            type="date"
            value={to}
            min={from}
            onChange={(e) => setTo(e.target.value)}
            style={{ font: "inherit", padding: "6px 8px", border: "1px solid var(--line)", borderRadius: 6 }}
          />
        </Box>
        {loading && <CircularProgress size={18} sx={{ color: "var(--teal)" }} />}
      </Stack>

      {error && (
        <Box sx={{ color: "#B3261E", mb: "20px", fontSize: 14 }}>
          Failed to load: {error}
        </Box>
      )}

      {data && (
        <Stack spacing="32px">
          <Box>
            <SectionTitle>Totals</SectionTitle>
            <Stack direction="row" spacing="14px" flexWrap="wrap" useFlexGap>
              <StatCard label="Total cost" value={formatUsd(data.totals.costMicroUsd)} />
              <StatCard label="Total tokens" value={formatTokens(data.totals.totalTokens)}
                sub={`${formatTokens(data.totals.inputTokens)} in / ${formatTokens(data.totals.outputTokens)} out`} />
              <StatCard label="Calls" value={String(data.totals.callCount)}
                sub={`${data.totals.successCount} ok / ${data.totals.failureCount} failed`} />
              {journeyStats && (
                <StatCard label="Avg cost / journey" value={formatUsd(journeyStats.avg)}
                  sub={`${journeyStats.count} journeys with attributed calls`} />
              )}
            </Stack>
          </Box>

          <Box>
            <SectionTitle>Cost by purpose</SectionTitle>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Purpose</TableCell>
                  <TableCell></TableCell>
                  <TableCell align="right">Cost</TableCell>
                  <TableCell align="right">Tokens</TableCell>
                  <TableCell align="right">Calls</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.byPurpose.map((p) => (
                  <TableRow key={p.purpose}>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{p.purpose}</TableCell>
                    <TableCell><BarCell value={p.costMicroUsd} max={maxPurposeCost} /></TableCell>
                    <TableCell align="right">{formatUsd(p.costMicroUsd)}</TableCell>
                    <TableCell align="right">{formatTokens(p.inputTokens + p.outputTokens)}</TableCell>
                    <TableCell align="right">{p.callCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Box>
            <SectionTitle>Cost by model</SectionTitle>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Model</TableCell>
                  <TableCell align="right">Cost</TableCell>
                  <TableCell align="right">Tokens</TableCell>
                  <TableCell align="right">Calls</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {data.byModel.map((m) => (
                  <TableRow key={m.model}>
                    <TableCell sx={{ fontFamily: "monospace", fontSize: 13 }}>{m.model}</TableCell>
                    <TableCell align="right">{formatUsd(m.costMicroUsd)}</TableCell>
                    <TableCell align="right">{formatTokens(m.inputTokens + m.outputTokens)}</TableCell>
                    <TableCell align="right">{m.callCount}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Box>

          <Box>
            <SectionTitle>Daily trend</SectionTitle>
            {data.byDay.length === 0 ? (
              <Box sx={{ fontSize: 14, color: "var(--ink-3)" }}>No calls in this range.</Box>
            ) : (
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>Day</TableCell>
                    <TableCell></TableCell>
                    <TableCell align="right">Cost</TableCell>
                    <TableCell align="right">Calls</TableCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {data.byDay.map((d) => (
                    <TableRow key={d.day}>
                      <TableCell sx={{ fontSize: 13 }}>{d.day}</TableCell>
                      <TableCell><BarCell value={d.costMicroUsd} max={maxDayCost} /></TableCell>
                      <TableCell align="right">{formatUsd(d.costMicroUsd)}</TableCell>
                      <TableCell align="right">{d.callCount}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </Box>

          <Box>
            <SectionTitle>Cost per journey</SectionTitle>
            {journeyStats && (
              <Stack direction="row" spacing="14px" flexWrap="wrap" useFlexGap sx={{ mb: "14px" }}>
                <StatCard label="Median" value={formatUsd(journeyStats.median)} />
                <StatCard label="P90" value={formatUsd(journeyStats.p90)} />
                <StatCard label="Max" value={formatUsd(journeyStats.max)} />
                <StatCard label="Min" value={formatUsd(journeyStats.min)} />
              </Stack>
            )}
            {data.byJourney.length === 0 ? (
              <Box sx={{ fontSize: 14, color: "var(--ink-3)" }}>No attributed journey calls in this range.</Box>
            ) : (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>Journey</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell align="right">Tokens</TableCell>
                      <TableCell align="right">Calls</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byJourney.slice(0, TABLE_ROW_LIMIT).map((j) => (
                      <TableRow key={j.intentId}>
                        <TableCell sx={{ fontSize: 13 }}>
                          {j.subject ?? j.intentId}
                          <Box component="span" sx={{ color: "var(--ink-3)", ml: "6px", fontSize: 11 }}>
                            {j.intentId}
                          </Box>
                        </TableCell>
                        <TableCell align="right">{formatUsd(j.costMicroUsd)}</TableCell>
                        <TableCell align="right">{formatTokens(j.inputTokens + j.outputTokens)}</TableCell>
                        <TableCell align="right">{j.callCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(data.byJourney.length > TABLE_ROW_LIMIT || data.journeyBreakdownTruncated) && (
                  <Box sx={{ fontSize: 12, color: "var(--ink-3)", mt: "6px" }}>
                    Showing the top {Math.min(TABLE_ROW_LIMIT, data.byJourney.length)} of{" "}
                    {data.byJourney.length}
                    {data.journeyBreakdownTruncated ? "+" : ""} journeys by cost
                    {data.journeyBreakdownTruncated
                      ? " (server-capped fetch; more exist in this range)."
                      : "."}
                  </Box>
                )}
              </>
            )}
          </Box>

          <Box>
            <SectionTitle>Cost by user</SectionTitle>
            {data.byUser.length === 0 ? (
              <Box sx={{ fontSize: 14, color: "var(--ink-3)" }}>No attributed user calls in this range.</Box>
            ) : (
              <>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell>User</TableCell>
                      <TableCell align="right">Cost</TableCell>
                      <TableCell align="right">Tokens</TableCell>
                      <TableCell align="right">Calls</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {data.byUser.slice(0, TABLE_ROW_LIMIT).map((u) => (
                      <TableRow key={u.userId}>
                        <TableCell sx={{ fontSize: 13 }}>
                          {u.email ?? u.userId}
                        </TableCell>
                        <TableCell align="right">{formatUsd(u.costMicroUsd)}</TableCell>
                        <TableCell align="right">{formatTokens(u.inputTokens + u.outputTokens)}</TableCell>
                        <TableCell align="right">{u.callCount}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                {(data.byUser.length > TABLE_ROW_LIMIT || data.userBreakdownTruncated) && (
                  <Box sx={{ fontSize: 12, color: "var(--ink-3)", mt: "6px" }}>
                    Showing the top {Math.min(TABLE_ROW_LIMIT, data.byUser.length)} of{" "}
                    {data.byUser.length}
                    {data.userBreakdownTruncated ? "+" : ""} users by cost
                    {data.userBreakdownTruncated
                      ? " (server-capped fetch; more exist in this range)."
                      : "."}
                  </Box>
                )}
              </>
            )}
          </Box>
        </Stack>
      )}
    </Box>
  );
}
