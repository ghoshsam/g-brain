import { join } from 'node:path'
import type { NextConfig } from 'next'

const config: NextConfig = {
  // Next walks up looking for a lockfile and can settle on one outside the repo
  // — a stray package-lock.json in a home directory is enough. Pinning the root
  // keeps file tracing inside this workspace.
  outputFileTracingRoot: join(import.meta.dirname, '../..'),

  // core reaches the filesystem, git and the index. Bundling it would sever it
  // from the brain directory it is meant to read.
  serverExternalPackages: ['@g-brain/core', '@g-brain/search'],
}

export default config
