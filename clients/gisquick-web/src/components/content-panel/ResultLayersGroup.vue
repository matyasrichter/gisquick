<template>
  <div v-if="resultLayers.length > 0" class="layers-tree result-layers-group">
    <div class="result-group-wrapper">
      <div
        class="item group f-row-ac"
        :class="{collapsed: !open}"
        depth="0"
      >
        <svg
          width="16"
          viewBox="0 0 16 16"
          role="button"
          class="toggle icon"
          :class="{expanded: open}"
          @click="open = !open"
        >
          <path d="M 8,1 L 8,15"/>
          <path class="tr" :d="open ? 'M 8,8 L 8,8' : 'M 1,8 L 15,8'"/>
        </svg>
        <span class="label f-grow">
          <translate>Processing results</translate>
        </span>
        <v-switch
          class="round"
          :value="groupVisible"
          @input="setGroupVisible"
        />
      </div>
      <collapse-transition>
        <div v-if="open">
          <template v-for="layer in resultLayers">
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
              <span class="layer-type">{{ layer.type.toUpperCase() }}</span>
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

export default {
  name: 'result-layers-group',
  data () {
    return {
      open: true,
      expandedLayer: null
    }
  },
  computed: {
    ...mapState(['resultLayers']),
    groupVisible () {
      return this.resultLayers.some(l => l.visible)
    },
    opacityColors () {
      const color = getComputedStyle(document.body).getPropertyValue('--color-primary-rgb').split(',').map(Number)
      return [hexColor(color) + '20', hexColor(color) + 'ff']
    }
  },
  methods: {
    setGroupVisible (visible) {
      this.resultLayers.forEach(layer => {
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
    }
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
}

.layer-type {
  font-size: 11px;
  opacity: 0.45;
  letter-spacing: 0.03em;
  margin-right: 2px;
}
</style>
