precision mediump float;

/** @resolution */
uniform vec2 u_resolution;
/** @mouse */
uniform vec2 u_mouse;
/** @time */
uniform float u_time;

/**
 * @label Background
 * @color
 * @default #F4F5F8
 */
uniform vec3 u_bg;
/**
 * @label Dot Color
 * @color
 * @default #232838
 */
uniform vec3 u_dot;
/**
 * @label Accent
 * @color
 * @default #E8414F
 */
uniform vec3 u_accent;
/**
 * @label Spacing
 * @default 22
 * @range 8, 64
 */
uniform float u_spacing;
/**
 * @label Base Opacity
 * @default 0.14
 * @range 0, 1
 */
uniform float u_base;
/**
 * @label Hover Radius
 * @default 220
 * @range 40, 600
 */
uniform float u_radius;

void main() {
  vec2 p = gl_FragCoord.xy;
  vec2 cell = floor(p / u_spacing);
  vec2 center = (cell + 0.5) * u_spacing;
  float d = distance(center, u_mouse);
  float near = 1.0 - smoothstep(0.0, u_radius, d);
  float wave = 0.5 + 0.5 * sin(center.x * 0.012 + center.y * 0.008 - u_time * 1.2);
  float r = u_spacing * (0.07 + 0.05 * wave + 0.16 * near);
  float dot = 1.0 - smoothstep(r - 0.8, r + 0.8, distance(p, center));
  float a = dot * (u_base * (0.6 + 0.4 * wave) + 0.75 * near);
  vec3 c = mix(u_dot, u_accent, near * near);
  gl_FragColor = vec4(mix(u_bg, c, a), 1.0);
}
