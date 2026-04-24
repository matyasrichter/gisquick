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
              <div class="geometry-field f-col">
                <label class="field-label" v-text="fieldLabel(schema, name)"/>

                <!-- Type selector + action row -->
                <div class="geometry-controls f-row-ac" style="gap: 6px">
                  <v-select
                    class="pick-type-select f-grow"
                    label="Input type"
                    :items="pickTypeOptions"
                    :value="pickTypes[name] || 'feature'"
                    @input="setPickType(name, $event)"
                  />
                  <!-- Action button — hidden for layer type -->
                  <v-btn
                    v-if="(pickTypes[name] || 'feature') !== 'layer'"
                    class="small"
                    :color="actionBtnColor(name)"
                    @click="togglePicking(name, schema)"
                  >
                    {{ actionBtnLabel(name) }}
                  </v-btn>
                  <!-- Clear -->
                  <v-btn
                    v-if="formData[name]"
                    class="icon small flat"
                    @click="clearGeometry(name)"
                  >
                    <v-icon name="x" size="14"/>
                  </v-btn>
                </div>

                <!-- Layer picker (shown when type = 'layer') -->
                <div v-if="(pickTypes[name] || 'feature') === 'layer'" class="layer-picker f-col mt-1">
                  <v-select
                    label="Layer"
                    :items="queryableLayers"
                    item-text="title"
                    item-value="name"
                    :value="selectedLayerName"
                    placeholder="Select a layer…"
                    @input="selectedLayerName = $event"
                  />
                  <v-btn
                    class="small mt-1"
                    color="primary"
                    :loading="fetchingLayer"
                    :disabled="!selectedLayerName || fetchingLayer"
                    @click="fetchLayerFeatures(name, schema, selectedLayerName)"
                  >
                    Use layer
                  </v-btn>
                </div>

                <!-- Multi-pick accumulation list -->
                <div
                  v-if="activePickerField === name && multiPickedFeatures.length > 0"
                  class="multi-pick-list f-col mt-1"
                >
                  <div class="multi-pick-header f-row-ac">
                    <span class="multi-pick-count">
                      {{ multiPickedFeatures.length }} feature{{ multiPickedFeatures.length !== 1 ? 's' : '' }} selected
                    </span>
                    <v-btn class="small ml-auto" color="primary" @click="finalizeMultiPick(name)">Done</v-btn>
                  </div>
                  <div
                    v-for="(feat, i) in multiPickedFeatures"
                    :key="i"
                    class="multi-pick-item f-row-ac"
                  >
                    <span class="f-grow">{{ featureLabel(feat) }}</span>
                    <v-btn class="icon small flat" @click="removePickedFeature(i, name)">
                      <v-icon name="x" size="12"/>
                    </v-btn>
                  </div>
                </div>

                <!-- Value summary -->
                <div
                  v-else-if="formData[name] && activePickerField !== name"
                  class="geometry-summary-row f-row-ac mt-1"
                  style="min-width: 0"
                >
                  <span class="geometry-summary">{{ geometrySummary(formData[name]) }}</span>
                </div>

                <!-- Feature disambiguation list -->
                <div
                  v-if="activePickerField === name && pendingFeatures.length > 1"
                  class="feature-picker f-col mt-1"
                >
                  <span class="feature-picker-hint">Multiple features found — click one to use it:</span>
                  <div
                    v-for="(feat, i) in pendingFeatures"
                    :key="i"
                    class="feature-picker-item"
                    @click="multiPickMode ? _addToMultiPick(name, feat) : applyPendingFeature(name, schema, feat)"
                  >
                    {{ featureLabel(feat) }}
                  </div>
                </div>
              </div>
            </template>

            <!-- Bounding box -->
            <template v-else-if="isBboxSchema(schema)">
              <div class="bbox-field f-col">
                <label class="field-label" v-text="fieldLabel(schema, name)"/>
                <div class="bbox-pick-row f-row-ac mb-1" style="gap: 6px; flex-wrap: wrap">
                  <v-btn
                    class="small"
                    :color="activePickerField === name && activePickerMode === 'bbox' ? 'orange' : 'primary'"
                    @click="activePickerField === name && activePickerMode === 'bbox' ? stopPicking() : startBboxPick(name)"
                  >
                    {{ activePickerField === name && activePickerMode === 'bbox' ? 'Cancel' : 'Pick on map' }}
                  </v-btn>
                  <v-btn class="small outlined" @click="useViewExtent(name)">Use view</v-btn>
                  <v-btn
                    v-if="formData[name] && formData[name].some(v => v !== null)"
                    class="icon small flat"
                    @click="clearBbox(name)"
                  >
                    <v-icon name="x" size="14"/>
                  </v-btn>
                </div>
                <div class="bbox-inputs">
                  <v-text-field
                    v-for="(coord, idx) in bboxLabels"
                    :key="idx"
                    type="number"
                    step="any"
                    :label="coord"
                    :value="(formData[name] || [])[idx]"
                    @input="updateArrayField(name, idx, parseFloat($event))"
                  />
                </div>
              </div>
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
import Draw, { createBox } from 'ol/interaction/Draw'
import VectorSource from 'ol/source/Vector'
import OlVectorLayer from 'ol/layer/Vector'
import GeoJSON from 'ol/format/GeoJSON'
import WKT from 'ol/format/WKT'
import Circle from 'ol/geom/Circle'
import { fromCircle, fromExtent as polygonFromExtent } from 'ol/geom/Polygon'
import { unByKey } from 'ol/Observable'
import { layersFeaturesQuery, layerFeaturesQuery } from '@/map/featureinfo'

const GEOMETRY_FORMATS = ['geojson', 'wkt', 'ewkt', 'wkb', 'ewkb']
const WKT_FORMATS = ['wkt', 'ewkt', 'wkb', 'ewkb']
const GEOMETRY_TYPE_RE = /Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon|Geometry/i

export default {
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
      formData: {},
      bboxLabels: ['Min X', 'Min Y', 'Max X', 'Max Y'],
      // per-field pick type: 'feature' | 'multi' | 'layer'
      pickTypes: {},
      activePickerField: null,
      activePickerMode: null,
      pendingFeatures: [],
      multiPickMode: false,
      multiPickedFeatures: [],
      selectedLayerName: null,
      fetchingLayer: false
    }
  },
  created () {
    // Non-reactive OL interaction handles — not in data() to avoid Vue reserved-key warning
    this._draw = null
    this._drawLayer = null
    this._pickerDef = null
    this._selectKey = null
    this._escapeUnbind = null
  },
  computed: {
    ...mapState(['project']),
    pickTypeOptions () {
      return [
        { value: 'feature', text: 'Feature' },
        { value: 'multi',   text: 'Multiple features' },
        { value: 'layer',   text: 'Entire layer' }
      ]
    },
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
    queryableLayers () {
      return (this.project?.overlays?.list || []).filter(l => l.queryable && !l.hidden)
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
    // ── Pick type dropdown ────────────────────────────────────────────────
    setPickType (name, type) {
      if (this.activePickerField === name) this.stopPicking()
      this.$set(this.pickTypes, name, type)
      if (type !== 'layer') {
        this.selectedLayerName = null
        this.togglePicking(name, this.inputSchemas[name])
      }
    },

    actionBtnLabel (name) {
      if (this.activePickerField === name) {
        if (this.multiPickMode && this.multiPickedFeatures.length > 0) return 'Done'
        return 'Cancel'
      }
      const type = this.pickTypes[name] || 'feature'
      if (type === 'feature') return this.hasValue(name) ? 'Update' : 'Pick'
      if (type === 'multi')   return this.hasValue(name) ? 'Add more' : 'Pick'
      return 'Pick'
    },

    actionBtnColor (name) {
      if (this.activePickerField === name) {
        return this.multiPickMode && this.multiPickedFeatures.length > 0 ? 'primary' : 'orange'
      }
      return 'primary'
    },

    togglePicking (name, def) {
      if (this.activePickerField === name) {
        if (this.multiPickMode && this.multiPickedFeatures.length > 0) {
          this.finalizeMultiPick(name)
        } else {
          this.stopPicking()
        }
        return
      }
      const type = this.pickTypes[name] || 'feature'
      if (type === 'feature') {
        this.startFeatureSelect(name, def)
      } else if (type === 'multi') {
        // Don't clear multiPickedFeatures here — it is already empty after Done/Cancel
        this.startFeatureSelect(name, def)
        this.multiPickMode = true  // must be set AFTER startFeatureSelect (_cleanupPicker resets it)
      }
    },

    // ── Form helpers ──────────────────────────────────────────────────────
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
    isBboxSchema (inputDef) { return this.isBboxInput(inputDef) },
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

    // ── Escape key ────────────────────────────────────────────────────────
    _setupEscapeListener () {
      if (this._escapeUnbind) return
      const handler = e => {
        if (e.key !== 'Escape') return
        const tag = document.activeElement?.tagName?.toLowerCase()
        const type = document.activeElement?.type?.toLowerCase()
        const isTextInput = (tag === 'input' && ['text', 'number', 'email', 'search', 'url', 'tel', 'password'].includes(type))
          || tag === 'textarea'
        if (isTextInput) return
        if (this.activePickerField) this.stopPicking()
      }
      document.addEventListener('keydown', handler)
      this._escapeUnbind = () => document.removeEventListener('keydown', handler)
    },

    _stopDrawInteraction () {
      if (this._draw) { this.$map.removeInteraction(this._draw); this._draw = null }
      this.activePickerField = null
      this.activePickerMode = null
      this._pickerDef = null
      this.$map.getViewport().style.cursor = ''
      if (this._escapeUnbind) { this._escapeUnbind(); this._escapeUnbind = null }
    },

    // ── Feature select (single & multi) ───────────────────────────────────
    startFeatureSelect (name, def) {
      this._cleanupPicker(false)
      this.activePickerField = name
      this.activePickerMode = 'select'
      this._pickerDef = def
      this.pendingFeatures = []
      this.$map.getViewport().style.cursor = 'crosshair'
      this._selectKey = this.$map.on('singleclick', evt => this._onMapClick(evt, name, def))
      this._setupEscapeListener()
    },
    async _onMapClick (evt, name, def) {
      const { map, pixel, coordinate } = evt
      const mapProj = map.getView().getProjection().getCode()
      const wfsLayers = this.project.overlays.list.filter(l => l.queryable && l.visible && !l.hidden && l.attributes)
      if (!wfsLayers.length) return

      const pixelRadius = 8
      const radius = Math.abs(map.getCoordinateFromPixel([pixel[0] + pixelRadius, pixel[1]])[0] - coordinate[0])
      const geomFilter = { geom: fromCircle(new Circle(coordinate, radius), 6), projection: mapProj }
      const query = layersFeaturesQuery(wfsLayers, { geomFilter })
      try {
        const config = {
          params: { VERSION: '1.1.0', SERVICE: 'WFS', REQUEST: 'GetFeature', OUTPUTFORMAT: 'GeoJSON', MAXFEATURES: 10 },
          headers: { 'Content-Type': 'text/xml' }
        }
        const { data } = await this.$http.post(this.project.config.ows_url, query, config)
        const features = new GeoJSON().readFeatures(data, { featureProjection: mapProj })
        if (!features.length) return
        if (this.multiPickMode) {
          if (features.length === 1) {
            this._addToMultiPick(name, features[0])
          } else {
            this.pendingFeatures = features
          }
        } else {
          if (features.length === 1) {
            this.applyPendingFeature(name, def, features[0])
          } else {
            this.pendingFeatures = features
          }
        }
      } catch (e) {
        console.error('Feature query failed', e)
      }
    },
    _addToMultiPick (name, feature) {
      this.multiPickedFeatures = [...this.multiPickedFeatures, feature]
      this.pendingFeatures = []
      if (!this._drawLayer) {
        const source = new VectorSource()
        const layer = new OlVectorLayer({ source, zIndex: 999 })
        this.$map.addLayer(layer)
        this._drawLayer = layer
      }
      this._drawLayer.getSource().clear()
      this.multiPickedFeatures.forEach(f => this._drawLayer.getSource().addFeature(f.clone()))
    },
    applyPendingFeature (name, def, feature) {
      const mapProj = this.$map.getView().getProjection()
      const geom = feature.getGeometry()
      const fmt = this.getOutputFormat(def)
      const value = fmt === 'wkt'
        ? new WKT().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: mapProj })
        : JSON.parse(new GeoJSON().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: mapProj }))
      if (!this._drawLayer) {
        const source = new VectorSource()
        const layer = new OlVectorLayer({ source, zIndex: 999 })
        this.$map.addLayer(layer)
        this._drawLayer = layer
      }
      this._drawLayer.getSource().clear()
      this._drawLayer.getSource().addFeature(feature.clone())
      this.$set(this.formData, name, value)
      this._stopSelectInteraction()
      this.pendingFeatures = []
    },
    finalizeMultiPick (name) {
      if (!this.multiPickedFeatures.length) return
      const mapProj = this.$map.getView().getProjection()
      const fmt = new GeoJSON()
      const newFeatures = this.multiPickedFeatures.map(f => ({
        type: 'Feature',
        geometry: JSON.parse(fmt.writeGeometry(f.getGeometry(), { dataProjection: 'EPSG:4326', featureProjection: mapProj })),
        properties: f.getProperties()
      }))
      // Merge with existing FeatureCollection so "Add more" truly appends
      const existing = this.formData[name]
      const prior = existing?.type === 'FeatureCollection' ? (existing.features || []) : []
      this.$set(this.formData, name, { type: 'FeatureCollection', features: [...prior, ...newFeatures] })
      this._stopSelectInteraction()
      this.pendingFeatures = []
      this.multiPickedFeatures = []
      this.multiPickMode = false
    },
    removePickedFeature (index, name) {
      const updated = this.multiPickedFeatures.filter((_, i) => i !== index)
      this.multiPickedFeatures = updated
      if (this._drawLayer) {
        this._drawLayer.getSource().clear()
        updated.forEach(f => this._drawLayer.getSource().addFeature(f.clone()))
      }
      if (updated.length === 0) {
        this.$set(this.formData, name, null)
      } else {
        const mapProj = this.$map.getView().getProjection()
        const fmt = new GeoJSON()
        const features = updated.map(f => ({
          type: 'Feature',
          geometry: JSON.parse(fmt.writeGeometry(f.getGeometry(), { dataProjection: 'EPSG:4326', featureProjection: mapProj })),
          properties: f.getProperties()
        }))
        this.$set(this.formData, name, { type: 'FeatureCollection', features })
      }
    },
    _stopSelectInteraction () {
      if (this._selectKey) { unByKey(this._selectKey); this._selectKey = null }
      this.activePickerField = null
      this.activePickerMode = null
      this._pickerDef = null
      this.$map.getViewport().style.cursor = ''
      if (this._escapeUnbind) { this._escapeUnbind(); this._escapeUnbind = null }
    },

    // ── Layer fetch ───────────────────────────────────────────────────────
    async fetchLayerFeatures (name, def, layerName) {
      const layer = this.queryableLayers.find(l => l.name === layerName)
      if (!layer) return
      this.fetchingLayer = true
      try {
        const mapProj = this.$map.getView().getProjection().getCode()
        const query = layerFeaturesQuery(layer, {})
        const config = {
          params: { VERSION: '1.1.0', SERVICE: 'WFS', REQUEST: 'GetFeature', OUTPUTFORMAT: 'GeoJSON', MAXFEATURES: 500 },
          headers: { 'Content-Type': 'text/xml' }
        }
        const { data } = await this.$http.post(this.project.config.ows_url, query, config)
        const features = new GeoJSON().readFeatures(data, { featureProjection: mapProj })
        if (!features.length) return
        const fmt = new GeoJSON()
        const featureList = features.map(f => ({
          type: 'Feature',
          geometry: JSON.parse(fmt.writeGeometry(f.getGeometry(), { dataProjection: 'EPSG:4326', featureProjection: mapProj })),
          properties: f.getProperties()
        }))
        this.$set(this.formData, name, { type: 'FeatureCollection', features: featureList })
        if (!this._drawLayer) {
          const source = new VectorSource()
          const olLayer = new OlVectorLayer({ source, zIndex: 999 })
          this.$map.addLayer(olLayer)
          this._drawLayer = olLayer
        }
        this._drawLayer.getSource().clear()
        features.forEach(f => this._drawLayer.getSource().addFeature(f.clone()))
        this.selectedLayerName = null
      } catch (e) {
        console.error('Layer features fetch failed', e)
      } finally {
        this.fetchingLayer = false
      }
    },

    // ── Bbox pick ─────────────────────────────────────────────────────────
    startBboxPick (name) {
      this._cleanupPicker(true)
      this.activePickerField = name
      this.activePickerMode = 'bbox'

      const source = new VectorSource()
      const layer = new OlVectorLayer({ source, zIndex: 999 })
      this.$map.addLayer(layer)
      this._drawLayer = layer

      const draw = new Draw({ source, type: 'Circle', geometryFunction: createBox() })
      draw.on('drawend', evt => {
        const mapProj = this.$map.getView().getProjection()
        const extent = evt.feature.getGeometry().clone().transform(mapProj, 'EPSG:4326').getExtent()
        this.$set(this.formData, name, extent.map(v => parseFloat(v.toFixed(7))))
        this._stopDrawInteraction()
      })
      this.$map.addInteraction(draw)
      this._draw = draw
      this.$map.getViewport().style.cursor = 'crosshair'
      this._setupEscapeListener()
    },
    useViewExtent (name) {
      const mapProj = this.$map.getView().getProjection()
      const extent = this.$map.getView().calculateExtent(this.$map.getSize())
      const poly = polygonFromExtent(extent)
      poly.transform(mapProj, 'EPSG:4326')
      const e = poly.getExtent()
      this.$set(this.formData, name, e.map(v => parseFloat(v.toFixed(7))))
    },
    clearBbox (name) {
      this.$set(this.formData, name, [null, null, null, null])
      if (this._drawLayer) { this.$map.removeLayer(this._drawLayer); this._drawLayer = null }
    },
    clearGeometry (name) {
      this.$set(this.formData, name, null)
      if (this._drawLayer) { this.$map.removeLayer(this._drawLayer); this._drawLayer = null }
    },

    // ── Picker lifecycle ──────────────────────────────────────────────────
    stopPicking () {
      const mode = this.activePickerMode
      if (mode === 'select') {
        this._stopSelectInteraction()
      } else {
        const field = this.activePickerField
        const val = field && this.formData[field]
        const hadGeom = Array.isArray(val) ? val.some(v => v !== null) : !!val
        this._stopDrawInteraction()
        if (!hadGeom && this._drawLayer) {
          this.$map.removeLayer(this._drawLayer)
          this._drawLayer = null
        }
      }
      this.pendingFeatures = []
      this.multiPickMode = false
      this.multiPickedFeatures = []
    },
    _cleanupPicker (removeLayer) {
      if (this._draw) { this.$map.removeInteraction(this._draw); this._draw = null }
      if (this._selectKey) { unByKey(this._selectKey); this._selectKey = null }
      if (removeLayer && this._drawLayer) { this.$map.removeLayer(this._drawLayer); this._drawLayer = null }
      this.activePickerField = null
      this.activePickerMode = null
      this._pickerDef = null
      this.pendingFeatures = []
      this.multiPickMode = false
      this.multiPickedFeatures = []
      if (this.$map) this.$map.getViewport().style.cursor = ''
      if (this._escapeUnbind) { this._escapeUnbind(); this._escapeUnbind = null }
    },

    // ── Utilities ─────────────────────────────────────────────────────────
    geometrySummary (value) {
      if (!value) return ''
      if (typeof value === 'string') return value.length > 60 ? value.slice(0, 57) + '…' : value
      if (typeof value === 'object' && value.type) {
        if (value.type === 'FeatureCollection') return `FeatureCollection (${(value.features || []).length} features)`
        const coords = value.coordinates
        if (value.type === 'Point' && Array.isArray(coords)) return `Point [${coords.map(c => c.toFixed(5)).join(', ')}]`
        if (value.type === 'LineString') return `LineString (${coords.length} points)`
        if (value.type === 'Polygon') return `Polygon (${(coords[0] || []).length} vertices)`
        if (value.type.startsWith('Multi')) return `${value.type} (${coords.length} parts)`
        return value.type
      }
      return 'Geometry selected'
    },
    featureLabel (feature) {
      const id = feature.getId() || ''
      const props = feature.getProperties()
      const nameKey = Object.keys(props).find(k => /^name$|^title$|^label$/i.test(k))
      return nameKey ? `${props[nameKey]} (${id})` : id || 'Feature'
    },
    getFormValues () {
      const values = {}
      for (const [key, val] of Object.entries(this.formData)) {
        if (val !== null && val !== undefined && val !== '') values[key] = val
      }
      return values
    },
    finalizeActivePicking () {
      if (!this.activePickerField) return
      if (this.multiPickMode && this.multiPickedFeatures.length > 0) {
        this.finalizeMultiPick(this.activePickerField)
      } else {
        this.stopPicking()
      }
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

  // Geometry field
  .geometry-field { gap: 4px }
  .geometry-controls { overflow: hidden }
  .geometry-summary-row { overflow: hidden }
  .geometry-summary {
    font-size: 0.8em;
    font-family: monospace;
    opacity: 0.75;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }
  .layer-picker {
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 4px;
    padding: 8px;
    background: rgba(0,0,0,0.02);
  }
  .feature-picker {
    border: 1px solid rgba(0,0,0,0.15);
    border-radius: 4px;
    overflow: hidden;
    max-height: 160px;
    overflow-y: auto;
    .feature-picker-hint {
      font-size: 0.8em;
      opacity: 0.65;
      padding: 4px 8px;
      background: rgba(0,0,0,0.04);
    }
    .feature-picker-item {
      font-size: 0.85em;
      padding: 4px 8px;
      cursor: pointer;
      &:hover { background: rgba(33, 150, 243, 0.12) }
    }
  }
  .multi-pick-list {
    border: 1px solid rgba(33, 150, 243, 0.3);
    border-radius: 4px;
    overflow: hidden;
    .multi-pick-header {
      padding: 4px 8px;
      background: rgba(33, 150, 243, 0.08);
      .multi-pick-count {
        font-size: 0.85em;
        font-weight: 500;
        color: #1565c0;
      }
    }
    .multi-pick-item {
      font-size: 0.85em;
      padding: 2px 8px;
      border-top: 1px solid rgba(0,0,0,0.06);
      &:hover { background: rgba(0,0,0,0.03) }
    }
  }

  // Bbox field
  .bbox-field { gap: 4px }
  .bbox-inputs {
    display: grid;
    grid-template-columns: 1fr 1fr;
    gap: 8px;
  }
}
</style>
