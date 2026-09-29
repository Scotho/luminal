// Merge the Blackguard character onto the tron_motorcycle, scaled and positioned
// to sit on the seat in a natural riding pose.
// Usage: node scripts/merge-rider.mjs

import { NodeIO, Document } from '@gltf-transform/core';
import { cloneDocument } from '@gltf-transform/functions';
import path from 'path';

const BIKE_PATH = 'public/models/tron_motorcycle.glb';
const CHAR_PATH = 'E:/ForClaude/backup/blackguard_character.glb';
const OUTPUT_PATH = 'public/models/tron_motorcycle_with_rider.glb';

const io = new NodeIO();

// Read both models
const bikeDoc = await io.read(BIKE_PATH);
const charDoc = await io.read(CHAR_PATH);

const bikeRoot = bikeDoc.getRoot();
const charRoot = charDoc.getRoot();

// ── Compute character transform ──────────────────────────
// Original Blackguard bike Z extent: 2.85 units
// tron_motorcycle Z extent: 6.05 units → scale factor ~2.12
// Character was centered on the Blackguard bike in riding pose.
// We need to scale up and reposition onto the new bike's seat.

const SCALE = 2.05;  // match proportions (slightly under to not clip)

// Character original bbox center: X≈0.002, Y≈0.748, Z≈0.006
// After scale: X≈0.004, Y≈1.533, Z≈0.012
// Character original bbox bottom (butt): Y≈0.229 → scaled Y≈0.469
// Bike seat area (Upper Part) is roughly at Y≈1.3, Z≈0.3 (slightly behind center)
// So we offset: Y = seat_Y - scaled_butt_Y, Z = slight forward lean toward handlebars

const OFFSET_X = 0.0;    // centered on bike
const OFFSET_Y = 0.68;   // lift character so butt sits on seat (~1.3 - 0.469 ≈ 0.83, tuned down for lean)
const OFFSET_Z = -0.15;  // slightly forward toward handlebars

// Slight forward lean rotation (radians, around X axis)
const LEAN_X = -0.08;    // ~5 degrees forward lean

// ── Copy character textures and materials into bike document ──

// Map from char texture → bike texture
const textureMap = new Map();
for (const charTex of charRoot.listTextures()) {
  const image = charTex.getImage();
  const mimeType = charTex.getMimeType();
  const name = charTex.getName();

  const bikeTex = bikeDoc.createTexture(name);
  if (image) bikeTex.setImage(image);
  if (mimeType) bikeTex.setMimeType(mimeType);
  textureMap.set(charTex, bikeTex);
}

// Map from char material → bike material
const materialMap = new Map();
for (const charMat of charRoot.listMaterials()) {
  const bikeMat = bikeDoc.createMaterial(charMat.getName());

  // Copy PBR properties
  bikeMat.setBaseColorFactor(charMat.getBaseColorFactor());
  bikeMat.setMetallicFactor(charMat.getMetallicFactor());
  bikeMat.setRoughnessFactor(charMat.getRoughnessFactor());
  bikeMat.setEmissiveFactor(charMat.getEmissiveFactor());
  bikeMat.setAlphaMode(charMat.getAlphaMode());
  bikeMat.setDoubleSided(charMat.getDoubleSided());

  // Copy texture slots
  const baseColor = charMat.getBaseColorTexture();
  if (baseColor && textureMap.has(baseColor)) {
    bikeMat.setBaseColorTexture(textureMap.get(baseColor));
  }
  const emissive = charMat.getEmissiveTexture();
  if (emissive && textureMap.has(emissive)) {
    bikeMat.setEmissiveTexture(textureMap.get(emissive));
  }
  const normal = charMat.getNormalTexture();
  if (normal && textureMap.has(normal)) {
    bikeMat.setNormalTexture(textureMap.get(normal));
  }

  materialMap.set(charMat, bikeMat);
}

// ── Copy character meshes into bike document ──

const meshMap = new Map();
for (const charMesh of charRoot.listMeshes()) {
  const bikeMesh = bikeDoc.createMesh(charMesh.getName());

  for (const charPrim of charMesh.listPrimitives()) {
    const bikePrim = bikeDoc.createPrimitive();
    bikePrim.setMode(charPrim.getMode());

    // Copy indices
    const charIndices = charPrim.getIndices();
    if (charIndices) {
      const bikeAcc = bikeDoc.createAccessor()
        .setType(charIndices.getType())
        .setArray(charIndices.getArray().slice());
      bikePrim.setIndices(bikeAcc);
    }

    // Copy vertex attributes
    for (const semantic of charPrim.listSemantics()) {
      const charAcc = charPrim.getAttribute(semantic);
      if (charAcc) {
        const bikeAcc = bikeDoc.createAccessor()
          .setType(charAcc.getType())
          .setArray(charAcc.getArray().slice());
        bikePrim.setAttribute(semantic, bikeAcc);
      }
    }

    // Map material
    const charMat = charPrim.getMaterial();
    if (charMat && materialMap.has(charMat)) {
      bikePrim.setMaterial(materialMap.get(charMat));
    }

    bikeMesh.addPrimitive(bikePrim);
  }

  meshMap.set(charMesh, bikeMesh);
}

// ── Add character nodes to the bike scene ──

const bikeScene = bikeRoot.listScenes()[0];

// Create a parent transform node for the rider
const riderParent = bikeDoc.createNode('Rider')
  .setTranslation([OFFSET_X, OFFSET_Y, OFFSET_Z])
  .setScale([SCALE, SCALE, SCALE])
  .setRotation(quaternionFromEulerX(LEAN_X));

// Recreate character node hierarchy under the rider parent
function addCharNodes(charNode, parentBikeNode) {
  const bikeNode = bikeDoc.createNode(charNode.getName());

  // Copy transform
  bikeNode.setTranslation(charNode.getTranslation());
  bikeNode.setRotation(charNode.getRotation());
  bikeNode.setScale(charNode.getScale());

  // Map mesh
  const charMesh = charNode.getMesh();
  if (charMesh && meshMap.has(charMesh)) {
    bikeNode.setMesh(meshMap.get(charMesh));
  }

  parentBikeNode.addChild(bikeNode);

  // Recurse children
  for (const child of charNode.listChildren()) {
    addCharNodes(child, bikeNode);
  }
}

// Find root nodes of the character scene
const charScene = charRoot.listScenes()[0];
for (const rootNode of charScene.listChildren()) {
  addCharNodes(rootNode, riderParent);
}

bikeScene.addChild(riderParent);

// ── Write output ──
await io.write(OUTPUT_PATH, bikeDoc);
console.log(`Wrote: ${OUTPUT_PATH}`);

// Verify
const verify = await io.read(OUTPUT_PATH);
const meshes = verify.getRoot().listMeshes();
console.log(`\nMeshes in output (${meshes.length}):`);
meshes.forEach((m, i) => console.log(`  [${i}] ${m.getName()}`));

const scene = verify.getRoot().listScenes()[0];
console.log(`\nScene bbox: min=${scene.getBounds().min.join(', ')} max=${scene.getBounds().max.join(', ')}`);

// ── Helper ──
function quaternionFromEulerX(angleRad) {
  // Quaternion from rotation around X axis
  const half = angleRad / 2;
  return [Math.sin(half), 0, 0, Math.cos(half)];
}
