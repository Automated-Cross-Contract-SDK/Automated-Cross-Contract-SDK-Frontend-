<script setup lang="ts">
import {
  NETWORK_OPTIONS,
  PASSPHRASE_OPTIONS,
  type NetworkConfig,
  type NetworkId,
} from '../config.js'

const props = defineProps<{
  /** Currently selected network preset. */
  id: NetworkId
  /** Values used when `id === 'custom'`. */
  custom: NetworkConfig
}>()

const emit = defineEmits<{
  'update:id': [value: NetworkId]
  'update:custom': [value: NetworkConfig]
}>()

const onSelect = (event: Event): void => {
  emit('update:id', (event.target as HTMLSelectElement).value as NetworkId)
}

const updateCustom = (patch: Partial<NetworkConfig>): void => {
  emit('update:custom', { ...props.custom, ...patch })
}
</script>

<template>
  <div class="sr-field">
    <label class="sr-label" for="sr-network">Network</label>
    <select id="sr-network" class="sr-input" :value="props.id" @change="onSelect">
      <option v-for="option in NETWORK_OPTIONS" :key="option.id" :value="option.id">
        {{ option.label }}
      </option>
      <option value="custom">Custom</option>
    </select>

    <div v-if="props.id === 'custom'" class="sr-field__stack">
      <input
        class="sr-input"
        aria-label="Custom RPC URL"
        placeholder="RPC URL (https://…)"
        :value="props.custom.rpcUrl"
        @input="updateCustom({ rpcUrl: ($event.target as HTMLInputElement).value })"
      />
      <select
        class="sr-input"
        aria-label="Custom network passphrase"
        :value="props.custom.networkPassphrase"
        @change="updateCustom({ networkPassphrase: ($event.target as HTMLSelectElement).value })"
      >
        <option v-for="option in PASSPHRASE_OPTIONS" :key="option.value" :value="option.value">
          {{ option.label }}
        </option>
      </select>
    </div>
  </div>
</template>
