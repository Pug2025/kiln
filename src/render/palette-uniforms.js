// App-owned shader colours use flat vec3 buffers: three's Color/Vector3 upload path boxes
// numeric channels on every visit. Inputs are already linear; WebGL stores them as float32.

/** Copy a linear colour, optionally scaled, into an existing shader vec3. */
export function writeColorVec3(out, color, scale = 1) {
  out[0] = color.r * scale;
  out[1] = color.g * scale;
  out[2] = color.b * scale;
  return out;
}

/** Allocate a shader vec3 once, preserving the colour's linear channel values. */
export function colorVec3(color, scale = 1) {
  return writeColorVec3(new Float32Array(3), color, scale);
}
