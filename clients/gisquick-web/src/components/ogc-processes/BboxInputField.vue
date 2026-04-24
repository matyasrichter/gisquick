<template>
  <div class="bbox-field f-col">
    <label class="field-label" v-text="label"/>
    <div class="bbox-pick-row f-row-ac mb-1" style="gap: 6px; flex-wrap: wrap">
      <v-btn
        class="small"
        :color="picking ? 'orange' : 'primary'"
        @click="$emit(picking ? 'stop-pick' : 'start-pick')"
      >
        {{ picking ? 'Cancel' : 'Pick on map' }}
      </v-btn>
      <v-btn class="small outlined" @click="$emit('use-view-extent')">Use view</v-btn>
      <v-btn
        v-if="value && value.some(v => v !== null)"
        class="icon small flat"
        @click="$emit('clear')"
      >
        <v-icon name="x" size="14"/>
      </v-btn>
    </div>
    <div class="bbox-inputs">
      <v-text-field
        v-for="(coord, idx) in coordLabels"
        :key="idx"
        type="number"
        step="any"
        :label="coord"
        :value="(value || [])[idx]"
        @input="onCoordInput(idx, $event)"
      />
    </div>
  </div>
</template>

<script>
export default {
  props: {
    label: { type: String, default: '' },
    value: { type: Array, default: () => [null, null, null, null] },
    picking: { type: Boolean, default: false }
  },
  data () {
    return {
      coordLabels: ['Min X', 'Min Y', 'Max X', 'Max Y']
    }
  },
  methods: {
    onCoordInput (idx, val) {
      const arr = [...(this.value || [null, null, null, null])]
      arr[idx] = parseFloat(val)
      this.$emit('input', arr)
    }
  }
}
</script>

<style lang="scss" scoped>
.bbox-field { gap: 4px }
.bbox-inputs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
</style>
