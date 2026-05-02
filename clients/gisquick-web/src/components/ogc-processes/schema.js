export const GEOMETRY_FORMATS = ['geojson', 'wkt', 'ewkt', 'wkb', 'ewkb', 'gml']
export const GEOMETRY_TYPE_RE = /Point|LineString|Polygon|MultiPoint|MultiLineString|MultiPolygon|Geometry/i

export const POLL_INTERVAL_MS = 2000
export const POLL_MAX_RETRIES = 300  // 300 × 2s = 10 minutes
export const FAILURE_STATUSES = new Set(['failed', 'error', 'dismissed', 'canceled', 'cancelled'])

export function resolveType (schema) {
  if (schema.type) return schema.type
  const candidates = schema.oneOf || schema.anyOf
  if (Array.isArray(candidates)) {
    for (const c of candidates) {
      const t = typeof c === 'string' ? c : c?.type
      if (t) return t
    }
  }
  return 'string'
}

export function isNumericType (schema) {
  const t = resolveType(schema)
  return t === 'number' || t === 'integer'
}

const GEOMETRY_MEDIA_TYPES = ['application/geo+json', 'application/gml+xml']

export function isGeometryInput (def) {
  const schema = def.schema || {}
  if (GEOMETRY_FORMATS.includes(schema.format)) return true
  if (Array.isArray(schema.contentMediaTypes) && schema.contentMediaTypes.some(m => GEOMETRY_MEDIA_TYPES.some(g => m.startsWith(g)))) return true
  if (schema.$ref && GEOMETRY_TYPE_RE.test(schema.$ref)) return true
  const text = ((def.title || '') + ' ' + (def.description || '')).toLowerCase()
  return /\b(geometry|point|polygon|linestring|line string)\b/.test(text)
}

export function isBboxInput (def) {
  const schema = def.schema || {}
  if (schema.type === 'array' && schema.items?.type === 'number') return true
  if (schema.format === 'bbox') return true
  const name = (def.title || '').toLowerCase()
  return name.includes('bbox') || name.includes('bounding box')
}

export function getSchemaGeomType (def) {
  const ref = (def.schema || {}).$ref || ''
  const m = ref.match(GEOMETRY_TYPE_RE)
  if (!m) return null
  const t = m[0]
  return t === 'Geometry' ? null : t
}

export function getOlGeometryType (def) {
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
}

