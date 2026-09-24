<script setup lang="ts">
import { computed, ref } from 'vue'
import { connectWallet } from '../wallet.js'

const props = defineProps<{
  /** Connected account, owned by the parent so both integration paths share it. */
  address: string | null
}>()

const emit = defineEmits<{
  connected: [address: string]
}>()

const connecting = ref(false)
const error = ref<string | null>(null)

const shortAddress = computed(() =>
  props.address ? `${props.address.slice(0, 8)}…${props.address.slice(-4)}` : '',
)

async function handleConnect(): Promise<void> {
  connecting.value = true
  error.value = null
  try {
    emit('connected', await connectWallet())
  } catch (err) {
    error.value = err instanceof Error ? err.message : String(err)
  } finally {
    connecting.value = false
  }
}
</script>

<template>
  <div class="sr-wallet">
    <button
      v-if="!address"
      class="sr-btn sr-btn--primary"
      :disabled="connecting"
      @click="handleConnect"
    >
      {{ connecting ? 'Connecting…' : 'Connect Freighter Wallet' }}
    </button>
    <p v-else class="sr-wallet__account">
      Connected: <code>{{ shortAddress }}</code>
    </p>
    <p v-if="error" class="sr-notice sr-notice--error">{{ error }}</p>
  </div>
</template>
