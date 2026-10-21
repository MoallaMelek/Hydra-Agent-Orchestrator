

import { expect, it } from 'vitest'
import { recommend } from './outcomes.js'

it.each(['answer/fast', 'change/normal'])('refuses a recommendation without ready agents: %s', (category) => {
  expect(() => recommend(category, [], [])).toThrow(/No ready agent/)
})
