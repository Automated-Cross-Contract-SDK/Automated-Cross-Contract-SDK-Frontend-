# Project Scaffolder

A small CLI that generates a new project from a template. It can run
interactively (prompting for each option) or non-interactively for automation
and CI.

## Usage

```bash
# Interactive (default)
scaffold

# Non-interactive
scaffold --non-interactive --name my-app --template basic
```

## Options

| Flag | Description |
| --- | --- |
| `--non-interactive` | Disable all prompts. Every required option must be supplied via flags. |
| `--name <name>` | Project name. Required in non-interactive mode. |
| `--template <template>` | Template to use (e.g. `basic`, `full`). Required in non-interactive mode. |
| `--force` | Overwrite an existing target directory. |
| `--dry-run` | Print the files that would be generated without writing them. |

## Non-interactive mode

When `--non-interactive` is set, the scaffolder never prompts. It validates the
supplied options up front and exits with a non-zero status on any problem, so it
is safe to use in CI pipelines.

Validation rules:

- `--name` and `--template` are required.
- `--name` must be a valid, non-empty project name.
- `--template` must be one of the known templates.
- Conflicting combinations (for example `--force` together with `--dry-run`)
  are rejected with a clear error message.

On success it prints a deterministic, sorted summary of the generated files:

```
Generated files:
  package.json
  src/index.ts
  tsconfig.json
```

The summary is stable across runs (sorted paths, no timestamps), which makes it
suitable for diffing in CI.

## Compatibility

Interactive mode is unchanged and remains the default. Existing scripts that
rely on prompts keep working; opt into non-interactive mode explicitly with
`--non-interactive`.
