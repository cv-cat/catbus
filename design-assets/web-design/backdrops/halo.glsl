precision highp float;
/** @resolution */
uniform vec2 u_res;
/** @time */
uniform float u_time;
/** @mouse */
uniform vec2 u_mouse;
/**
 * @label 背景
 * @color
 * @default #f3f4f7
 */
uniform vec3 u_bg;
/**
 * @label 墨色
 * @color
 * @default #232838
 */
uniform vec3 u_ink;
/**
 * @label 红
 * @color
 * @default #e8414f
 */
uniform vec3 u_red;
/**
 * @label 蓝
 * @color
 * @default #5a6bd8
 */
uniform vec3 u_blue;
/**
 * @label 金
 * @color
 * @default #f0b429
 */
uniform vec3 u_gold;
/**
 * @label 暗色
 * @default 0
 * @range 0, 1
 */
uniform float u_dark;
const vec2 ORIGIN = vec2(0.86, 0.885);
float hash(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}
float noise(vec2 p){vec2 i=floor(p),f=fract(p);vec2 u=f*f*(3.0-2.0*f);return mix(mix(hash(i),hash(i+vec2(1.0,0.0)),u.x),mix(hash(i+vec2(0.0,1.0)),hash(i+vec2(1.0,1.0)),u.x),u.y);}
float fbm(vec2 p){float v=0.0,a=0.5;for(int i=0;i<5;i++){v+=a*noise(p);p=mat2(1.6,1.2,-1.2,1.6)*p;a*=0.5;}return v;}
vec2 P(vec2 frag){return (frag-0.5*u_res)/u_res.y;}
vec2 originP(){return P(ORIGIN*u_res);}
float grain(){return hash(gl_FragCoord.xy+fract(u_time*7.0)*61.0)-0.5;}
// 微光：纯色 + 一团很淡的暖光，缓慢呼吸；搜索时一道细环
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 m=P(u_mouse);vec2 O=originP();float t=u_time;
  vec3 col=u_bg;
  col=mix(col,u_ink,(0.035-0.02*u_dark)*smoothstep(0.6,-0.6,p.y));
  float br=0.88+0.12*sin(t*0.45);
  vec2 L=O+vec2(0.1,0.12);float d=length(p-L);
  col=mix(col,u_red,(0.15+0.10*u_dark)*br*exp(-d*d*2.4));
  col=mix(col,u_gold,0.05*br*exp(-d*d*7.0));
  float md=length(p-m);
  col=mix(col,u_red,(0.035+0.035*u_dark)*exp(-md*md*16.0));
  float q=mod(t,5.0);float r=0.015+0.85*(1.0-exp(-q*1.3));float a=pow(1.0-smoothstep(0.0,2.6,q),1.6);
  col=mix(col,u_red,exp(-pow((length(p-O)-r)*u_res.y/1.1,2.0))*a*0.5);
  col+=grain()*0.012;
  gl_FragColor=vec4(col,1.0);
}
