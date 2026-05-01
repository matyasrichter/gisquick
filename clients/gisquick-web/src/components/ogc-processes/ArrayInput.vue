<template>
  <div class="array-input">
    <template v-if="isArrayMode">
      <div
        v-for="(item, index) in items"
        :key="index"
        class="array-input-row f-row-ac"
      >
        <div class="f-grow">
          <slot :item="item" :index="index" :update="v => updateItem(index, v)"/>
        </div>
        <v-btn
          class="icon small ml-1"
          :disabled="items.length <= minCount"
          @click="removeItem(index)"
        >
          <v-icon name="delete_forever" size="14"/>
        </v-btn>
      </div>
      <v-btn class="icon small mt-1" :disabled="atMax" @click="addItem">
        <v-icon name="plus" size="14"/>
      </v-btn>
    </template>
    <template v-else>
      <slot :item="value" :index="0" :update="v => $emit('input', v)"/>
    </template>
  </div>
</template>

<script>
export default {
  name: 'ArrayInput',
  props: {
    value: { default: null },
    minOccurs: { type: Number, default: 1 },
    maxOccurs: { type: Number, default: 1 }
  },
  computed: {
    isArrayMode () { return this.maxOccurs !== 1 },
    items () { return Array.isArray(this.value) ? this.value : [] },
    minCount () { return Math.max(1, this.minOccurs) },
    atMax () { return this.maxOccurs > 1 && this.items.length >= this.maxOccurs }
  },
  methods: {
    updateItem (index, val) {
      const arr = [...this.items]
      arr[index] = val
      this.$emit('input', arr)
    },
    addItem () {
      this.$emit('input', [...this.items, null])
    },
    removeItem (index) {
      this.$emit('input', this.items.filter((_, i) => i !== index))
    }
  }
}
</script>

<style lang="scss" scoped>
.array-input {
  .array-input-row {
    gap: 4px;
    & + & { margin-top: 4px }
  }
}
</style>
