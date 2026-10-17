import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const packagesRoot = path.join(root, 'packages')
const temporaryRoot = mkdtempSync(path.join(os.tmpdir(), 'soroban-packed-exports-'))
const archivesRoot = path.join(temporaryRoot, 'archives')
const fixtureRoot = path.join(temporaryRoot, 'fixture')
mkdirSync(archivesRoot)
mkdirSync(fixtureRoot)

function run(command, args, options = {}) {
  execFileSync(command, args, { cwd: root, stdio: 'inherit', ...options })
}

function getExportTargets(value) {
  if (typeof value === 'string') return [value]
  if (!value || typeof value !== 'object') return []
  return Object.values(value).flatMap(getExportTargets)
}

try {
  const packageInfos = readdirSync(packagesRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => {
      const directory = path.join(packagesRoot, entry.name)
      const manifest = JSON.parse(readFileSync(path.join(directory, 'package.json'), 'utf8'))
      return { directory, manifest }
    })
    .filter(({ manifest }) => manifest.exports && manifest.scripts?.build)

  if (packageInfos.length === 0) {
    throw new Error('No buildable packages with published exports were found.')
  }

  const packageFiles = {}
  const archivePaths = {}

  for (const { directory, manifest } of packageInfos) {
    const packed = JSON.parse(
      execFileSync('npm', ['pack', directory, '--json', '--pack-destination', archivesRoot], {
        cwd: root,
        encoding: 'utf8',
      }),
    )[0]
    const requiredFiles = Object.entries(manifest.exports).flatMap(([subpath, target]) => {
      const targets = getExportTargets(target).map((file) => file.replace(/^\.\//, ''))
      if (targets.length === 0) {
        throw new Error(`${manifest.name} export "${subpath}" has no file targets.`)
      }
      return targets.map((file) => ({ subpath, file }))
    })

    for (const { subpath, file } of requiredFiles) {
      if (!packed.files.some(({ path: packedFile }) => packedFile === file)) {
        throw new Error(
          `${manifest.name} export "${subpath}" target "${file}" is missing from its tarball.`,
        )
      }
    }

    packageFiles[manifest.name] = manifest
    archivePaths[manifest.name] = `file:../archives/${packed.filename}`
  }

  const dependencies = Object.fromEntries(
    Object.entries(archivePaths).map(([name, archivePath]) => [name, archivePath]),
  )
  writeFileSync(
    path.join(fixtureRoot, 'package.json'),
    JSON.stringify(
      { name: 'packed-export-fixture', private: true, type: 'module', dependencies },
      null,
      2,
    ),
  )
  run('npm', [
    'install',
    '--prefix',
    fixtureRoot,
    '--ignore-scripts',
    '--no-audit',
    '--no-fund',
    '--no-package-lock',
  ])

  const specifiers = Object.entries(packageFiles).flatMap(([name, manifest]) =>
    Object.keys(manifest.exports).map((subpath) =>
      subpath === '.' ? name : `${name}/${subpath.slice(2)}`,
    ),
  )
  const runtimeImports = specifiers
    .map(
      (specifier) => `if (Object.keys(await import(${JSON.stringify(specifier)})).length === 0) {
  throw new Error(${JSON.stringify(`${specifier} exposed no runtime exports`)})
}`,
    )
    .join('\n')
  const peerResolutions = Object.entries(packageFiles).flatMap(([name, manifest]) =>
    Object.entries(manifest.peerDependencies ?? {})
      .filter(([peer]) => manifest.peerDependenciesMeta?.[peer]?.optional !== true)
      .map(([peer]) => `import.meta.resolve(${JSON.stringify(peer)})`),
  )
  writeFileSync(
    path.join(fixtureRoot, 'runtime-check.mjs'),
    `${runtimeImports}\n${peerResolutions.join('\n')}\n`,
  )
  run(process.execPath, [path.join(fixtureRoot, 'runtime-check.mjs')])

  const typeImports = specifiers
    .map(
      (specifier, index) =>
        `import * as Export${index} from ${JSON.stringify(specifier)}\nvoid Export${index}`,
    )
    .join('\n')
  const typecheckFile = path.join(fixtureRoot, 'exports.mts')
  writeFileSync(typecheckFile, typeImports)
  run(process.execPath, [
    path.join(root, 'node_modules/typescript/bin/tsc'),
    '--noEmit',
    '--strict',
    '--skipLibCheck',
    '--module',
    'NodeNext',
    '--moduleResolution',
    'NodeNext',
    '--target',
    'ES2022',
    typecheckFile,
  ])

  console.log(
    `Verified ${specifiers.length} published exports across ${packageInfos.length} packages.`,
  )
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
