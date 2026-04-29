<template>
  <div class="ogc-process-select f-col">
    <div v-if="loading" class="f-row-ac p-2">
      <v-spinner size="20"/>
      <span class="mx-2">Loading processes…</span>
    </div>
    <div v-else-if="error" class="error-msg p-2">
      <span>Failed to load processes</span>
      <v-btn class="small outlined" @click="fetchProcesses">Retry</v-btn>
    </div>
    <v-select
      v-else
      class="trim-text"
      :label="selectLabel"
      :items="processes"
      :value="value"
      item-text="title"
      item-value="id"
      placeholder="Select a process"
      @input="$emit('input', $event)"
    >
      <template #item="{ item }">
        <div class="process-item f-col">
          <span class="title" v-text="item.title || item.id"/>
          <span v-if="item.description" class="description" v-text="item.description"/>
        </div>
      </template>
      <template #selection="{ item }">
        <span v-text="item.title || item.id || ''" class="value"/>
      </template>
    </v-select>
  </div>
</template>

<script>
import axios from 'axios'

export default {
  props: {
    baseUrl: {
      type: String,
      required: true
    },
    value: {
      type: String,
      default: null
    },
    selectLabel: {
      type: String,
      default: 'Process'
    }
  },
  data () {
    return {
      processes: [],
      loading: false,
      error: null
    }
  },
  created () {
    this.fetchProcesses()
  },
  watch: {
    baseUrl: 'fetchProcesses'
  },
  methods: {
    async fetchProcesses () {
      this.loading = true
      this.error = null
      try {
        const { data } = await axios.get(`${this.baseUrl}/processes`)
        this.processes = (data.processes || []).map(p => ({
          id: p.id,
          title: p.title || p.id,
          description: p.description || '',
          version: p.version
        }))
      } catch (err) {
        this.error = err
        console.error('Failed to fetch OGC processes:', err)
      } finally {
        this.loading = false
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.ogc-process-select {
  .label {
    font-weight: 500;
    margin-bottom: 4px;
  }
  .error-msg {
    color: var(--color-red, #d32f2f);
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
.process-item {
  padding: 4px 8px;
  .title {
    font-weight: 500;
  }
  .description {
    font-size: 0.85em;
    opacity: 0.7;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
}
</style>
