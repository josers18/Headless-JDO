"use client";

/**
 * components/horizon/MarkdownView.tsx
 *
 * Small, self-contained markdown renderer for Horizon. Used in the Ask
 * bar (and anywhere else we want the LLM's prose to render with real
 * typography rather than pre-wrapped plain text).
 *
 * Features:
 *   - GitHub-flavored markdown via remark-gfm: tables, strikethrough,
 *     task lists, autolinks.
 *   - Raw HTML via rehype-raw (the model can emit <b>, <table>, <br>,
 *     etc. for light inline styling).
 *   - XSS scrub via rehype-sanitize with the hast defaultSchema. Any
 *     script/iframe/onclick injected payloads are stripped before
 *     render. We explicitly do NOT pass-through attributes like onClick
 *     or style with url() so a compromised LLM response cannot execute
 *     scripts or exfiltrate data.
 *
 * Styling is all tailwind classes on component overrides — we avoid
 * @tailwindcss/typography to keep the bundle light and to keep visual
 * control in one place.
 */

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeRaw from "rehype-raw";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";

// Derive a sanitize schema from the default. We explicitly deny a few
// attribute+tag combos that we don't want (onClick etc. are already denied
// by default, but we also want to make sure `style` attributes are only
// allowed when they don't contain url() / expression().
// Rather than writing a custom attribute validator, we rely on the default
// allowlist which already rejects event handlers. We just extend
// className allowlist so our component overrides can tag elements.
const schema = {
  ...defaultSchema,
  attributes: {
    ...(defaultSchema.attributes || {}),
    "*": [
      ...((defaultSchema.attributes && defaultSchema.attributes["*"]) || []),
      "className",
    ],
    code: [
      ...((defaultSchema.attributes && defaultSchema.attributes.code) || []),
      "className",
    ],
  },
};

// Component overrides — styled for the dark Horizon theme. Each node type
// maps to a small tailwind-only render. We keep the typographic rhythm
// consistent with the rest of the UI (tight, high-contrast, mono for
// code blocks).
const components: Components = {
  h1: ({ className, ...p }) => (
    <h1
      className={cn(
        "mb-2 mt-4 font-display text-[17px] font-semibold tracking-tight text-text",
        className
      )}
      {...p}
    />
  ),
  h2: ({ className, ...p }) => (
    <h2
      className={cn(
        "mb-2 mt-4 font-display text-[15px] font-semibold tracking-tight text-text",
        className
      )}
      {...p}
    />
  ),
  h3: ({ className, ...p }) => (
    <h3
      className={cn(
        "mb-1.5 mt-3 font-display text-[14px] font-medium tracking-tight text-text",
        className
      )}
      {...p}
    />
  ),
  p: ({ className, ...p }) => (
    <p
      className={cn(
        "my-2 text-[14px] leading-relaxed text-text first:mt-0 last:mb-0",
        className
      )}
      {...p}
    />
  ),
  a: ({ className, ...p }) => (
    <a
      className={cn(
        "text-accent underline-offset-2 hover:underline",
        className
      )}
      target="_blank"
      rel="noopener noreferrer"
      {...p}
    />
  ),
  ul: ({ className, ...p }) => (
    <ul
      className={cn(
        "my-2 list-disc space-y-1 pl-5 text-[14px] leading-relaxed text-text marker:text-text-muted/70",
        className
      )}
      {...p}
    />
  ),
  ol: ({ className, ...p }) => (
    <ol
      className={cn(
        "my-2 list-decimal space-y-1 pl-5 text-[14px] leading-relaxed text-text marker:text-text-muted/70",
        className
      )}
      {...p}
    />
  ),
  li: ({ className, ...p }) => (
    <li className={cn("pl-1", className)} {...p} />
  ),
  strong: ({ className, ...p }) => (
    <strong className={cn("font-semibold text-text", className)} {...p} />
  ),
  em: ({ className, ...p }) => (
    <em className={cn("italic text-text", className)} {...p} />
  ),
  del: ({ className, ...p }) => (
    <del className={cn("text-text-muted line-through", className)} {...p} />
  ),
  hr: ({ className, ...p }) => (
    <hr
      className={cn("my-4 border-0 hairline", className)}
      {...p}
    />
  ),
  blockquote: ({ className, ...p }) => (
    <blockquote
      className={cn(
        "my-3 border-l-2 border-accent/40 bg-accent/5 px-3 py-1.5 text-[13.5px] italic text-text-muted",
        className
      )}
      {...p}
    />
  ),
  code: ({ className, children, ...p }) => {
    // Inline vs block code: react-markdown v9+ passes `inline` prop
    // through the `node` but not directly; simplest heuristic is
    // whether the parent is a <pre>. We style both here — the <pre>
    // override handles the outer block, this handles inline.
    const isBlock = typeof className === "string" && /language-/.test(className);
    if (isBlock) {
      return (
        <code
          className={cn(
            "block font-mono text-[12.5px] leading-snug",
            className
          )}
          {...p}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        className={cn(
          "rounded bg-surface2 px-1 py-[1px] font-mono text-[12.5px] text-accent-2",
          className
        )}
        {...p}
      >
        {children}
      </code>
    );
  },
  pre: ({ className, ...p }) => (
    <pre
      className={cn(
        "my-3 overflow-x-auto rounded-md border border-border-soft bg-black/40 px-3 py-2 font-mono text-[12.5px] text-text",
        className
      )}
      {...p}
    />
  ),
  table: ({ className, ...p }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-border-soft">
      <table
        className={cn(
          "w-full border-collapse text-left text-[13px]",
          className
        )}
        {...p}
      />
    </div>
  ),
  thead: ({ className, ...p }) => (
    <thead
      className={cn(
        "bg-surface2/60 text-[11px] uppercase tracking-[0.08em] text-text-muted",
        className
      )}
      {...p}
    />
  ),
  tbody: ({ className, ...p }) => (
    <tbody
      className={cn("divide-y divide-border-soft/60", className)}
      {...p}
    />
  ),
  tr: ({ className, ...p }) => (
    <tr
      className={cn(
        "transition-colors hover:bg-surface2/40",
        className
      )}
      {...p}
    />
  ),
  th: ({ className, ...p }) => (
    <th
      className={cn("px-3 py-2 font-medium text-text", className)}
      {...p}
    />
  ),
  td: ({ className, ...p }) => (
    <td className={cn("px-3 py-2 text-text", className)} {...p} />
  ),
};

export function MarkdownView({
  source,
  className,
}: {
  source: string;
  className?: string;
}) {
  return (
    <div className={cn("horizon-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw, [rehypeSanitize, schema]]}
        components={components}
      >
        {source}
      </ReactMarkdown>
    </div>
  );
}
