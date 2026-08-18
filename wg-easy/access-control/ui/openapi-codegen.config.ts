import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "@openapi-codegen/cli";
import {
  generateFetchers,
  generateReactQueryComponents,
  generateSchemaTypes,
} from "@openapi-codegen/typescript";

const currentDir = path.dirname(fileURLToPath(import.meta.url));
const filePath = path.resolve(currentDir, "../openapi.json");

export default defineConfig({
  api: {
    from: {
      source: "file",
      relativePath: path.relative(currentDir, filePath),
    },
    outputDir: "src/api",
    to: async (context) => {
      const config = { filenamePrefix: "api", useEnums: false };
      const { schemasFiles } = await generateSchemaTypes(context, config);
      await generateFetchers(context, { schemasFiles, ...config });
      await generateReactQueryComponents(context, {
        schemasFiles,
        ...config,
      });
    },
  },
});
