<template>
  <div class="geometry-field f-col">
    <label class="field-label" v-text="label"/>

    <!-- Type selector + action row -->
    <div class="geometry-controls f-row-ac" style="gap: 6px">
      <v-select
        class="pick-type-select f-grow"
        label="Input type"
        :items="pickTypeOptions"
        :value="pickType"
        @input="$emit('set-pick-type', $event)"
      />
      <!-- Action button — hidden for layer type -->
      <v-btn
        v-if="pickType !== 'layer'"
        class="small"
        :color="actionBtnColor"
        @click="onActionClick"
      >
        {{ actionBtnLabel }}
      </v-btn>
      <!-- Clear -->
      <v-btn
        v-if="value"
        class="icon small flat"
        @click="$emit('clear')"
      >
        <v-icon name="x" size="14"/>
      </v-btn>
    </div>

    <!-- Layer picker (shown when type = 'layer') -->
    <div v-if="pickType === 'layer'" class="layer-picker f-col mt-1">
      <v-select
        label="Layer"
        :items="queryableLayers"
        item-text="title"
        item-value="name"
        :value="selectedLayerName"
        :loading="fetchingLayer"
        placeholder="Select a layer…"
        @input="onLayerSelect"
      />
      <!-- Collapsible feature list toggle -->
      <div
        v-if="value && value.type === 'FeatureCollection'"
        class="layer-features-toggle f-row-ac"
        @click="$emit('toggle-layer-features-open')"
      >
        <v-icon
          class="toggle-icon"
          name="arrow-down"
          size="12"
          :style="layerFeaturesOpen ? '' : 'transform: rotate(-90deg)'"
        />
        <span class="toggle-label">
          {{ value.features.length }} feature{{ value.features.length !== 1 ? 's' : '' }}
        </span>
      </div>
      <!-- Feature list (collapsible) -->
      <collapse-transition>
        <div
          v-if="layerFeaturesOpen && value && value.type === 'FeatureCollection'"
          class="layer-features-list"
        >
          <div
            v-for="(feat, i) in value.features"
            :key="i"
            class="layer-feature-item f-row-ac"
            :class="{ selected: layerPickerSelectedIndex === i }"
            @click="$emit('click-layer-feature', i)"
          >
            <span class="f-grow">{{ geoJsonFeatureLabel(feat, i) }}</span>
            <v-btn class="icon small flat" @click.stop="$emit('remove-layer-feature', i)">
              <v-icon name="x" size="11"/>
            </v-btn>
          </div>
        </div>
      </collapse-transition>
    </div>

    <!-- Multi-pick accumulation list -->
    <div
      v-if="isPicking && multiPickedFeatures.length > 0"
      class="multi-pick-list f-col mt-1"
    >
      <div class="multi-pick-header f-row-ac">
        <span class="multi-pick-count">
          {{ multiPickedFeatures.length }} feature{{ multiPickedFeatures.length !== 1 ? 's' : '' }} selected
        </span>
        <v-btn class="small ml-auto" color="primary" @click="$emit('finalize-multi-pick')">Done</v-btn>
      </div>
      <div
        v-for="(feat, i) in multiPickedFeatures"
        :key="i"
        class="multi-pick-item f-row-ac"
      >
        <span class="f-grow">{{ featureLabel(feat) }}</span>
        <v-btn class="icon small flat" @click="$emit('remove-picked-feature', i)">
          <v-icon name="x" size="12"/>
        </v-btn>
      </div>
    </div>

    <!-- Value summary -->
    <div
      v-else-if="value && !isPicking"
      class="geometry-summary-row f-row-ac mt-1"
      style="min-width: 0"
    >
      <span class="geometry-summary">{{ geometrySummary(value) }}</span>
    </div>

    <!-- Feature disambiguation list -->
    <div
      v-if="isPicking && pendingFeatures.length > 1"
      class="feature-picker f-col mt-1"
    >
      <span class="feature-picker-hint">Multiple features found — click one to use it:</span>
      <div
        v-for="(feat, i) in pendingFeatures"
        :key="i"
        class="feature-picker-item"
        @click="multiPickMode ? $emit('add-to-multi-pick', feat) : $emit('apply-pending-feature', feat)"
      >
        {{ featureLabel(feat) }}
      </div>
    </div>
  </div>
</template>

<script>
import { geometrySummary, featureLabel, geoJsonFeatureLabel } from './utils'

const PICK_TYPE_OPTIONS = [
  { value: 'feature', text: 'Feature' },
  { value: 'multi',   text: 'Multiple features' },
  { value: 'layer',   text: 'Entire layer' }
]

export default {
  props: {
    fieldName: { type: String, required: true },
    label: { type: String, default: '' },
    value: { default: null },
    pickType: { type: String, default: 'feature' },
    activePickerField: { type: String, default: null },
    activePickerMode: { type: String, default: null },
    multiPickMode: { type: Boolean, default: false },
    multiPickedFeatures: { type: Array, default: () => [] },
    pendingFeatures: { type: Array, default: () => [] },
    queryableLayers: { type: Array, default: () => [] },
    fetchingLayer: { type: Boolean, default: false },
    layerFeaturesOpen: { type: Boolean, default: false },
    layerPickerSelectedIndex: { default: null }
  },
  data () {
    return {
      selectedLayerName: null,
      pickTypeOptions: PICK_TYPE_OPTIONS
    }
  },
  computed: {
    isPicking () {
      return this.activePickerField === this.fieldName
    },
    hasValue () {
      const v = this.value
      return Array.isArray(v) ? v.some(x => x !== null) : !!v
    },
    actionBtnLabel () {
      if (this.isPicking) {
        return this.multiPickMode && this.multiPickedFeatures.length > 0 ? 'Done' : 'Cancel'
      }
      if (this.pickType === 'feature') return this.hasValue ? 'Update' : 'Pick'
      if (this.pickType === 'multi') return this.hasValue ? 'Add more' : 'Pick'
      return 'Pick'
    },
    actionBtnColor () {
      if (this.isPicking) {
        return this.multiPickMode && this.multiPickedFeatures.length > 0 ? 'primary' : 'orange'
      }
      return 'primary'
    }
  },
  watch: {
    // When parent sets a FeatureCollection (layer loaded), reset the layer dropdown
    value (val) {
      if (val && val.type === 'FeatureCollection') {
        this.selectedLayerName = null
      }
    }
  },
  methods: {
    geometrySummary,
    featureLabel,
    geoJsonFeatureLabel,
    onActionClick () {
      if (this.isPicking && this.multiPickMode && this.multiPickedFeatures.length > 0) {
        this.$emit('finalize-multi-pick')
      } else {
        this.$emit('toggle-picking')
      }
    },
    onLayerSelect (layerName) {
      this.selectedLayerName = layerName
      this.$emit('fetch-layer-features', layerName)
    }
  }
}
</script>

<style lang="scss" scoped>
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
  .layer-features-toggle {
    gap: 6px;
    cursor: pointer;
    padding: 3px 2px;
    font-size: 0.82em;
    opacity: 0.75;
    user-select: none;
    margin-top: 4px;
    &:hover { opacity: 1 }
    .toggle-icon { transition: transform 0.15s }
  }
  .layer-features-list {
    max-height: 180px;
    overflow-y: auto;
    border-top: 1px solid rgba(0,0,0,0.08);
    margin-top: 4px;
  }
  .layer-feature-item {
    font-size: 0.82em;
    padding: 2px 4px 2px 6px;
    gap: 4px;
    cursor: pointer;
    &:hover { background: rgba(0,0,0,0.04) }
    &.selected { background: rgba(3, 169, 244, 0.12) }
  }
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
</style>
