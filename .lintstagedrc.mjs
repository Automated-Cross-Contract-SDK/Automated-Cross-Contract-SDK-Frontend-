import path from 'node:path'

/**
 * Maps staged TypeScript files to the workspace packages that own them and
 * runs `turbo run typecheck` for just those packages. Turbo's cache keeps a
 * repeat run in the low seconds. Returns no command when nothing under
 * `packages/*` is staged, so docs-only commits never typecheck.
 *
 * Escape hatch: `git commit --no-verify` skips the whole hook.
 */
function typecheckOwners(files) {
  const owners = new Set()
  for (const file of files) {
    const [top, pkg] = path.relative(process.cwd(), file).split(path.sep)
    if (top === 'packages' && pkg) owners.add(`--filter=./packages/${pkg}`)
  }
  return owners.size
    ? [`turbo run typecheck --output-logs=errors-only ${[...owners].join(' ')}`]
    : []
}

const quote = (files) => files.map((f) => JSON.stringify(f)).join(' ')

export default {
  '*.{ts,tsx}': (files) => [
    `eslint --fix ${quote(files)}`,
    `prettier --write ${quote(files)}`,
    ...typecheckOwners(files),
  ],
  '*.{json,md}': ['prettier --write'],
}
