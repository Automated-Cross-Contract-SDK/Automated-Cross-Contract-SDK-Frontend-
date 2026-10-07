#!/usr/bin/env node
// Scaffolds a minimal Vite + React app wired to @soroban-resurrect/sdk.
// Usage: npm create soroban-resurrect@latest [dir] [--network testnet] [--wallet freighter] [--yes]
import { cpSync, existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

const NETWORKS = ['testnet', 'futurenet', 'mainnet']
const WALLETS = ['freighter', 'albedo', 'xbull', 'lobstr', 'rabet']
const SDK_VERSION = '^0.1.0'

const argv = process.argv.slice(2)
const flag = (name) => {
  const i = argv.indexOf(`--${name}`)
  return i === -1 ? undefined : argv[i + 1]
}
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'))
const yes = argv.includes('--yes') || argv.includes('-y') || !process.stdin.isTTY

async function ask(rl, question, choices, fallback) {
  if (yes) return fallback
  const hint = choices ? ` (${choices.join('/')})` : ''
  const answer = (await rl.question(`? ${question}${hint} [${fallback}] `)).trim() || fallback
  if (choices && !choices.includes(answer)) {
    console.error(`  "${answer}" is not one of ${choices.join(', ')}`)
    return ask(rl, question, choices, fallback)
  }
  return answer
}

const rl = yes ? null : createInterface({ input: process.stdin, output: process.stdout })
const dir = positional[0] ?? (await ask(rl, 'Project directory', null, 'soroban-resurrect-app'))
const network = flag('network') ?? (await ask(rl, 'Network', NETWORKS, 'testnet'))
const wallet = flag('wallet') ?? (await ask(rl, 'Wallet', WALLETS, 'freighter'))
rl?.close()

if (!NETWORKS.includes(network) || !WALLETS.includes(wallet)) {
  console.error(`Unsupported network/wallet: ${network}/${wallet}`)
  process.exit(1)
}

const target = path.resolve(dir)
if (existsSync(target) && readdirSync(target).length > 0) {
  console.error(`Target directory ${target} is not empty.`)
  process.exit(1)
}

const templateDir = path.join(path.dirname(fileURLToPath(import.meta.url)), 'template')
cpSync(templateDir, target, { recursive: true })
// npm strips dotfiles from published tarballs, so they ship with a `_` prefix.
renameSync(path.join(target, '_gitignore'), path.join(target, '.gitignore'))

writeFileSync(
  path.join(target, '.env'),
  `VITE_NETWORK=${network}\nVITE_WALLET=${wallet}\n# Contract to invoke; its instance TTL drives the warning banner.\nVITE_CONTRACT_ID=\nVITE_CONTRACT_FN=hello\n`,
)

const pkgPath = path.join(target, 'package.json')
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
pkg.name = path
  .basename(target)
  .toLowerCase()
  .replace(/[^a-z0-9-_.]/g, '-')
pkg.dependencies[`@soroban-resurrect/adapter-${wallet}`] = SDK_VERSION
writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n')

const rel = path.relative(process.cwd(), target) || '.'
console.log(`\nScaffolded ${pkg.name} (${network}, ${wallet}).\n`)
console.log(`  cd ${rel}\n  npm install\n  # set VITE_CONTRACT_ID in .env\n  npm run dev\n`)
