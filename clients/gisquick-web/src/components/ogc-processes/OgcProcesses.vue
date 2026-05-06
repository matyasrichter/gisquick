<template>
  <div class="ogc-processes f-col">
    <ogc-process-select
      :base-url="baseUrl"
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
          <div v-if="result.ows_url" class="layer-added f-col">
            <div class="f-row-ac">
              <v-icon name="layers" size="14" class="mr-1"/>
              <span>Spatial layer added to map</span>
            </div>
            <button class="layers-tab-link" @click="$emit('switch-to-layers')">
              View in Layers tab →
            </button>
          </div>
          <span
            v-if="!result.ows_url && (!result.artifacts || !result.artifacts.length)"
            class="no-artifacts"
          >
            Process completed with no file outputs.
          </span>
          <result-artifacts-list
            v-if="result.artifacts && result.artifacts.length"
            :artifacts="result.artifacts"
          />
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
import ResultArtifactsList from './ResultArtifactsList.vue'
import { extractResultsUrl, sleep } from './utils'
import { POLL_INTERVAL_MS, POLL_MAX_RETRIES, FAILURE_STATUSES } from './schema'

export default {
  components: { OgcProcessSelect, OgcProcessForm, ResultArtifactsList },
  props: {
    baseUrl: {
      type: String,
      default: 'https://developer.ogc.org/api/processes'
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
      pollingStatus: ''
    }
  },
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
      if (this.$refs.processForm && !this.$refs.processForm.validate()) return
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

    clearResult () {
      this.result = null
      this.executeError = null
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
      gap: 4px;
      font-size: 0.85em;
      color: var(--color-green, #388e3c);
      font-weight: 500;
      .layers-tab-link {
        all: unset;
        cursor: pointer;
        font-size: 0.95em;
        color: var(--color-primary);
        text-decoration: underline;
        &:hover {
          opacity: 0.8;
        }
      }
    }
    .no-artifacts {
      font-size: 0.85em;
      opacity: 0.6;
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
