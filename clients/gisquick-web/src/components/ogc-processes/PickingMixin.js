import GeoJSON from 'ol/format/GeoJSON'
import WKT from 'ol/format/WKT'
import Draw, { createBox } from 'ol/interaction/Draw'
import VectorSource from 'ol/source/Vector'
import OlVectorLayer from 'ol/layer/Vector'
import Circle from 'ol/geom/Circle'
import { fromCircle, fromExtent as polygonFromExtent } from 'ol/geom/Polygon'
import { unByKey } from 'ol/Observable'
import { getCenter } from 'ol/extent'
import { simpleStyle } from '@/map/styles'
import { layersFeaturesQuery, layerFeaturesQuery } from '@/map/featureinfo'
import { getOutputFormat, getSchemaGeomType } from './schema'

const ALL_DRAW_GEOM_TYPES = [
  { value: 'Point', text: 'Point' },
  { value: 'LineString', text: 'Line' },
  { value: 'Polygon', text: 'Polygon' }
]

export default {
  inject: {
    getResultLayersMap: { from: 'getResultLayersMap', default: null }
  },
  data () {
    return {
      pickTypes: {},
      drawGeomTypes: {},
      activePickerField: null,
      activePickerMode: null,
      pendingFeatures: [],
      multiPickMode: false,
      multiPickedFeatures: [],
      fetchingLayer: false,
      layerFeaturesOpen: {},
      layerPickerSelectedIndex: {}
    }
  },
  created () {
    this._draw = null
    this._drawLayer = null
    this._pickerDef = null
    this._selectKey = null
    this._escapeUnbind = null
    this._layerOlFeatures = []
    this._drawLayerFeatures = []
    this._selectedDrawFeature = null
  },
  beforeDestroy () {
    this._cleanupPicker(true)
  },
  methods: {
    // ── Pick type ─────────────────────────────────────────────────────────
    setPickType (name, type) {
      if (this.activePickerField === name) this.stopPicking()
      this.$set(this.pickTypes, name, type)
      if (type === 'draw') {
        if (!this.drawGeomTypes[name]) {
          const schemaType = getSchemaGeomType(this.inputSchemas[name])
          this.$set(this.drawGeomTypes, name, schemaType || 'Polygon')
        }
      } else if (type !== 'layer') {
        this.togglePicking(name, this.inputSchemas[name])
      }
    },

    setDrawGeomType (name, type) {
      this.$set(this.drawGeomTypes, name, type)
      this.startDraw(name, this.inputSchemas[name])
    },

    drawGeomTypeOptionsFor (name) {
      const def = this.inputSchemas[name]
      const t = def ? getSchemaGeomType(def) : null
      return t ? ALL_DRAW_GEOM_TYPES.filter(o => o.value === t) : ALL_DRAW_GEOM_TYPES
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
        // multiPickMode must be set AFTER startFeatureSelect (_cleanupPicker resets it)
        this.startFeatureSelect(name, def)
        this.multiPickMode = true
      } else if (type === 'draw') {
        this.startDraw(name, def)
      }
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

    // ── Feature select (single & multi) ──────────────────────────────────
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

      const resultLayersMap = this.getResultLayersMap?.()
      const resultWfsOlLayers = []
      if (resultLayersMap) {
        for (const [olLayer, meta] of resultLayersMap.entries()) {
          if (meta.type === 'wfs' && meta.visible) resultWfsOlLayers.push(olLayer)
        }
      }

      if (!wfsLayers.length && !resultWfsOlLayers.length) return

      const pixelRadius = 8
      const radius = Math.abs(map.getCoordinateFromPixel([pixel[0] + pixelRadius, pixel[1]])[0] - coordinate[0])
      let allFeatures = []

      if (wfsLayers.length) {
        const geomFilter = { geom: fromCircle(new Circle(coordinate, radius), 6), projection: mapProj }
        const query = layersFeaturesQuery(wfsLayers, { geomFilter })
        try {
          const config = {
            params: { VERSION: '1.1.0', SERVICE: 'WFS', REQUEST: 'GetFeature', OUTPUTFORMAT: 'GeoJSON', MAXFEATURES: 10 },
            headers: { 'Content-Type': 'text/xml' }
          }
          const { data } = await this.$http.post(this.project.config.ows_url, query, config)
          allFeatures = allFeatures.concat(new GeoJSON().readFeatures(data, { featureProjection: mapProj }))
        } catch (e) {
          console.error('Feature query failed', e)
        }
      }

      if (resultWfsOlLayers.length) {
        const hitFeatures = map.getFeaturesAtPixel(pixel, {
          hitTolerance: pixelRadius,
          layerFilter: l => resultWfsOlLayers.includes(l)
        })
        if (hitFeatures) allFeatures = allFeatures.concat(hitFeatures)
      }

      if (!allFeatures.length) return
      if (this.multiPickMode) {
        allFeatures.length === 1 ? this._addToMultiPick(name, allFeatures[0]) : (this.pendingFeatures = allFeatures)
      } else {
        allFeatures.length === 1 ? this.applyPendingFeature(name, def, allFeatures[0]) : (this.pendingFeatures = allFeatures)
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
      const fmt = getOutputFormat(def)
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
        let features

        if (layer.isResultLayer) {
          const layersMap = this.getResultLayersMap?.()
          if (!layersMap) return
          let olLayer = null
          for (const [lyr, meta] of layersMap.entries()) {
            if (meta.id === layerName) { olLayer = lyr; break }
          }
          if (!olLayer) return
          features = olLayer.getSource().getFeatures()
        } else {
          const query = layerFeaturesQuery(layer, {})
          const config = {
            params: { VERSION: '1.1.0', SERVICE: 'WFS', REQUEST: 'GetFeature', OUTPUTFORMAT: 'GeoJSON', MAXFEATURES: 500 },
            headers: { 'Content-Type': 'text/xml' }
          }
          const { data } = await this.$http.post(this.project.config.ows_url, query, config)
          features = new GeoJSON().readFeatures(data, { featureProjection: mapProj })
        }

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
        this._drawLayerFeatures = features.map(f => {
          const clone = f.clone()
          this._drawLayer.getSource().addFeature(clone)
          return clone
        })
        this._selectedDrawFeature = null
        this._layerOlFeatures = [...features]
        this.$set(this.layerFeaturesOpen, name, false)
        this.$set(this.layerPickerSelectedIndex, name, null)
      } catch (e) {
        console.error('Layer features fetch failed', e)
      } finally {
        this.fetchingLayer = false
      }
    },

    // ── Freehand draw ─────────────────────────────────────────────────────
    startDraw (name, def) {
      this._cleanupPicker(true)
      this.activePickerField = name
      this.activePickerMode = 'draw'
      this._pickerDef = def

      const source = new VectorSource()
      const layer = new OlVectorLayer({ source, zIndex: 999 })
      this.$map.addLayer(layer)
      this._drawLayer = layer

      const olType = this.drawGeomTypes[name] || 'Polygon'
      const draw = new Draw({ source, type: olType })
      draw.on('drawend', evt => {
        const mapProj = this.$map.getView().getProjection()
        const geom = evt.feature.getGeometry()
        const fmt = getOutputFormat(def)
        const value = fmt === 'wkt'
          ? new WKT().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: mapProj })
          : JSON.parse(new GeoJSON().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: mapProj }))
        this.$set(this.formData, name, value)
        this._stopDrawInteraction()
      })
      this.$map.addInteraction(draw)
      this._draw = draw
      this.$map.getViewport().style.cursor = 'crosshair'
      this._setupEscapeListener()
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
      this._drawLayerFeatures = []
      this._selectedDrawFeature = null
      this.$set(this.layerPickerSelectedIndex, name, null)
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

    // ── Layer feature interaction ─────────────────────────────────────────
    clickLayerFeature (name, index) {
      const selectedStyle = simpleStyle({ fill: [3, 169, 244, 0.4], stroke: [3, 169, 244, 0.9], strokeWidth: 3 })
      if (this._selectedDrawFeature) this._selectedDrawFeature.setStyle(null)
      const clone = this._drawLayerFeatures[index]
      if (clone) {
        clone.setStyle(selectedStyle)
        this._selectedDrawFeature = clone
      }
      this.$set(this.layerPickerSelectedIndex, name, index)
      const olFeature = this._layerOlFeatures[index]
      if (olFeature) {
        const coord = getCenter(olFeature.getGeometry().getExtent())
        this.$emit('identify-feature', { feature: olFeature, coord })
      }
    },

    removeLayerFeature (name, index) {
      const fc = this.formData[name]
      if (!fc || fc.type !== 'FeatureCollection') return
      const clone = this._drawLayerFeatures[index]
      if (this._drawLayer && clone) {
        this._drawLayer.getSource().removeFeature(clone)
        if (this._selectedDrawFeature === clone) {
          this._selectedDrawFeature = null
          this.$set(this.layerPickerSelectedIndex, name, null)
        }
      }
      this._drawLayerFeatures.splice(index, 1)
      this._layerOlFeatures.splice(index, 1)
      const selectedIdx = this.layerPickerSelectedIndex[name]
      if (selectedIdx !== null && selectedIdx > index) {
        this.$set(this.layerPickerSelectedIndex, name, selectedIdx - 1)
      }
      const newFeatures = fc.features.slice()
      newFeatures.splice(index, 1)
      if (newFeatures.length === 0) {
        this.clearGeometry(name)
      } else {
        this.$set(this.formData, name, { type: 'FeatureCollection', features: newFeatures })
      }
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
