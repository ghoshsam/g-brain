import { cn } from '@/lib/utils'
import type * as React from 'react'

function Separator({ className, ...props }: React.ComponentProps<'div'>) {
  return <div aria-hidden="true" className={cn('h-px w-full bg-border', className)} {...props} />
}

export { Separator }
