import { DocumentView, docViewFrom } from '@/components/document-view'
import { withBrain } from '@/lib/brain'
import { readDoc } from '@g-brain/core'
import { BrainErrorCard } from '../../../error-page'

export const dynamic = 'force-dynamic'

export default async function DocPage({
  params,
  searchParams,
}: {
  params: Promise<{ project: string }>
  searchParams: Promise<{ path?: string; view?: string }>
}) {
  const { project } = await params
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
      base={`/p/${encodeURIComponent(project)}/doc?path=${encodeURIComponent(path)}`}
      back={{ href: `/p/${encodeURIComponent(project)}`, label: project }}
    />
  )
}
