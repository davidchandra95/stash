import { configDefaults, defineConfig, mergeConfig } from 'vitest/config'
import viteConfig from './vite.config.ts'

export default mergeConfig(
  viteConfig,
  defineConfig({
    test: {
      // The standalone macOS experiment uses Node's built-in test runner.
      exclude: [...configDefaults.exclude, 'prototypes/**'],
    },
  }),
)
