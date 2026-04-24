<template>
  <div class="artifacts-list f-col">
    <div
      v-for="artifact in artifacts"
      :key="artifact.output_id"
      class="artifact-item f-col"
    >
      <div class="artifact-row f-row-ac">
        <v-icon name="file-outline" size="14" class="mr-1 flex-shrink-0"/>
        <span class="artifact-name f-grow">{{ artifact.path }}</span>
        <span class="artifact-size">{{ formatFileSize(artifact.size_bytes) }}</span>
        <a :href="artifact.download_url" :download="artifact.path">
          <v-btn class="icon small">
            <v-icon name="download" size="14"/>
          </v-btn>
        </a>
        <v-btn
          v-if="artifact.media_kind === 'json'"
          class="icon small"
          @click="toggleJson(artifact)"
        >
          <v-icon :name="expanded[artifact.output_id] ? 'arrow-down' : 'arrow-right'" size="14"/>
        </v-btn>
      </div>
      <div
        v-if="artifact.media_kind === 'json' && expanded[artifact.output_id]"
        class="artifact-json"
      >
        <v-spinner v-if="loading[artifact.output_id]" size="16" width="2"/>
        <json-viewer
          v-else-if="data[artifact.output_id]"
          :data="data[artifact.output_id]"
        />
        <span v-else-if="errors[artifact.output_id]" class="error-text">
          {{ errors[artifact.output_id] }}
        </span>
      </div>
    </div>
  </div>
</template>

<script>
import axios from 'axios'
import JsonViewer from './JsonViewer.vue'
import { formatFileSize } from './utils'

export default {
  components: { JsonViewer },
  props: {
    artifacts: { type: Array, default: () => [] }
  },
  data () {
    return {
      expanded: {},
      loading: {},
      data: {},
      errors: {}
    }
  },
  methods: {
    formatFileSize,
    async toggleJson (artifact) {
      const id = artifact.output_id
      this.$set(this.expanded, id, !this.expanded[id])
      if (!this.expanded[id] || this.data[id]) return
      this.$set(this.loading, id, true)
      try {
        const { data } = await axios.get(artifact.download_url)
        this.$set(this.data, id, data)
      } catch (err) {
        this.$set(this.errors, id, err.message)
      } finally {
        this.$set(this.loading, id, false)
      }
    }
  }
}
</script>

<style lang="scss" scoped>
.artifacts-list { gap: 4px }
.artifact-item {
  border: 1px solid rgba(0,0,0,0.08);
  border-radius: 4px;
  overflow: hidden;
}
.artifact-row {
  padding: 4px 6px;
  gap: 4px;
  background: rgba(0,0,0,0.02);
}
.artifact-name {
  font-size: 0.85em;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.artifact-size {
  font-size: 0.75em;
  opacity: 0.55;
  white-space: nowrap;
}
.artifact-json {
  padding: 6px 8px;
  overflow: auto;
  max-height: 300px;
}
.error-text {
  color: var(--color-red, #d32f2f);
  font-size: 0.85em;
}
</style>
