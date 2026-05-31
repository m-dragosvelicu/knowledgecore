import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import rehypeKatex from "rehype-katex";
import rehypeHighlight from "rehype-highlight";
import Box from "@mui/material/Box";
import type { SxProps, Theme } from "@mui/material/styles";

// KaTeX CSS (rehype-katex does NOT inject it). highlight.js theme for code blocks.
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

/**
 * Sanitization schema.
 *
 * The content rendered here is LLM-generated and therefore UNTRUSTED. The
 * canonical "do not trust the content, but do trust the plugins" pattern is:
 *
 *   remark-math (parse $...$)  ->  rehype-sanitize  ->  rehype-katex / rehype-highlight
 *
 * rehype-sanitize runs FIRST so any HTML smuggled into the markdown is removed
 * while the math is still inert text. rehype-katex and rehype-highlight then run
 * on the already-sanitized tree and emit their own trusted markup (spans with
 * KaTeX / hljs class names, inline styles), which sanitize never sees and so
 * cannot strip. We only widen the schema enough to let the math/code WRAPPER
 * nodes that remark-math/rehype produce survive sanitization.
 */
const schema = {
  ...defaultSchema,
  attributes: {
    ...defaultSchema.attributes,
    // remark-math (v6) emits math as <code class="language-math math-inline">
    // for inline ($..$) and <pre><code class="language-math math-display"> for
    // block ($$ on their own lines). We must preserve those classes through
    // sanitize so rehype-katex can find and expand them afterwards. We also
    // allow the language-* classes rehype-highlight keys off, plus hljs.
    code: [
      ...(defaultSchema.attributes?.code ?? []),
      ["className", /^language-./, "math", "math-inline", "math-display", "hljs"],
    ],
  },
};

const sx: SxProps<Theme> = {
  // typographic rhythm that sits inside MUI without overriding global resets
  color: "text.primary",
  fontSize: "1rem",
  lineHeight: 1.7,
  "& > :first-of-type": { mt: 0 },
  "& > :last-child": { mb: 0 },
  "& h1, & h2, & h3, & h4, & h5, & h6": {
    fontWeight: 600,
    lineHeight: 1.3,
    mt: 3,
    mb: 1.5,
  },
  "& h1": { fontSize: "1.75rem" },
  "& h2": { fontSize: "1.5rem" },
  "& h3": { fontSize: "1.25rem" },
  "& h4": { fontSize: "1.1rem" },
  "& p": { my: 1.5 },
  "& ul, & ol": { my: 1.5, pl: 3 },
  "& li": { my: 0.5 },
  "& li > p": { my: 0 },
  "& a": { color: "primary.main", textDecorationColor: "inherit" },
  "& blockquote": {
    borderLeft: "4px solid",
    borderColor: "divider",
    color: "text.secondary",
    pl: 2,
    ml: 0,
    my: 2,
  },
  "& hr": { border: "none", borderTop: "1px solid", borderColor: "divider", my: 3 },
  // inline code
  "& :not(pre) > code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    fontSize: "0.875em",
    bgcolor: "action.hover",
    px: 0.5,
    py: 0.25,
    borderRadius: 1,
  },
  // fenced code blocks
  "& pre": {
    bgcolor: "grey.100",
    border: "1px solid",
    borderColor: "divider",
    borderRadius: 1.5,
    p: 2,
    my: 2,
    overflowX: "auto",
    fontSize: "0.875rem",
    lineHeight: 1.5,
  },
  "& pre code": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
    bgcolor: "transparent",
    p: 0,
  },
  // GFM tables
  "& table": {
    borderCollapse: "collapse",
    width: "100%",
    my: 2,
    fontSize: "0.9375rem",
  },
  "& th, & td": {
    border: "1px solid",
    borderColor: "divider",
    px: 1.5,
    py: 1,
    textAlign: "left",
  },
  "& thead th": { bgcolor: "action.hover", fontWeight: 600 },
  "& tbody tr:nth-of-type(even)": { bgcolor: "action.hover" },
  // KaTeX display math should scroll rather than overflow the card
  "& .katex-display": { overflowX: "auto", overflowY: "hidden", py: 0.5 },
  "& img": { maxWidth: "100%" },
};

export interface MarkdownProps {
  /** LLM-generated (untrusted) markdown, possibly containing GFM and LaTeX math. */
  children: string;
}

/**
 * Reusable renderer for LLM-generated markdown.
 *
 * Supports GitHub-Flavored Markdown (tables, task lists, strikethrough),
 * LaTeX math ($inline$ and $$block$$) via KaTeX, and syntax-highlighted fenced
 * code via highlight.js. Output is sanitized against XSS (see `schema`).
 *
 * This is a React Server Component: react-markdown builds a React element tree
 * (no dangerouslySetInnerHTML) and every plugin used here is synchronous, so no
 * "use client" boundary is required and nothing is shipped to the client bundle
 * beyond the KaTeX/hljs CSS.
 */
export default function Markdown({ children }: MarkdownProps) {
  return (
    <Box sx={sx} className="kc-markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[
          [rehypeSanitize, schema],
          rehypeKatex,
          rehypeHighlight,
        ]}
      >
        {children}
      </ReactMarkdown>
    </Box>
  );
}
