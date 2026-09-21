import { Badge } from '@/components/ui/badge'
import { Separator } from '@/components/ui/separator'
import { cn } from '@/lib/utils'
import type { Doc } from '@g-brain/core'
import { stringifyDoc } from '@g-brain/core'
import Link from 'next/link'
import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

export type DocView = 'preview' | 'markdown'

export function docViewFrom(value: string | undefined): DocView {
  return value === 'markdown' ? 'markdown' : 'preview'
}

/**
 * `[[10-knowledge/auth/tokens.md]]` is how the brain links, and Obsidian
 * resolves it natively. Nothing else does, so it is rewritten to an ordinary
 * link before rendering — in the preview only. Markdown mode shows the file.
 */
function linkWikiLinks(body: string): string {
  return body.replace(/\[\[([^\]]+?\.md)\]\]/g, (_whole, path: string) => {
    const label = path.split('/').pop() ?? path
    return `[${label}](/doc?path=${encodeURIComponent(path)})`
  })
}

function ViewToggle({ base, view }: { base: string; view: DocView }) {
  const options: { mode: DocView; label: string }[] = [
    { mode: 'preview', label: 'Preview' },
    { mode: 'markdown', label: 'Markdown' },
  ]

  return (
    <div className="inline-flex rounded-md border border-border p-0.5">
      {options.map(({ mode, label }) => (
        <Link
          key={mode}
          href={mode === 'preview' ? base : `${base}${base.includes('?') ? '&' : '?'}view=markdown`}
          className={cn(
            'rounded px-2.5 py-1 text-xs transition-colors',
            view === mode
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </Link>
      ))}
    </div>
  )
}

export function DocumentView({
  doc,
  view,
  base,
  back,
}: {
  doc: Doc
  view: DocView
  /** This document's own URL, which the toggle adds `view=markdown` to. */
  base: string
  back: { href: string; label: string }
}) {
  const { meta, body } = doc

  return (
    <article className="max-w-3xl">
      <div className="flex items-center justify-between gap-4">
        <Link href={back.href} className="text-xs text-muted-foreground hover:underline">
          ← {back.label}
        </Link>
        <ViewToggle base={base} view={view} />
      </div>

      <h1 className="mt-3 text-2xl font-semibold tracking-tight">{meta.title ?? meta.path}</h1>

      <div className="mt-3 flex flex-wrap gap-2">
        {meta.type !== undefined && <Badge>{meta.type}</Badge>}
        {meta.status !== undefined && <Badge>{meta.status}</Badge>}
        {meta.updated !== undefined && <Badge>updated {meta.updated}</Badge>}
        {meta.tags.map((tag) => (
          <Badge key={tag}>#{tag}</Badge>
        ))}
      </div>

      <p className="mt-2 font-mono text-xs text-muted-foreground">{meta.path}</p>

      <Separator className="my-6" />

      {view === 'markdown' ? (
        // The whole file, frontmatter included — a brain that is plain markdown
        // should be readable as plain markdown.
        <pre className="overflow-x-auto whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-4 font-mono text-xs leading-relaxed">
          {stringifyDoc(doc)}
        </pre>
      ) : (
        <div className="prose-brain">
          {/*
            No rehype-raw, deliberately. Documents are written by agents, so raw
            HTML in a body would be script injection with extra steps.
          */}
          <Markdown remarkPlugins={[remarkGfm]}>{linkWikiLinks(body)}</Markdown>
        </div>
      )}
    </article>
  )
}
