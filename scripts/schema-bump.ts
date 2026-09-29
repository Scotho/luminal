import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface ManifestVersion {
  version: string;
  date: string;
  description: string;
  migratedFrom?: string;
}

interface Manifest {
  current: string;
  versions: ManifestVersion[];
}

// Parse arguments
const args = process.argv.slice(2);

if (args.length < 2) {
  console.error('Usage: npx tsx scripts/schema-bump.ts <version> "<description>"');
  console.error('Example: npx tsx scripts/schema-bump.ts v1.0.9 "Added chat timestamps"');
  process.exit(1);
}

const newVersion = args[0];
const description = args[1];

// Paths
const schemasDir = path.join(__dirname, '..', 'data', 'schemas');
const manifestPath = path.join(schemasDir, 'manifest.json');

// Read manifest
let manifest: Manifest;
try {
  const manifestContent = fs.readFileSync(manifestPath, 'utf-8');
  manifest = JSON.parse(manifestContent);
} catch (error) {
  console.error(`Error reading manifest.json: ${error}`);
  process.exit(1);
}

const currentVersion = manifest.current;
const currentDir = path.join(schemasDir, currentVersion);
const newDir = path.join(schemasDir, newVersion);

// Check if new version directory already exists
if (fs.existsSync(newDir)) {
  console.error(`Error: Directory ${newVersion} already exists`);
  process.exit(1);
}

// Copy current schema directory to new version
try {
  fs.cpSync(currentDir, newDir, { recursive: true });
} catch (error) {
  console.error(`Error copying schema directory: ${error}`);
  process.exit(1);
}

// Update version field in all JSON files
const schemaFiles = fs.readdirSync(newDir).filter(file => file.endsWith('.json'));

for (const file of schemaFiles) {
  const filePath = path.join(newDir, file);
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content);

    if (data.version) {
      data.version = newVersion;
    }

    fs.writeFileSync(filePath, JSON.stringify(data, null, 2) + '\n');
  } catch (error) {
    console.error(`Error updating ${file}: ${error}`);
    process.exit(1);
  }
}

// Update manifest
const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

const newVersionEntry: ManifestVersion = {
  version: newVersion,
  date: today,
  description: description,
  migratedFrom: currentVersion,
};

manifest.versions.push(newVersionEntry);
manifest.current = newVersion;

try {
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2) + '\n');
} catch (error) {
  console.error(`Error updating manifest.json: ${error}`);
  process.exit(1);
}

console.log(`✓ Schema version ${newVersion} created successfully`);
console.log(`  Copied from: ${currentVersion}`);
console.log(`  Location: data/schemas/${newVersion}/`);
console.log(`  Updated manifest.json with version entry`);
console.log('');
console.log('Next steps:');
console.log(`  1. Edit the schema files in data/schemas/${newVersion}/ as needed`);
console.log(`  2. Commit the new schema version`);
