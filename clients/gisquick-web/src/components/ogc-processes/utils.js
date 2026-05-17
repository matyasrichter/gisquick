import GeoJSON from 'ol/format/GeoJSON'
import WKT from 'ol/format/WKT'

export function extractResultsUrl (links) {
  if (!Array.isArray(links)) return null
  const OGC_REL_RESULTS = 'http://www.opengis.net/def/rel/ogc/1.0/results'
  const candidates = links.filter(l => l.rel === OGC_REL_RESULTS)
  return candidates.find(l => l.type === 'application/json')?.href
    || candidates.find(l => l.type === 'application/geo+json')?.href
    || candidates[0]?.href
    || null
}

export function sleep (ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

export function formatFileSize (bytes) {
  if (!bytes) return ''
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1048576).toFixed(1)} MB`
}

export function geometrySummary (value) {
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
}

export function featureLabel (feature) {
  const id = feature.getId() || ''
  const props = feature.getProperties()
  const nameKey = Object.keys(props).find(k => /^name$|^title$|^label$/i.test(k))
  return nameKey ? `${props[nameKey]} (${id})` : id || 'Feature'
}

export function geoJsonFeatureLabel (feature, index) {
  const props = feature.properties || {}
  const nameKey = Object.keys(props).find(k => /^name$|^title$|^label$/i.test(k))
  return nameKey ? props[nameKey] : `Feature ${index + 1}`
}

export function olGeometryToInput (geom, format, mapProj) {
  if (format === 'wkt') {
    return new WKT().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: mapProj })
  }
  return JSON.parse(new GeoJSON().writeGeometry(geom, { dataProjection: 'EPSG:4326', featureProjection: mapProj }))
}

export function olFeaturesToGeoJsonCollection (features, mapProj) {
  const fmt = new GeoJSON()
  return {
    type: 'FeatureCollection',
    features: features.map(f => {
      const { geometry: _g, ...properties } = f.getProperties()
      return {
        type: 'Feature',
        geometry: JSON.parse(fmt.writeGeometry(f.getGeometry(), { dataProjection: 'EPSG:4326', featureProjection: mapProj })),
        properties
      }
    })
  }
}
