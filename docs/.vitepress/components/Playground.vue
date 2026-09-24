<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import { useData } from 'vitepress'
import type { EditorView } from 'codemirror'
import type { Compartment, Extension } from '@codemirror/state'
import {
  DEFAULT_SNIPPET,
  SCENARIOS,
  formatValue,
  runPlayground,
  type PlaygroundScenario,
  type RunOutcome,
} from './playground/runner'

/**
 * In-browser playground for the Soroban-Resurrect docs.
 *
 * The editor holds a snippet; running it executes the snippet against the
 * dependency-free simulated SDK in `./playground/runner.ts` — a canned
 * in-browser RPC client, no wallet, no network. Output is shown as a state
 * timeline, console log, RPC call log, and final result.
 *
 * CodeMirror is imported lazily inside `onMounted` so nothing browser-only is
 * evaluated during VitePress' server-side render.
 */

const scenario = ref<PlaygroundScenario>('restore-needed')
const outcome = ref<RunOutcome | null>(null)
const running = ref(false)
const snippet = ref(DEFAULT_SNIPPET)

const editorEl = ref<HTMLElement | null>(null)
const view = shallowRef<EditorView | null>(null)

let themeCompartment: Compartment | null = null
let darkTheme: Extension = []

const { isDark } = useData()

const activeScenario = computed(
  () => SCENARIOS.find((option) => option.value === scenario.value) ?? SCENARIOS[0],
)

/** Last `submitWithRestore` result, or the snippet's return value. */
const result = computed(() => {
  if (!outcome.value) return null
  const last = outcome.value.results[outcome.value.results.length - 1]
  return last ?? outcome.value.returned ?? null
})

const hasOutput = computed(() => Boolean(outcome.value))

function isFailedResult(value: unknown): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'success' in value &&
    (value as { success?: boolean }).success === false
  )
}

async function run() {
  if (running.value) return
  running.value = true
  try {
    outcome.value = await runPlayground(snippet.value, scenario.value)
  } finally {
    running.value = false
  }
}

function reset() {
  snippet.value = DEFAULT_SNIPPET
  outcome.value = null
  if (view.value) {
    view.value.dispatch({
      changes: { from: 0, to: view.value.state.doc.length, insert: DEFAULT_SNIPPET },
    })
  }
}

onMounted(async () => {
  const [cm, js, oneDarkModule, stateModule] = await Promise.all([
    import('codemirror'),
    import('@codemirror/lang-javascript'),
    import('@codemirror/theme-one-dark'),
    import('@codemirror/state'),
  ])

  darkTheme = oneDarkModule.oneDark
  themeCompartment = new stateModule.Compartment()

  const editor = new cm.EditorView({
    doc: snippet.value,
    extensions: [
      cm.basicSetup,
      js.javascript(),
      themeCompartment.of(isDark.value ? darkTheme : []),
      cm.EditorView.updateListener.of((update) => {
        if (update.docChanged) snippet.value = update.state.doc.toString()
      }),
      cm.EditorView.domEventHandlers({
        keydown: (event) => {
          if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
            event.preventDefault()
            void run()
            return true
          }
          return false
        },
      }),
    ],
    parent: editorEl.value as HTMLElement,
  })

  view.value = editor
  void run()
})

watch(isDark, (dark) => {
  if (!view.value || !themeCompartment) return
  view.value.dispatch({ effects: themeCompartment.reconfigure(dark ? darkTheme : []) })
})

onBeforeUnmount(() => {
  view.value?.destroy()
  view.value = null
})
</script>

<template>
  <div class="playground">
    <div class="pg-toolbar">
      <label class="pg-field">
        <span class="pg-field-label">Scenario</span>
        <select v-model="scenario" class="pg-select">
          <option v-for="option in SCENARIOS" :key="option.value" :value="option.value">
            {{ option.label }}
          </option>
        </select>
      </label>

      <div class="pg-actions">
        <button class="pg-btn pg-btn-primary" :disabled="running" @click="run">
          {{ running ? 'Running…' : '▶ Run' }}
        </button>
        <button class="pg-btn" :disabled="running" @click="reset">Reset</button>
      </div>
    </div>

    <p class="pg-scenario-desc">{{ activeScenario.description }}</p>

    <div class="pg-panes">
      <section class="pg-pane">
        <header class="pg-pane-head">
          <span>Runner code</span>
          <span class="pg-hint">Ctrl / ⌘ + Enter to run</span>
        </header>
        <div ref="editorEl" class="pg-editor" />
      </section>

      <section class="pg-pane">
        <header class="pg-pane-head">
          <span>Output</span>
          <span v-if="outcome" class="pg-hint">{{ outcome.durationMs }} ms</span>
        </header>

        <div class="pg-output">
          <p v-if="!hasOutput" class="pg-empty">Press Run to execute the snippet.</p>

          <template v-else>
            <div v-if="outcome?.error" class="pg-error">
              <strong>Uncaught error</strong>
              <pre>{{ outcome.error }}</pre>
            </div>

            <div v-if="result" class="pg-block">
              <h4 class="pg-block-title">Result</h4>
              <pre class="pg-code" :class="{ 'pg-code-error': isFailedResult(result) }">{{
                formatValue(result)
              }}</pre>
            </div>

            <div v-if="outcome?.states.length" class="pg-block">
              <h4 class="pg-block-title">State timeline</h4>
              <ol class="pg-timeline">
                <li
                  v-for="(info, index) in outcome.states"
                  :key="index"
                  :class="`pg-state-${info.state}`"
                >
                  <code class="pg-state-name">{{ info.state }}</code>
                  <span class="pg-state-msg">{{ info.message }}</span>
                  <span v-if="info.archivedKeys" class="pg-state-meta">
                    {{ info.archivedKeys.length }} key(s)
                  </span>
                </li>
              </ol>
            </div>

            <div v-if="outcome?.rpcCalls.length" class="pg-block">
              <h4 class="pg-block-title">
                RPC calls <span class="pg-count">{{ outcome.rpcCalls.length }}</span>
              </h4>
              <ol class="pg-calls">
                <li v-for="call in outcome.rpcCalls" :key="call.seq">
                  <span class="pg-call-seq">{{ call.seq }}</span>
                  <code>{{ call.method }}</code>
                  <span class="pg-call-detail">{{ call.detail }}</span>
                </li>
              </ol>
            </div>

            <div v-if="outcome?.logs.length" class="pg-block">
              <h4 class="pg-block-title">Console</h4>
              <pre class="pg-console"><span
                v-for="(line, index) in outcome.logs"
                :key="index"
                class="pg-console-line"
                :class="`pg-line-${line.level}`"
              >{{ line.text }}
</span></pre>
            </div>
          </template>
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.playground {
  margin: 1.5rem 0 3rem;
}

.pg-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: flex-end;
  justify-content: space-between;
  gap: 0.75rem;
}

.pg-field {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
}

.pg-field-label {
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}

.pg-select {
  padding: 0.4rem 0.6rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 0.9rem;
}

.pg-actions {
  display: flex;
  gap: 0.5rem;
}

.pg-btn {
  padding: 0.45rem 0.9rem;
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 0.9rem;
  font-weight: 600;
  cursor: pointer;
  transition: background-color 0.2s;
}

.pg-btn:hover:not(:disabled) {
  background: var(--vp-c-bg-alt);
}

.pg-btn:disabled {
  opacity: 0.55;
  cursor: default;
}

.pg-btn-primary {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-1);
  color: #fff;
}

.pg-btn-primary:hover:not(:disabled) {
  background: var(--vp-c-brand-2);
}

.pg-scenario-desc {
  margin: 0.6rem 0 1rem;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.pg-panes {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: 1rem;
}

@media (max-width: 900px) {
  .pg-panes {
    grid-template-columns: minmax(0, 1fr);
  }
}

.pg-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  overflow: hidden;
  background: var(--vp-c-bg-soft);
}

.pg-pane-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  padding: 0.5rem 0.75rem;
  border-bottom: 1px solid var(--vp-c-divider);
  font-size: 0.78rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}

.pg-hint {
  font-size: 0.72rem;
  font-weight: 400;
  letter-spacing: normal;
  text-transform: none;
  color: var(--vp-c-text-3);
}

.pg-editor {
  height: 22rem;
  overflow: hidden;
}

.pg-editor :deep(.cm-editor) {
  height: 100%;
  font-size: 13px;
}

.pg-editor :deep(.cm-editor.cm-focused) {
  outline: none;
}

.pg-editor :deep(.cm-scroller) {
  font-family: var(--vp-font-family-mono);
  line-height: 1.55;
}

.pg-output {
  flex: 1;
  overflow: auto;
  max-height: 34rem;
  padding: 0.75rem;
}

.pg-empty {
  margin: 0;
  font-size: 0.85rem;
  color: var(--vp-c-text-3);
}

.pg-error {
  margin-bottom: 0.85rem;
  padding: 0.6rem 0.75rem;
  border: 1px solid var(--vp-c-danger-1);
  border-radius: 6px;
  background: var(--vp-c-danger-soft);
  font-size: 0.85rem;
}

.pg-error pre {
  margin: 0.35rem 0 0;
  white-space: pre-wrap;
  word-break: break-word;
}

.pg-block + .pg-block {
  margin-top: 1rem;
}

.pg-block-title {
  margin: 0 0 0.4rem;
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.03em;
  text-transform: uppercase;
  color: var(--vp-c-text-2);
}

.pg-count {
  display: inline-block;
  margin-left: 0.35rem;
  padding: 0 0.4rem;
  border-radius: 8px;
  background: var(--vp-c-bg-alt);
  font-size: 0.7rem;
}

.pg-code {
  margin: 0;
  padding: 0.65rem 0.75rem;
  border-radius: 6px;
  background: var(--vp-c-bg-alt);
  font-size: 0.8rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.pg-code-error {
  border-left: 3px solid var(--vp-c-danger-1);
}

.pg-timeline,
.pg-calls {
  margin: 0;
  padding: 0;
  list-style: none;
}

.pg-timeline li {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 0.4rem;
  padding: 0.3rem 0;
  border-left: 2px solid var(--vp-c-divider);
  padding-left: 0.6rem;
  font-size: 0.82rem;
}

.pg-timeline li.pg-state-success {
  border-left-color: var(--vp-c-green-1);
}

.pg-timeline li.pg-state-error {
  border-left-color: var(--vp-c-danger-1);
}

.pg-timeline li.pg-state-restore_needed {
  border-left-color: var(--vp-c-warning-1);
}

.pg-state-name {
  font-size: 0.78rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.pg-state-msg {
  color: var(--vp-c-text-2);
}

.pg-state-meta {
  margin-left: auto;
  font-size: 0.72rem;
  color: var(--vp-c-text-3);
}

.pg-calls li {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  padding: 0.25rem 0;
  font-size: 0.8rem;
}

.pg-call-seq {
  min-width: 1.1rem;
  color: var(--vp-c-text-3);
  font-variant-numeric: tabular-nums;
}

.pg-call-detail {
  color: var(--vp-c-text-3);
}

.pg-console {
  margin: 0;
  padding: 0.6rem 0.75rem;
  border-radius: 6px;
  background: var(--vp-c-bg-alt);
  font-size: 0.78rem;
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.pg-console-line {
  display: block;
}

.pg-line-warn {
  color: var(--vp-c-warning-1);
}

.pg-line-error {
  color: var(--vp-c-danger-1);
}
</style>

<style>
/* Widen the doc container on the playground page (see `pageClass` frontmatter). */
.playground-page .VPDoc .content-container {
  max-width: 1100px;
}
</style>
