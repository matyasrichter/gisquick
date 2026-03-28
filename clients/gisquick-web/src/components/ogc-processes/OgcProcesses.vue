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
      </div>
      <div v-if="jobStatus" class="job-status f-row-ac mt-2 p-2">
        <v-spinner v-if="polling" size="18" class="mr-2"/>
        <span class="status-badge" :class="jobStatus.status">{{ jobStatus.status }}</span>
        <span v-if="jobStatus.message" class="ml-2 status-msg">{{ jobStatus.message }}</span>
        <span v-if="jobStatus.progress != null" class="ml-2">({{ jobStatus.progress }}%)</span>
      </div>
      <div v-if="result" class="result-panel f-col mt-2">
        <div class="result-header f-row-ac">
          <h4 class="m-0 f-grow">Result</h4>
          <v-btn class="icon small" @click="clearResult">
            <v-icon name="x" size="16"/>
          </v-btn>
        </div>
        <pre class="result-body">{{ artifactContent || formattedResult }}</pre>
        <div v-if="resultArtifacts.length" class="artifact-links f-col">
          <span class="artifact-links-label">Artifacts</span>
          <a
            v-for="(artifact, i) in resultArtifacts"
            :key="i"
            :href="artifact.download_url"
            target="_blank"
            class="artifact-link"
          >{{ artifact.filename }} <span class="artifact-type">({{ artifact.content_type }})</span></a>
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

const POLL_INTERVAL = 2000
const TERMINAL_STATUSES = ['successful', 'failed', 'dismissed', 'completed']

const ARTIFACT_TYPE_PRIORITY = [
  'application/json',
  'text/html',
  'text/plain',
]

function pickBestArtifact (artifacts) {
  for (const type of ARTIFACT_TYPE_PRIORITY) {
    const match = artifacts.find(a => a.content_type === type)
    if (match) return match
  }
  const textArtifact = artifacts.find(a => a.content_type?.startsWith('text/'))
  if (textArtifact) return textArtifact
  return artifacts[0]
}

export default {
  components: { OgcProcessSelect, OgcProcessForm },
  props: {
    baseUrl: {
      type: String,
      default: 'https://developer.ogc.org/api/processes'
    },
    label: {
      type: String,
      default: 'OGC Processes'
    },
    pollInterval: {
      type: Number,
      default: POLL_INTERVAL
    }
  },
  data () {
    return {
      selectedProcessId: null,
      formValues: {},
      executing: false,
      polling: false,
      jobStatus: null,
      result: null,
      artifactContent: null,
      artifactContentType: null,
      executeError: null
    }
  },
  computed: {
    formattedResult () {
      if (!this.result) return ''
      return typeof this.result === 'object'
        ? JSON.stringify(this.result, null, 2)
        : String(this.result)
    },
    resultArtifacts () {
      return this.result?.artifacts || []
    }
  },
  watch: {
    selectedProcessId () {
      this.stopPolling()
      this.clearResult()
    }
  },
  beforeDestroy () {
    this.stopPolling()
  },
  methods: {
    async execute () {
      this.executing = true
      this.result = null
      this.artifactContent = null
      this.artifactContentType = null
      this.executeError = null
      this.jobStatus = null
      this.stopPolling()
      try {
        const inputs = this.$refs.processForm?.getFormValues() || this.formValues
        const body = { inputs }
        const response = await axios.post(
          `${this.baseUrl}/processes/${this.selectedProcessId}/execution`,
          body,
          { headers: { 'Content-Type': 'application/json', Prefer: 'respond-async' } }
        )
        if (response.status === 201 && response.data?.status && !TERMINAL_STATUSES.includes(response.data.status)) {
          // Async job created — start polling
          const jobId = response.data.jobID || response.data.job_id || response.data.id
          const location = response.headers?.location
          this.jobStatus = response.data
          this.startPolling(jobId, location)
        } else {
          // Synchronous result (200) or already complete
          this.result = response.data
          await this.displayArtifacts(response.data?.artifacts)
          this.$emit('executed', { processId: this.selectedProcessId, result: response.data })
        }
      } catch (err) {
        const msg = err.response?.data?.detail || err.response?.data?.message || err.message
        this.executeError = msg
        console.error('Process execution failed:', err)
      } finally {
        this.executing = false
      }
    },
    startPolling (jobId, locationUrl) {
      this.polling = true
      const jobUrl = locationUrl || `${this.baseUrl}/jobs/${jobId}`
      this._pollTimer = setInterval(() => this.pollJob(jobId, jobUrl), this.pollInterval)
    },
    stopPolling () {
      if (this._pollTimer) {
        clearInterval(this._pollTimer)
        this._pollTimer = null
      }
      this.polling = false
    },
    async pollJob (jobId, jobUrl) {
      try {
        const { data } = await axios.get(jobUrl, {
          params: { f: 'json' }
        })
        this.jobStatus = data
        if (TERMINAL_STATUSES.includes(data.status)) {
          this.stopPolling()
          if (data.status === 'successful') {
            await this.fetchResults(jobId)
          } else if (data.status === 'completed') {
            this.result = data
            await this.displayArtifacts(data.artifacts)
            this.$emit('executed', { processId: this.selectedProcessId, jobId, result: data })
          } else {
            this.executeError = data.message || `Job ${data.status}`
          }
        }
      } catch (err) {
        this.stopPolling()
        this.executeError = `Polling failed: ${err.message}`
        console.error('Job polling failed:', err)
      }
    },
    async fetchResults (jobId) {
      try {
        const { data } = await axios.get(`${this.baseUrl}/jobs/${jobId}/results`, {
          params: { f: 'json' }
        })
        this.result = data
        await this.displayArtifacts(data?.artifacts)
        this.$emit('executed', { processId: this.selectedProcessId, jobId, result: data })
      } catch (err) {
        this.executeError = `Failed to fetch results: ${err.message}`
        console.error('Failed to fetch job results:', err)
      }
    },
    async displayArtifacts (artifacts) {
      if (!artifacts?.length) return
      const artifact = pickBestArtifact(artifacts)
      try {
        const { data } = await axios.get(artifact.download_url, { responseType: 'text' })
        let content = data
        if (artifact.content_type === 'application/json') {
          try { content = JSON.stringify(JSON.parse(data), null, 2) } catch { /* keep raw */ }
        }
        this.artifactContent = content
        this.artifactContentType = artifact.content_type
      } catch (err) {
        console.error('Failed to fetch artifact:', err)
      }
    },
    clearResult () {
      this.result = null
      this.artifactContent = null
      this.artifactContentType = null
      this.executeError = null
      this.jobStatus = null
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
  .job-status {
    background: rgba(0,0,0,0.03);
    border-radius: 4px;
    font-size: 0.9em;
    .status-badge {
      font-weight: 600;
      text-transform: capitalize;
      padding: 2px 8px;
      border-radius: 3px;
      font-size: 0.85em;
      &.accepted, &.running { background: rgba(33,150,243,0.15); color: #1976d2; }
      &.successful, &.completed { background: rgba(76,175,80,0.15); color: #388e3c; }
      &.failed, &.dismissed { background: rgba(211,47,47,0.12); color: #d32f2f; }
    }
    .status-msg {
      opacity: 0.75;
    }
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
      margin: 0;
      font-size: 0.85em;
      max-height: 300px;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
    }
    .html-result {
      white-space: normal;
      word-break: normal;
    }
    .artifact-links {
      padding: 6px 8px;
      gap: 4px;
      border-top: 1px solid rgba(0,0,0,0.08);
      background: rgba(0,0,0,0.02);
      .artifact-links-label {
        font-size: 0.78em;
        font-weight: 600;
        text-transform: uppercase;
        opacity: 0.5;
        letter-spacing: 0.04em;
      }
      .artifact-link {
        font-size: 0.85em;
        text-decoration: none;
        color: var(--color-primary, #1976d2);
        &:hover { text-decoration: underline; }
      }
      .artifact-type {
        opacity: 0.6;
        font-size: 0.9em;
      }
    }
  }
  .error-panel {
    color: var(--color-red, #d32f2f);
    background: rgba(211, 47, 47, 0.08);
    border-radius: 4px;
    font-size: 0.9em;
  }
}
</style>
