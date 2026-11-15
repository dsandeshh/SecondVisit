// GLSL for the photo projection (?view=proj). Injected into the scan's own MeshStandardMaterial with onBeforeCompile,
// so lighting, the emissive lift and the 2 m clipping plane stay exactly as in the baked view; only the texel changes.
// The maths mirrors panoproj.ts (tested there): plan point -> direction from a pano -> svG (plan -> GL cube lookup).
import * as THREE from "three";

/** Panos bound at once (one samplerCube each). The baked map uses one more unit (map and emissiveMap share it). */
export const PROJ_SLOTS = 6;

export type ProjUniforms = {
  svPos: { value: THREE.Vector3[] };
  svG: { value: THREE.Matrix3[] };
  svOn: { value: number[] };
  [cube: `svCube${number}`]: { value: THREE.CubeTexture | null };
};

export function projUniforms(k = PROJ_SLOTS): ProjUniforms {
  const u = {
    svPos: { value: Array.from({ length: k }, () => new THREE.Vector3()) },
    svG: { value: Array.from({ length: k }, () => new THREE.Matrix3()) },
    svOn: { value: new Array(k).fill(0) },
  } as ProjUniforms;
  for (let i = 0; i < k; i++) u[`svCube${i}`] = { value: null };
  return u;
}

/** Fragment helpers: the K cube samplers can only be indexed by constants, so svSample is an unrolled if chain. */
function fragHead(k: number): string {
  const cubes = Array.from({ length: k }, (_, i) => `uniform samplerCube svCube${i};`).join("\n");
  const pick = Array.from({ length: k }, (_, i) => `  if (i == ${i}) return textureGrad(svCube${i}, g, gx, gy);`).join("\n");
  return `
#define SV_K ${k}
${cubes}
uniform vec3 svPos[SV_K];
uniform mat3 svG[SV_K];
uniform float svOn[SV_K];
varying vec3 vSvW;
vec4 svSample(int i, vec3 g, vec3 gx, vec3 gy) {
${pick}
  return vec4(0.0);
}
// Only the four horizon faces are real photos (py / ny are grey placeholders). The GL y axis is the pano's up,
// so a lookup is usable when it is not mostly vertical; the 0.99 keeps linear filtering off the placeholder edge.
bool svHorizon(vec3 g) { return abs(g.y) < 0.99 * max(abs(g.x), abs(g.z)); }
// Stage b: the ONE nearest bound pano, no occlusion. Returns the photo texel, or the baked texel when that pano's
// direction falls on a placeholder face or no pano is bound (never black, never a hole).
vec4 svProject(vec4 baked, out float used) {
  vec3 P = vec3(vSvW.x, -vSvW.z, vSvW.y);          // three (x, y up, -z) -> plan (x, y, z up)
  int best = -1; float bd = 1e9;
  for (int i = 0; i < SV_K; i++) {
    float d = distance(P, svPos[i]);
    if (svOn[i] > 0.5 && d < bd) { bd = d; best = i; }
  }
  used = 0.0;
  int b = max(best, 0);
  vec3 g = svG[b] * (P - svPos[b]);
  vec3 gx = dFdx(g), gy = dFdy(g);                 // before any branch: derivatives need uniform control flow
  if (best < 0 || !svHorizon(g)) return baked;
  used = 1.0;
  return svSample(best, g, gx, gy);
}
`;
}

/** Patch one scan material (it must have a map). Uniform objects are shared, so every material sees the same slots. */
export function patchMaterial(mat: THREE.MeshStandardMaterial, u: ProjUniforms, opts: { debug?: boolean; k?: number } = {}): void {
  const k = opts.k ?? PROJ_SLOTS;
  mat.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = "varying vec3 vSvW;\n" + shader.vertexShader.replace("#include <project_vertex>",
      "#include <project_vertex>\n  vSvW = (modelMatrix * vec4(transformed, 1.0)).xyz;");
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", "#include <common>\n" + fragHead(k))
      .replace("#include <map_fragment>", `
  float svUsed;
  vec4 svTexel = svProject(texture2D(map, vMapUv), svUsed);
  ${opts.debug ? "svTexel.rgb = mix(svTexel.rgb, svUsed > 0.5 ? vec3(0.1, 0.8, 0.2) : vec3(0.9, 0.1, 0.1), 0.35);" : ""}
  diffuseColor *= svTexel;`)
      .replace("#include <emissivemap_fragment>", "totalEmissiveRadiance *= svTexel.rgb;");
  };
  mat.customProgramCacheKey = () => `svproj${k}${opts.debug ? "d" : ""}`;
  mat.needsUpdate = true;
}
