<template>
  <div v-if="resultLayers.length > 0" class="layers-tree result-layers-root">
    <div v-for="group in groups" :key="group.id" class="result-group-wrapper">
      <div
        class="item group f-row-ac"
        :class="{collapsed: !openGroups[group.id]}"
        depth="0"
      >
        <svg
          width="16"
          viewBox="0 0 16 16"
          role="button"
          class="toggle icon"
          :class="{expanded: openGroups[group.id]}"
          @click="toggleGroup(group.id)"
        >
          <path d="M 8,1 L 8,15"/>
          <path class="tr" :d="openGroups[group.id] ? 'M 8,8 L 8,8' : 'M 1,8 L 15,8'"/>
        </svg>
        <span class="label f-grow" v-text="group.label"/>
        <v-switch
          class="round"
          :value="isGroupVisible(group)"
          @input="setGroupVisible(group, $event)"
        />
        <v-btn class="icon flat small" @click="removeGroup(group)">
          <v-icon name="x" size="14"/>
        </v-btn>
      </div>
      <collapse-transition>
        <div v-if="openGroups[group.id]">
          <template v-for="layer in group.layers">
            <div
              :key="layer.id"
              class="item layer f-row-ac"
              :class="{expanded: expandedLayer === layer}"
            >
              <v-checkbox
                class="f-grow"
                :label="layer.name"
                :value="layer.visible"
                @input="setVisibility(layer, $event)"
              />
              <v-btn
                v-if="!attributeTableDisabled && layer.queryable && layer.attributes && layer.attributes.length && layer.attr_table_fields && layer.attr_table_fields.length"
                :active="activeTool === 'attribute-table' && attributeTable.layer === layer"
                class="icon flat small"
                :color="activeTool === 'attribute-table' && attributeTable.layer === layer ? 'primary' : ''"
                :disabled="!layer.visible"
                @click="showAttributeTable(layer)"
              >
                <v-icon name="attribute-table" size="12"/>
              </v-btn>
              <v-icon v-else-if="layer.queryable" name="circle-i-outline" size="16"/>
              <v-btn
                class="icon flat small"
                @click="$store.commit('removeResultLayer', layer)"
              >
                <v-icon name="x" size="14"/>
              </v-btn>
              <v-btn class="icon flat small" @click="toggleLayerInfo(layer)">
                <v-icon class="toggle" name="arrow-down" size="12"/>
              </v-btn>
            </div>
            <collapse-transition :key="layer.id + '-meta'">
              <div
                v-if="expandedLayer === layer"
                class="metadata f-col px-2 py-1"
              >
                <div class="f-row-ac">
                  <translate class="label">Opacity</translate>
                  <v-slider
                    min="0"
                    max="255"
                    step="1"
                    class="f-grow mx-2 my-0"
                    marker-blend-color="#bbbbbbff"
                    hide-range-labels
                    :colors="opacityColors"
                    :value="layer.opacity"
                    @input="setOpacity(layer, $event)"
                  />
                </div>
                <p>
                  <translate class="label">Type</translate>
                  <span v-text="layer.type === 'wfs' ? 'Vector' : 'Raster'"/>
                  <span v-if="layer.wkb_type" class="px-2">
                    <v-icon :name="vectorIcon(layer.wkb_type)"/>
                    <v-tooltip>{{ layer.wkb_type }}</v-tooltip>
                  </span>
                </p>
                <p>
                  <translate class="label">Identification</translate>
                  <v-icon :name="layer.queryable ? 'check' : 'dash'"/>
                </p>
              </div>
            </collapse-transition>
          </template>
        </div>
      </collapse-transition>
    </div>
  </div>
</template>

<script>
import { mapState } from 'vuex'
import { hexColor } from '@/ui/utils/colors'

const VectorIcons = {
  NoGeometry: 'attribute-table',
  Point: 'point',
  PointZ: 'point',
  MultiPoint: 'point',
  MultiPointZ: 'point',
  LineString: 'line',
  LineStringZ: 'line',
  MultiLineString: 'line',
  MultiLineStringZ: 'line',
  Polygon: 'polygon',
  PolygonZ: 'polygon',
  MultiPolygon: 'polygon',
  MultiPolygonZ: 'polygon'
}

export default {
  name: 'result-layers-group',
  props: {
    attributeTableDisabled: Boolean
  },
  data () {
    return {
      openGroups: {},
      expandedLayer: null
    }
  },
  computed: {
    ...mapState(['resultLayers', 'activeTool', 'attributeTable']),
    groups () {
      const map = {}
      this.resultLayers.forEach(l => {
        const gid = l.groupId || '__ungrouped'
        if (!map[gid]) {
          map[gid] = { id: gid, label: l.groupLabel || gid, layers: [] }
        }
        map[gid].layers.push(l)
      })
      return Object.values(map)
    },
    opacityColors () {
      const color = getComputedStyle(document.body).getPropertyValue('--color-primary-rgb').split(',').map(Number)
      return [hexColor(color) + '20', hexColor(color) + 'ff']
    }
  },
  watch: {
    groups (newGroups, oldGroups) {
      newGroups.forEach(g => {
        if (!(g.id in this.openGroups)) {
          this.$set(this.openGroups, g.id, true)
        }
      })
    }
  },
  methods: {
    toggleGroup (id) {
      this.$set(this.openGroups, id, !this.openGroups[id])
    },
    isGroupVisible (group) {
      return group.layers.some(l => l.visible)
    },
    setGroupVisible (group, visible) {
      group.layers.forEach(layer => {
        this.$store.commit('resultLayerVisibility', { layer, visible })
      })
    },
    setVisibility (layer, visible) {
      this.$store.commit('resultLayerVisibility', { layer, visible })
    },
    setOpacity (layer, opacity) {
      this.$store.commit('resultLayerOpacity', { layer, opacity })
    },
    toggleLayerInfo (layer) {
      this.expandedLayer = this.expandedLayer !== layer ? layer : null
    },
    showAttributeTable (layer) {
      this.$emit('show-result-attribute-table', layer)
    },
    removeGroup (group) {
      this.$store.commit('removeResultGroup', group.id)
    },
    vectorIcon (wkbType) {
      return VectorIcons[wkbType] || ''
    }
  },
  created () {
    this.groups.forEach(g => {
      this.$set(this.openGroups, g.id, true)
    })
  }
}
</script>

<style lang="scss" scoped>
@import './layers-tree.scss';

.result-group-wrapper {
  border-width: 1px 0;
  border-color: #777;
  border-style: solid;
  box-sizing: border-box;

  & + & {
    border-top: none;
  }
}
</style>
