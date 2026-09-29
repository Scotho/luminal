// Extract bike and character into separate GLB files from the Blackguard model.
// Usage: node scripts/extract-glb.mjs <input.glb>

import { NodeIO } from '@gltf-transform/core';
import { cloneDocument } from '@gltf-transform/functions';
import path from 'path';

const input = process.argv[2];
if (!input) { console.error('Usage: node extract-glb.mjs <input.glb>'); process.exit(1); }

const io = new NodeIO();
const doc = await io.read(input);
const root = doc.getRoot();

// List all meshes
const meshes = root.listMeshes();
console.log('Meshes found:');
meshes.forEach((m, i) => console.log(`  [${i}] ${m.getName()}`));

// Identify which meshes belong to bike vs character
const bikeMeshNames = ['bike_blackguard'];
const charMeshNames = ['hat_m_blackGuard', 'helmet_m_blackGuard', 'body_m_blackGuard', 'face_m_gladiatorA'];

function isBikeMesh(name) {
  return bikeMeshNames.some(k => name.includes(k));
}
function isCharMesh(name) {
  return charMeshNames.some(k => name.includes(k));
}

// Clone document for each output, then remove unwanted meshes + nodes
async function extractMeshes(keepFn, outputPath) {
  const clone = await cloneDocument(doc);
  const cloneRoot = clone.getRoot();

  // Remove meshes that don't match
  for (const mesh of cloneRoot.listMeshes()) {
    if (!keepFn(mesh.getName())) {
      // Find nodes referencing this mesh and clear their mesh reference
      for (const node of cloneRoot.listNodes()) {
        if (node.getMesh() === mesh) {
          node.setMesh(null);
        }
      }
      mesh.dispose();
    }
  }

  // Prune empty nodes (no mesh, no children with meshes)
  function nodeHasContent(node) {
    if (node.getMesh()) return true;
    return node.listChildren().some(c => nodeHasContent(c));
  }
  for (const node of cloneRoot.listNodes()) {
    if (!nodeHasContent(node) && node.listChildren().length === 0) {
      node.dispose();
    }
  }

  await io.write(outputPath, clone);
  console.log(`Wrote: ${outputPath}`);
}

const dir = path.dirname(input);

await extractMeshes(isBikeMesh, path.join(dir, 'blackguard_bike_only.glb'));
await extractMeshes(isCharMesh, path.join(dir, 'blackguard_character.glb'));

console.log('Done!');
