<template>
  <div class="json-node" :class="`depth-${depth}`">
    <!-- Object -->
    <template v-if="isObject">
      <span class="toggle" @click="expanded = !expanded">
        <v-icon :name="expanded ? 'chevron-down' : 'chevron-right'" size="12" class="toggle-icon"/>
        <span v-if="label !== undefined" class="key">{{ label }}: </span>
        <span class="brace">{{ expanded ? '{' : `{ ${keys.length} }` }}</span>
      </span>
      <v-collapsible>
        <div v-if="expanded" class="children">
          <json-viewer
            v-for="k in keys"
            :key="k"
            :label="k"
            :data="data[k]"
            :depth="depth + 1"
          />
          <span class="brace close-brace">}</span>
        </div>
      </v-collapsible>
    </template>

    <!-- Array -->
    <template v-else-if="isArray">
      <span class="toggle" @click="expanded = !expanded">
        <v-icon :name="expanded ? 'chevron-down' : 'chevron-right'" size="12" class="toggle-icon"/>
        <span v-if="label !== undefined" class="key">{{ label }}: </span>
        <span class="brace">{{ expanded ? '[' : `[ ${data.length} ]` }}</span>
      </span>
      <v-collapsible>
        <div v-if="expanded" class="children">
          <json-viewer
            v-for="(item, i) in data"
            :key="i"
            :label="i"
            :data="item"
            :depth="depth + 1"
          />
          <span class="brace close-brace">]</span>
        </div>
      </v-collapsible>
    </template>

    <!-- Primitive -->
    <template v-else>
      <span class="primitive">
        <span v-if="label !== undefined" class="key">{{ label }}: </span>
        <span class="value" :class="valueType">{{ displayValue }}</span>
      </span>
    </template>
  </div>
</template>

<script>
import VCollapsible from '@/ui/Collapsible.vue'

export default {
  name: 'JsonViewer',
  components: { VCollapsible },
  props: {
    data: { default: null },
    label: { default: undefined },
    depth: { type: Number, default: 0 }
  },
  data () {
    return { expanded: this.depth === 0 }
  },
  computed: {
    isObject () {
      return this.data !== null && typeof this.data === 'object' && !Array.isArray(this.data)
    },
    isArray () {
      return Array.isArray(this.data)
    },
    keys () {
      return this.isObject ? Object.keys(this.data) : []
    },
    valueType () {
      if (this.data === null) return 'null'
      return typeof this.data
    },
    displayValue () {
      if (this.data === null) return 'null'
      if (typeof this.data === 'string') return `"${this.data}"`
      return String(this.data)
    }
  }
}
</script>

<style lang="scss" scoped>
.json-node {
  font-family: monospace;
  font-size: 12.5px;
  line-height: 1.7;

  .toggle {
    display: inline-flex;
    align-items: center;
    gap: 3px;
    cursor: pointer;
    user-select: none;
    border-radius: 2px;
    &:hover {
      background: rgba(0, 0, 0, 0.06);
    }
  }
  .toggle-icon {
    flex-shrink: 0;
    opacity: 0.5;
  }
  .primitive {
    display: inline-flex;
    align-items: center;
    padding-left: 17px; // align with toggled rows (icon width + gap)
  }
  .children {
    padding-left: 18px;
  }
  .key {
    color: #7a3e9d;
  }
  .brace {
    color: #555;
  }
  .close-brace {
    display: block;
    padding-left: 0;
  }
  .value {
    &.string  { color: #22863a; }
    &.number  { color: #005cc5; }
    &.boolean { color: #e36209; }
    &.null    { color: #999; font-style: italic; }
  }
}
</style>
