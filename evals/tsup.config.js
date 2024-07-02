import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/*.ts"],
  format: ["esm"],
  dts: true, // Generate declaration file (.d.ts)
  splitting: false,
  sourcemap: true,
  clean: true,
});