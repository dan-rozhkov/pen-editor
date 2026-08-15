/**
 * Standard PixiJS 8 filter vertex shader, copied verbatim from Pixi's own
 * `blend-template.vert` (see `node_modules/pixi.js/lib/filters/blend-modes/
 * blend-template.vert.mjs`). `GlProgram` auto-prepends the `#version 300 es`
 * header + precision qualifier based on the fragment source (see
 * `glassBackdrop.frag.ts`), so this file intentionally has neither.
 *
 * `uInputSize`/`uOutputFrame`/`uOutputTexture` are global filter uniforms
 * bound automatically by `FilterSystem` — they don't need to be declared as
 * filter `resources`, just declared here by name.
 */
export const glassBackdropVert = /* glsl */ `
in vec2 aPosition;
out vec2 vTextureCoord;

uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;

vec4 filterVertexPosition( void )
{
    vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
    position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
    position.y = position.y * (2.0*uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
    return vec4(position, 0.0, 1.0);
}

vec2 filterTextureCoord( void )
{
    return aPosition * (uOutputFrame.zw * uInputSize.zw);
}

void main(void)
{
    gl_Position = filterVertexPosition();
    vTextureCoord = filterTextureCoord();
}
`;
