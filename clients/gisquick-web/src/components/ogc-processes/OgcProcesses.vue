<template>
  <div class="ogc-processes f-col">
    <ogc-process-select
      :base-url="baseUrl"
      :label="label"
      v-model="selectedProcessId"
    />
    <template v-if="selectedProcessId">
      <ogc-process-form
        ref="processForm"
        :base-url="baseUrl"
        :process-id="selectedProcessId"
        v-model="formValues"
        @identify-feature="$emit('identify-feature', $event)"
      />
      <div class="actions f-row-ac mt-2">
        <v-btn
          color="primary"
          :loading="executing"
          :disabled="executing || polling"
          @click="execute"
        >
          Execute
        </v-btn>
        <div v-if="polling" class="polling-status f-row-ac ml-2">
          <v-spinner size="16" width="2" class="mr-1"/>
          <span class="polling-text">{{ pollingStatus }}</span>
        </div>
      </div>
      <div v-if="result" class="result-panel f-col mt-2">
        <div class="result-header f-row-ac">
          <h4 class="m-0 f-grow">Result</h4>
          <v-btn class="icon small" @click="clearResult">
            <v-icon name="x" size="16"/>
          </v-btn>
        </div>
        <div class="result-body f-col">
          <div v-if="result.ows_url" class="layer-added f-row-ac">
            <v-icon name="layers" size="14" class="mr-1"/>
            <span>Spatial layer added to map</span>
          </div>
          <div
            v-if="!result.artifacts || !result.artifacts.length"
            class="no-artifacts"
          >
            <span v-if="!result.ows_url">Process completed with no file outputs.</span>
          </div>
          <div v-else class="artifacts-list f-col">
            <div
              v-for="artifact in result.artifacts"
              :key="artifact.output_id"
              class="artifact-item f-col"
            >
              <div class="artifact-row f-row-ac">
                <v-icon name="file-outline" size="14" class="mr-1 flex-shrink-0"/>
                <span class="artifact-name f-grow">{{ artifact.path }}</span>
                <span class="artifact-size">{{ formatSize(artifact.size_bytes) }}</span>
                <a :href="artifact.download_url" :download="artifact.path">
                  <v-btn class="icon small">
                    <v-icon name="download" size="14"/>
                  </v-btn>
                </a>
                <v-btn
                  v-if="artifact.media_kind === 'json'"
                  class="icon small"
                  @click="toggleJsonArtifact(artifact)"
                >
                  <v-icon :name="expandedArtifacts[artifact.output_id] ? 'arrow-down' : 'arrow-right'" size="14"/>
                </v-btn>
              </div>
              <div
                v-if="artifact.media_kind === 'json' && expandedArtifacts[artifact.output_id]"
                class="artifact-json"
              >
                <v-spinner v-if="loadingArtifacts[artifact.output_id]" size="16" width="2"/>
                <json-viewer
                  v-else-if="jsonArtifactData[artifact.output_id]"
                  :data="jsonArtifactData[artifact.output_id]"
                />
                <span v-else-if="artifactErrors[artifact.output_id]" class="error-text">
                  {{ artifactErrors[artifact.output_id] }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
      <div v-if="executeError" class="error-panel mt-2 p-2">
        <strong>Error:</strong> {{ executeError }}
      </div>
    </template>
  </div>
</template>

<script>
import axios from 'axios'
import OgcProcessSelect from './OgcProcessSelect.vue'
import OgcProcessForm from './OgcProcessForm.vue'
import JsonViewer from './JsonViewer.vue'

const OGC_REL_RESULTS = 'http://www.opengis.net/def/rel/ogc/1.0/results'

function extractResultsUrl (links) {
  if (!Array.isArray(links)) return null
  const candidates = links.filter(l => l.rel === OGC_REL_RESULTS)
  return candidates.find(l => l.type === 'application/json')?.href
    || candidates.find(l => l.type === 'application/geo+json')?.href
    || candidates[0]?.href
    || null
}

const POLL_INTERVAL_MS = 2000
const POLL_MAX_RETRIES = 300  // 300 × 2s = 10 minutes
const FAILURE_STATUSES = new Set(['failed', 'error', 'dismissed', 'canceled', 'cancelled'])

function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export default {
  components: { OgcProcessSelect, OgcProcessForm, JsonViewer },
  props: {
    baseUrl: {
      type: String,
      default: 'https://developer.ogc.org/api/processes'
    },
    label: {
      type: String,
      default: 'OGC Processes'
    }
  },
  data () {
    return {
      selectedProcessId: null,
      formValues: {},
      executing: false,
      result: null,
      executeError: null,
      polling: false,
      pollingStatus: '',
      expandedArtifacts: {},
      loadingArtifacts: {},
      jsonArtifactData: {},
      artifactErrors: {}
    }
  },
  computed: {},
  watch: {
    selectedProcessId () {
      this.clearResult()
    }
  },
  beforeDestroy () {
    this._pollingCancelled = true
  },
  methods: {
    async pollJobStatus (jobStatusUrl) {
      this.polling = true
      this.pollingStatus = 'Running… (0s)'
      const startTime = Date.now()
      let attempt = 0
      try {
        while (attempt < POLL_MAX_RETRIES) {
          if (this._pollingCancelled) return
          await sleep(POLL_INTERVAL_MS)
          if (this._pollingCancelled) return
          attempt++
          const elapsed = Math.round((Date.now() - startTime) / 1000)
          this.pollingStatus = `Running… (${elapsed}s)`
          let statusData
          try {
            const { data } = await axios.get(jobStatusUrl)
            statusData = data
          } catch (err) {
            const msg = err.response?.data?.detail || err.response?.data?.message || err.message
            this.executeError = `Polling error: ${msg}`
            return
          }
          const status = statusData.status
          if (status === 'successful') {
            const resultsUrl = extractResultsUrl(statusData.links)
            if (!resultsUrl) {
              this.result = statusData
              this.$emit('executed', { processId: this.selectedProcessId, result: statusData, owsUrl: statusData.ows_url })
              return
            }
            try {
              const { data: resultsData } = await axios.get(resultsUrl)
              this.result = resultsData
              this.$emit('executed', { processId: this.selectedProcessId, result: resultsData, owsUrl: resultsData.ows_url })
            } catch (err) {
              const msg = err.response?.data?.detail || err.response?.data?.message || err.message
              this.executeError = `Failed to fetch results: ${msg}`
            }
            return
          }
          if (FAILURE_STATUSES.has(status)) {
            const detail = statusData.message ? ` — ${statusData.message}` : ''
            this.executeError = `Process job ended with status: ${status}${detail}`
            return
          }
        }
        this.executeError = `Job timed out after ${Math.round(POLL_MAX_RETRIES * POLL_INTERVAL_MS / 1000)}s`
      } finally {
        this.polling = false
        this.pollingStatus = ''
      }
    },
    async execute () {
      this.$refs.processForm?.finalizeActivePicking()
      this.executing = true
      this.result = null
      this.executeError = null
      this._pollingCancelled = false
      try {
        const inputs = this.$refs.processForm?.getFormValues() || this.formValues
        const { data } = await axios.post(
          `${this.baseUrl}/processes/${this.selectedProcessId}/execution`,
          { inputs },
          { headers: { 'Content-Type': 'application/json' } }
        )
        const selfUrl = data.links?.find(l => l.rel === 'self')?.href
          || `${this.baseUrl}/jobs/${data.jobID || data.job_id}`
        if (FAILURE_STATUSES.has(data?.status)) {
          const detail = data.message ? ` — ${data.message}` : ''
          this.executeError = `Process execution failed with status: ${data.status}${detail}`
          return
        }
        this.executing = false
        await this.pollJobStatus(selfUrl)
      } catch (err) {
        const msg = err.response?.data?.detail || err.response?.data?.message || err.message
        this.executeError = msg
        console.error('Process execution failed:', err)
      } finally {
        this.executing = false
      }
    },
    async toggleJsonArtifact (artifact) {
      const id = artifact.output_id
      this.$set(this.expandedArtifacts, id, !this.expandedArtifacts[id])
      if (!this.expandedArtifacts[id] || this.jsonArtifactData[id]) return
      this.$set(this.loadingArtifacts, id, true)
      try {
        const { data } = await axios.get(artifact.download_url)
        this.$set(this.jsonArtifactData, id, data)
      } catch (err) {
        this.$set(this.artifactErrors, id, err.message)
      } finally {
        this.$set(this.loadingArtifacts, id, false)
      }
    },
    formatSize (bytes) {
      if (!bytes) return ''
      if (bytes < 1024) return `${bytes} B`
      if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
      return `${(bytes / 1048576).toFixed(1)} MB`
    },
    clearResult () {
      this.result = null
      this.executeError = null
      this.expandedArtifacts = {}
      this.loadingArtifacts = {}
      this.jsonArtifactData = {}
      this.artifactErrors = {}
    }
  }
}
</script>

<style lang="scss" scoped>
.ogc-processes {
  gap: 12px;
  padding: 8px;

  .actions {
    justify-content: flex-end;
  }
  .result-panel {
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 4px;
    overflow: hidden;
    .result-header {
      padding: 6px 8px;
      background: rgba(0,0,0,0.04);
      border-bottom: 1px solid rgba(0,0,0,0.08);
    }
    .result-body {
      padding: 8px;
      overflow: auto;
      gap: 6px;
    }
    .layer-added {
      gap: 6px;
      font-size: 0.85em;
      color: var(--color-green, #388e3c);
      font-weight: 500;
    }
    .no-artifacts {
      font-size: 0.85em;
      opacity: 0.6;
    }
    .artifacts-list {
      gap: 4px;
    }
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
  }
  .error-panel {
    color: var(--color-red, #d32f2f);
    background: rgba(211, 47, 47, 0.08);
    border-radius: 4px;
    font-size: 0.9em;
  }
  .polling-status {
    font-size: 0.85em;
    opacity: 0.75;
    gap: 4px;
    .polling-text {
      font-variant-numeric: tabular-nums;
    }
  }
}
</style>
