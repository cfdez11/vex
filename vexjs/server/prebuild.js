import "dotenv/config";
import { build } from "./utils/component-processor.js";
import { initializeDirectories } from "./utils/files.js";

console.log("🔨 Starting prebuild...");

console.log("📁 Creating directories...");
await initializeDirectories();

console.log("⚙️  Generating components and routes...");
await build();

console.log("✅ Prebuild complete!");

process.exit(0);
