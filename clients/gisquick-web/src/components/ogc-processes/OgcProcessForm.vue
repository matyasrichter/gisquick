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
      <div v-if="activePickerField" class="picking-hint f-row-ac p-2 mb-1">
        <v-icon name="point" size="16" class="mr-1"/>
        <span>{{ pickingHintText }}</span>
        <v-btn class="small flat ml-auto" @click="stopPicking">Cancel</v-btn>
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
            <template v-else-if="isGeometryInput(schema)">
              <div class="geometry-field f-col">
                <label class="field-label" v-text="fieldLabel(schema, name)"/>
                <div class="geometry-pick-row f-row-ac" style="gap: 8px">
                  <v-btn
                    class="small"
                    :color="activePickerField === name ? 'orange' : 'primary'"
                    @click="activePickerField === name ? stopPicking() : startPicking(name, schema)"
                  >
                    {{ activePickerField === name ? 'Cancel' : (formData[name] ? 'Reselect from map' : 'Select from map') }}
                  </v-btn>
                  <span v-if="formData[name] && activePickerField !== name" class="geometry-summary">
                    {{ geometrySummary(formData[name]) }}
                  </span>
                  <v-btn
                    v-if="formData[name]"
                    class="icon small flat"
                    @click="clearGeometry(name)"
                  >
                    <v-icon name="x" size="14"/>
                  </v-btn>
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
import Draw from 'ol/interaction/Draw'
import VectorSource from 'ol/source/Vector'
import OlVectorLayer from 'ol/layer/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import WKT from 'ol/format/WKT'

const GEOMETRY_FORMATS = ['geojson', 'wkt', 'ewkt', 'wkb', 'ewkb']
const WKT_FORMATS = ['wkt', 'ewkt', 'wkb', 'ewkb']
const GEOMETRY_TYPE_RE = /Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon|Geometry/i

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
      bboxLabels: ['Min X', 'Min Y', 'Max X', 'Max Y'],
      activePickerField: null,
      _draw: null,
      _drawLayer: null,
      _pickerDef: null
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
    },
    pickingHintText () {
      if (!this.activePickerField || !this._pickerDef) return ''
      const olType = this.getOlGeometryType(this._pickerDef)
      if (olType === 'Point' || olType === 'MultiPoint') {
        return 'Click on the map to place a point'
      }
      if (olType === 'Polygon' || olType === 'MultiPolygon') {
        return 'Click to add vertices, double-click to finish the polygon'
      }
      if (olType === 'LineString' || olType === 'MultiLineString') {
        return 'Click to add points, double-click to finish the line'
      }
      return 'Click on the map to select a geometry'
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
  beforeDestroy () {
    this._cleanupPicker(true)
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
    isGeometryInput (def) {
      const schema = def.schema || {}
      if (GEOMETRY_FORMATS.includes(schema.format)) return true
      if (schema.contentMediaType === 'application/geo+json') return true
      if (schema.$ref && GEOMETRY_TYPE_RE.test(schema.$ref)) return true
      const text = ((def.title || '') + ' ' + (def.description || '')).toLowerCase()
      return /\b(geometry|point|polygon|linestring|line string)\b/.test(text)
    },
    getOlGeometryType (def) {
      const schema = def.schema || {}
      if (schema.$ref) {
        const m = schema.$ref.match(GEOMETRY_TYPE_RE)
        if (m) return m[0]
      }
      const text = ((def.title || '') + ' ' + (def.description || '')).toLowerCase()
      if (/\bmultipolygon\b/.test(text)) return 'MultiPolygon'
      if (/\bmultilinestring\b/.test(text)) return 'MultiLineString'
      if (/\bmultipoint\b/.test(text)) return 'MultiPoint'
      if (/\bpolygon\b/.test(text)) return 'Polygon'
      if (/\b(linestring|line string)\b/.test(text)) return 'LineString'
      if (/\bpoint\b/.test(text)) return 'Point'
      return 'Point'
    },
    getOutputFormat (def) {
      const schema = def.schema || {}
      return WKT_FORMATS.includes(schema.format) ? 'wkt' : 'geojson'
    },
    startPicking (name, def) {
      this._cleanupPicker(false)
      this.activePickerField = name
      this._pickerDef = def

      const source = new VectorSource()
      const layer = new OlVectorLayer({ source, zIndex: 999 })
      this.$map.addLayer(layer)
      this._drawLayer = layer

      const olType = this.getOlGeometryType(def)
      const draw = new Draw({ source, type: olType })
      draw.on('drawend', evt => {
        const mapProj = this.$map.getView().getProjection()
        const geom = evt.feature.getGeometry()
        const outputFormat = this.getOutputFormat(def)
        let value
        if (outputFormat === 'wkt') {
          value = new WKT().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: mapProj })
        } else {
          value = JSON.parse(new GeoJSON().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: mapProj }))
        }
        this.$set(this.formData, name, value)
        this._stopInteraction()
      })

      this.$map.addInteraction(draw)
      this._draw = draw
      this.$map.getViewport().style.cursor = 'crosshair'
    },
    _stopInteraction () {
      if (this._draw) {
        this.$map.removeInteraction(this._draw)
        this._draw = null
      }
      this.activePickerField = null
      this._pickerDef = null
      this.$map.getViewport().style.cursor = ''
    },
    stopPicking () {
      // Remove draw layer if no geometry was captured for this field
      const field = this.activePickerField
      this._stopInteraction()
      if (field && !this.formData[field] && this._drawLayer) {
        this.$map.removeLayer(this._drawLayer)
        this._drawLayer = null
      }
    },
    _cleanupPicker (removeLayer) {
      if (this._draw) {
        this.$map.removeInteraction(this._draw)
        this._draw = null
      }
      if (removeLayer && this._drawLayer) {
        this.$map.removeLayer(this._drawLayer)
        this._drawLayer = null
      }
      this.activePickerField = null
      this._pickerDef = null
      if (this.$map) {
        this.$map.getViewport().style.cursor = ''
      }
    },
    clearGeometry (name) {
      this.$set(this.formData, name, null)
      if (this._drawLayer) {
        this.$map.removeLayer(this._drawLayer)
        this._drawLayer = null
      }
    },
    geometrySummary (value) {
      if (!value) return ''
      if (typeof value === 'string') {
        // WKT: truncate for display
        return value.length > 60 ? value.slice(0, 57) + '…' : value
      }
      if (typeof value === 'object' && value.type) {
        const type = value.type
        const coords = value.coordinates
        if (type === 'Point' && Array.isArray(coords)) {
          return `Point [${coords.map(c => c.toFixed(5)).join(', ')}]`
        }
        if (type === 'LineString' && Array.isArray(coords)) {
          return `LineString (${coords.length} points)`
        }
        if (type === 'Polygon' && Array.isArray(coords)) {
          return `Polygon (${(coords[0] || []).length} vertices)`
        }
        if (type.startsWith('Multi') && Array.isArray(coords)) {
          return `${type} (${coords.length} parts)`
        }
        return type
      }
      return 'Geometry selected'
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
  .picking-hint {
    background: rgba(33, 150, 243, 0.1);
    border: 1px solid rgba(33, 150, 243, 0.35);
    border-radius: 4px;
    font-size: 0.85em;
    color: #1565c0;
    gap: 6px;
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
  .geometry-field {
    gap: 4px;
  }
  .geometry-pick-row {
    flex-wrap: wrap;
  }
  .geometry-summary {
    font-size: 0.8em;
    font-family: monospace;
    opacity: 0.75;
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
