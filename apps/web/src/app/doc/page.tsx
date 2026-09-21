import { DocumentView, docViewFrom } from '@/components/document-view'
import { withBrain } from '@/lib/brain'
import { readDoc } from '@g-brain/core'
import { BrainErrorCard } from '../error-page'

export const dynamic = 'force-dynamic'

/**
 * A document addressed by path alone. Search crosses projects, so a hit cannot
 * assume one. Authorisation is unchanged — readDoc refuses an out-of-scope path
 * whether or not anything is there.
 */
export default async function AnyDocPage({
  searchParams,
}: {
  searchParams: Promise<{ path?: string; view?: string }>
}) {
  const { path, view } = await searchParams

  if (path === undefined) {
    return <p className="text-sm text-muted-foreground">No document path given.</p>
  }

  const result = await withBrain((ctx) => readDoc(ctx, { path }))

  if (!result.ok) {
    return <BrainErrorCard code={result.error.code} message={result.error.message} />
  }

  return (
    <DocumentView
      doc={result.value}
      view={docViewFrom(view)}
      base={`/doc?path=${encodeURIComponent(path)}`}
      back={{ href: '/', label: 'projects' }}
    />
  )
}
