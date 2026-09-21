import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BrainErrorCode } from '@g-brain/core'

/**
 * The code is printed verbatim so a reader can quote it. FORBIDDEN is safe to
 * render as FORBIDDEN: core/auth returns it for an out-of-scope path whether or
 * not a document is there, so it confirms the key is out of scope and confirms
 * nothing about content.
 */
export function BrainErrorCard({ code, message }: { code: BrainErrorCode; message: string }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="font-mono text-sm">{code}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">{message}</CardContent>
    </Card>
  )
}
