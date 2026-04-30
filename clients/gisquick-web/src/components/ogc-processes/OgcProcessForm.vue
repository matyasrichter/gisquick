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
        <span class="f-grow">{{ pickingHintText }}</span>
        <v-btn class="small flat ml-2" @click="stopPicking">Cancel</v-btn>
      </div>
      <div class="inputs-form f-col">
        <template v-for="(schema, name) in inputSchemas">
          <div :key="name" class="form-field">

            <!-- Boolean -->
            <template v-if="resolveType(schema.schema) === 'boolean'">
              <v-checkbox
                :label="schema.title || name"
                :value="formData[name] || false"
                @input="updateField(name, $event)"
              />
            </template>

            <!-- Enum -->
            <template v-else-if="schema.schema.enum">
              <v-select
                :label="fieldLabel(schema, name)"
                :items="schema.schema.enum"
                :value="formData[name]"
                :placeholder="fieldPlaceholder(schema)"
                @input="updateField(name, $event)"
              />
            </template>

            <!-- Numeric -->
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

            <!-- Geometry -->
            <template v-else-if="isGeometryInput(schema)">
              <geometry-input-field
                :field-name="name"
                :label="fieldLabel(schema, name)"
                :value="formData[name]"
                :pick-type="pickTypes[name] || 'feature'"
                :active-picker-field="activePickerField"
                :active-picker-mode="activePickerMode"
                :multi-pick-mode="multiPickMode"
                :multi-picked-features="multiPickedFeatures"
                :pending-features="pendingFeatures"
                :queryable-layers="queryableLayers"
                :fetching-layer="fetchingLayer"
                :layer-features-open="!!layerFeaturesOpen[name]"
                :layer-picker-selected-index="layerPickerSelectedIndex[name] || null"
                :draw-geom-type="drawGeomTypes[name] || 'Polygon'"
                :draw-geom-type-options="drawGeomTypeOptionsFor(name)"
                @set-pick-type="setPickType(name, $event)"
                @set-draw-geom-type="setDrawGeomType(name, $event)"
                @toggle-picking="togglePicking(name, schema)"
                @finalize-multi-pick="finalizeMultiPick(name)"
                @remove-picked-feature="removePickedFeature($event, name)"
                @apply-pending-feature="applyPendingFeature(name, schema, $event)"
                @add-to-multi-pick="_addToMultiPick(name, $event)"
                @click-layer-feature="clickLayerFeature(name, $event)"
                @remove-layer-feature="removeLayerFeature(name, $event)"
                @fetch-layer-features="fetchLayerFeatures(name, schema, $event)"
                @toggle-layer-features-open="$set(layerFeaturesOpen, name, !layerFeaturesOpen[name])"
                @clear="clearGeometry(name)"
              />
            </template>

            <!-- Bounding box -->
            <template v-else-if="isBboxInput(schema)">
              <bbox-input-field
                :label="fieldLabel(schema, name)"
                :value="formData[name]"
                :picking="activePickerField === name && activePickerMode === 'bbox'"
                @start-pick="startBboxPick(name)"
                @stop-pick="stopPicking()"
                @use-view-extent="useViewExtent(name)"
                @clear="clearBbox(name)"
                @input="updateField(name, $event)"
              />
            </template>

            <!-- Nested object -->
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

            <!-- String / default -->
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
import { mapState } from 'vuex'
import axios from 'axios'
import GeoJSON from 'ol/format/GeoJSON'
import GML3 from 'ol/format/GML3'
import WKT from 'ol/format/WKT'
import PickingMixin from './PickingMixin'
import GeometryInputField from './GeometryInputField.vue'
import BboxInputField from './BboxInputField.vue'
import { resolveType, isNumericType, isGeometryInput, isBboxInput, getOutputFormat } from './schema'

export default {
  components: { GeometryInputField, BboxInputField },
  mixins: [PickingMixin],
  props: {
    baseUrl: { type: String, required: true },
    processId: { type: String, default: null },
    value: { type: Object, default: () => ({}) }
  },
  data () {
    return {
      processDesc: null,
      loading: false,
      error: null,
      formData: {}
    }
  },
  computed: {
    ...mapState(['project', 'resultLayers']),
    inputSchemas () {
      if (!this.processDesc?.inputs) return {}
      const result = {}
      for (const [name, def] of Object.entries(this.processDesc.inputs)) {
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
    resultPickableLayers () {
      return (this.resultLayers || [])
        .filter(l => l.type === 'wfs')
        .map(l => ({ name: l.id, title: l.name, isResultLayer: true }))
    },
    queryableLayers () {
      const base = (this.project?.overlays?.list || []).filter(l => l.queryable && !l.hidden)
      return [...base, ...this.resultPickableLayers]
    },
    pickingHintText () {
      if (!this.activePickerField) return ''
      const field = this.activePickerField
      const hasExisting = this.hasValue(field)
      if (this.activePickerMode === 'select') {
        if (this.multiPickMode) {
          return `Click features to add to selection (${this.multiPickedFeatures.length} so far) — press Esc to cancel`
        }
        return hasExisting
          ? 'Click a feature to replace the current selection — press Esc to keep it'
          : 'Click a map feature to use its geometry — press Esc to cancel'
      }
      if (this.activePickerMode === 'bbox') {
        return 'Click and drag to draw a bounding box — press Esc to cancel'
      }
      if (this.activePickerMode === 'draw') {
        const t = this.drawGeomTypes[field]
        return t === 'Point'
          ? 'Click on the map to place a point — press Esc to cancel'
          : 'Click to add vertices, double-click to finish — press Esc to cancel'
      }
      return ''
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
          this.pickTypes = {}
          this.drawGeomTypes = {}
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
    resolveType,
    isNumericType,
    isGeometryInput,
    isBboxInput,

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
          } else if (resolveType(schema) === 'boolean') {
            data[name] = false
          } else if (isBboxInput(def)) {
            data[name] = [null, null, null, null]
          }
        }
      }
      this.formData = data
    },

    updateField (name, value) { this.$set(this.formData, name, value) },
    updateNestedField (name, propName, value) {
      this.$set(this.formData, name, { ...(this.formData[name] || {}), [propName]: value })
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
    hasValue (name) {
      const v = this.formData[name]
      return Array.isArray(v) ? v.some(x => x !== null) : !!v
    },
    fieldLabel (schema, name) {
      const label = schema.title || name
      return this.isRequired(name) ? `${label} *` : label
    },
    fieldPlaceholder (schema) { return schema.description || '' },
    isRequired (name) { return this.requiredInputs.includes(name) },

    _serializeInput (value, def) {
      if (value === null || value === undefined) return value
      const fmt = getOutputFormat(def)
      if (fmt === 'geojson') return value

      if (value.type === 'FeatureCollection') {
        const features = new GeoJSON().readFeatures(value, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:4326' })
        if (fmt === 'gml') return new GML3().writeFeatures(features, { featureType: 'feature', featureNS: 'http://www.opengis.net/gml' })
        return value
      }

      if (value.type) {
        const geom = new GeoJSON().readGeometry(value, { dataProjection: 'EPSG:4326', featureProjection: 'EPSG:4326' })
        if (fmt === 'gml') return new GML3().writeGeometry(geom)
        if (fmt === 'wkt') return new WKT().writeGeometry(geom)
      }

      return value
    },

    getFormValues () {
      const values = {}
      for (const [key, val] of Object.entries(this.formData)) {
        if (val !== null && val !== undefined && val !== '') {
          const def = this.inputSchemas[key]
          values[key] = def ? this._serializeInput(val, def) : val
        }
      }
      return values
    }
  }
}
</script>

<style lang="scss" scoped>
.ogc-process-form {
  overflow: hidden;
  min-width: 0;

  .process-header {
    h3 { font-size: 1.1em }
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
  .inputs-form { gap: 8px }
  .form-field { position: relative }
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
