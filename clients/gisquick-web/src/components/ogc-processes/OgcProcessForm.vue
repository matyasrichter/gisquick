<template>
  <div class="ogc-process-form f-col">
    <div v-if="loading" class="f-row-ac p-2">
      <v-spinner size="20"/>
      <span class="mx-2">Loading process description…</span>
    </div>
    <div v-else-if="error" class="error-msg p-2">
      <span>Failed to load process description</span>
      <v-btn class="small outlined" @click="fetchDescription">Retry</v-btn>
    </div>
    <template v-else-if="processDesc">
      <div class="process-header f-col mb-2">
        <h3 class="m-0" v-text="processDesc.title || processDesc.id"/>
        <p v-if="processDesc.description" class="description mt-1" v-text="processDesc.description"/>
      </div>
      <div class="inputs-form f-col">
        <template v-for="(schema, name) in inputSchemas">
          <div :key="name" class="form-field">
            <template v-if="resolveType(schema.schema) === 'boolean'">
              <v-checkbox
                :label="schema.title || name"
                :value="formData[name] || false"
                @input="updateField(name, $event)"
              />
            </template>
            <template v-else-if="schema.schema.enum">
              <v-select
                :label="fieldLabel(schema, name)"
                :items="schema.schema.enum"
                :value="formData[name]"
                :placeholder="fieldPlaceholder(schema)"
                @input="updateField(name, $event)"
              />
            </template>
            <template v-else-if="isNumericType(schema.schema)">
              <v-text-field
                type="number"
                :label="fieldLabel(schema, name)"
                :value="formData[name]"
                :placeholder="fieldPlaceholder(schema)"
                :step="resolveType(schema.schema) === 'integer' ? 1 : 'any'"
                @input="updateField(name, parseNumber($event, resolveType(schema.schema)))"
              />
            </template>
            <template v-else-if="schema.schema.type === 'object'">
              <div class="nested-object f-col">
                <label class="field-label" v-text="fieldLabel(schema, name)"/>
                <div class="nested-fields f-col pl-2">
                  <template v-for="(propSchema, propName) in (schema.schema.properties || {})">
                    <v-text-field
                      :key="propName"
                      :label="propSchema.title || propName"
                      :value="(formData[name] || {})[propName]"
                      :placeholder="propSchema.description || ''"
                      @input="updateNestedField(name, propName, $event)"
                    />
                  </template>
                </div>
              </div>
            </template>
            <template v-else-if="isBboxSchema(schema)">
              <div class="bbox-field f-col">
                <label class="field-label" v-text="fieldLabel(schema, name)"/>
                <div class="bbox-inputs f-row" style="gap: 8px">
                  <v-text-field
                    v-for="(coord, idx) in bboxLabels"
                    :key="idx"
                    type="number"
                    step="any"
                    :label="coord"
                    :value="(formData[name] || [])[idx]"
                    style="flex: 1"
                    @input="updateArrayField(name, idx, parseFloat($event))"
                  />
                </div>
              </div>
            </template>
            <template v-else>
              <v-text-field
                :label="fieldLabel(schema, name)"
                :value="formData[name]"
                :placeholder="fieldPlaceholder(schema)"
                :multiline="schema.schema.contentMediaType === 'application/json'"
                @input="updateField(name, $event)"
              />
            </template>
            <span v-if="schema.description" class="field-description" v-text="schema.description"/>
            <span v-if="isRequired(name)" class="required-mark">required</span>
          </div>
        </template>
      </div>
    </template>
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
    processId: {
      type: String,
      default: null
    },
    value: {
      type: Object,
      default: () => ({})
    }
  },
  data () {
    return {
      processDesc: null,
      loading: false,
      error: null,
      formData: {},
      bboxLabels: ['Min X', 'Min Y', 'Max X', 'Max Y']
    }
  },
  computed: {
    inputSchemas () {
      if (!this.processDesc?.inputs) return {}
      const inputs = this.processDesc.inputs
      const result = {}
      for (const [name, def] of Object.entries(inputs)) {
        result[name] = {
          title: def.title || name,
          description: def.description || '',
          schema: def.schema || {},
          minOccurs: def.minOccurs ?? 0,
          maxOccurs: def.maxOccurs ?? 1
        }
      }
      return result
    },
    requiredInputs () {
      if (!this.processDesc?.inputs) return []
      return Object.entries(this.processDesc.inputs)
        .filter(([, def]) => (def.minOccurs ?? 0) > 0)
        .map(([name]) => name)
    }
  },
  watch: {
    processId: {
      immediate: true,
      handler (id) {
        if (id) {
          this.fetchDescription()
        } else {
          this.processDesc = null
          this.formData = {}
        }
      }
    },
    formData: {
      deep: true,
      handler (data) {
        this.$emit('input', { ...data })
      }
    }
  },
  methods: {
    async fetchDescription () {
      if (!this.processId) return
      this.loading = true
      this.error = null
      try {
        const { data } = await axios.get(`${this.baseUrl}/processes/${this.processId}`)
        this.processDesc = data
        this.initFormData(data)
      } catch (err) {
        this.error = err
        console.error('Failed to fetch process description:', err)
      } finally {
        this.loading = false
      }
    },
    initFormData (desc) {
      const data = {}
      if (desc.inputs) {
        for (const [name, def] of Object.entries(desc.inputs)) {
          const schema = def.schema || {}
          if (schema.default !== undefined) {
            data[name] = schema.default
          } else if (this.resolveType(schema) === 'boolean') {
            data[name] = false
          } else if (this.isBboxInput(def)) {
            data[name] = [null, null, null, null]
          }
        }
      }
      this.formData = data
    },
    updateField (name, value) {
      this.$set(this.formData, name, value)
    },
    updateNestedField (name, propName, value) {
      const obj = { ...(this.formData[name] || {}) }
      obj[propName] = value
      this.$set(this.formData, name, obj)
    },
    updateArrayField (name, index, value) {
      const arr = [...(this.formData[name] || [])]
      arr[index] = value
      this.$set(this.formData, name, arr)
    },
    parseNumber (value, type) {
      if (value === '' || value == null) return null
      return type === 'integer' ? parseInt(value, 10) : parseFloat(value)
    },
    resolveType (schema) {
      if (schema.type) return schema.type
      const candidates = schema.oneOf || schema.anyOf
      if (Array.isArray(candidates)) {
        for (const c of candidates) {
          const t = typeof c === 'string' ? c : c?.type
          if (t) return t
        }
      }
      return 'string'
    },
    isNumericType (schema) {
      const t = this.resolveType(schema)
      return t === 'number' || t === 'integer'
    },
    fieldLabel (schema, name) {
      const label = schema.title || name
      return this.isRequired(name) ? `${label} *` : label
    },
    fieldPlaceholder (schema) {
      return schema.description || ''
    },
    isRequired (name) {
      return this.requiredInputs.includes(name)
    },
    isBboxSchema (inputDef) {
      return this.isBboxInput(inputDef)
    },
    isBboxInput (def) {
      const schema = def.schema || {}
      if (schema.type === 'array' && schema.items?.type === 'number') return true
      if (schema.format === 'bbox') return true
      const name = (def.title || '').toLowerCase()
      return name.includes('bbox') || name.includes('bounding box')
    },
    getFormValues () {
      const values = {}
      for (const [key, val] of Object.entries(this.formData)) {
        if (val !== null && val !== undefined && val !== '') {
          values[key] = val
        }
      }
      return values
    }
  }
}
</script>

<style lang="scss" scoped>
.ogc-process-form {
  .process-header {
    h3 {
      font-size: 1.1em;
    }
    .description {
      font-size: 0.9em;
      opacity: 0.8;
      margin-bottom: 0;
    }
  }
  .inputs-form {
    gap: 8px;
  }
  .form-field {
    position: relative;
  }
  .field-label {
    font-weight: 500;
    font-size: 0.85em;
    margin-bottom: 2px;
  }
  .field-description {
    font-size: 0.8em;
    opacity: 0.65;
    margin-top: 2px;
    display: block;
  }
  .required-mark {
    font-size: 0.75em;
    color: var(--color-red, #d32f2f);
    position: absolute;
    right: 0;
    top: 2px;
  }
  .nested-fields {
    border-left: 2px solid rgba(0,0,0,0.1);
    gap: 4px;
  }
  .error-msg {
    color: var(--color-red, #d32f2f);
    display: flex;
    align-items: center;
    gap: 8px;
  }
}
</style>
