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
// A + C：纯色 + 搜索框附近一团呼吸的暖光；点击 / 搜索时像水面一样漾开一道浅浅的凹凸波纹
float wave(vec2 p,vec2 c,float t,float period,float rmax,float k,float w){
  float q=mod(t,period);float r=0.01+rmax*(1.0-exp(-q*k));float a=pow(1.0-smoothstep(0.0,period*0.6,q),1.4);
  float x=(length(p-c)-r)/(w*(1.0+r*1.2));
  return -x*exp(-x*x)*a;
}
float hgt(vec2 p,vec2 O,vec2 m,float t){
  return wave(p,O,t,5.0,0.9,1.2,0.022)+0.6*wave(p,O,t-0.22,5.0,0.9,1.2,0.022)+0.7*wave(p,m,t,2.2,0.16,2.4,0.012);
}
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 m=P(u_mouse);vec2 O=originP();float t=u_time;
  vec3 col=u_bg;
  col=mix(col,u_ink,(0.035-0.02*u_dark)*smoothstep(0.6,-0.6,p.y));
  float br=0.88+0.12*sin(t*0.45);
  vec2 L=O+vec2(0.1,0.12);float d=length(p-L);
  col=mix(col,u_red,(0.15+0.10*u_dark)*br*exp(-d*d*2.4));
  col=mix(col,u_gold,0.05*br*exp(-d*d*7.0));
  float e=1.5/u_res.y;float h=hgt(p,O,m,t);
  vec2 g=vec2(hgt(p+vec2(e,0.0),O,m,t)-h,hgt(p+vec2(0.0,e),O,m,t)-h)/e;
  float lit=dot(g,normalize(vec2(-0.6,0.8)))*0.012;
  col+=clamp(lit,-1.0,1.0)*(0.9-0.5*u_dark);
  col=mix(col,u_red,clamp(abs(h),0.0,1.0)*0.06);
  col+=grain()*0.01;
  gl_FragColor=vec4(col,1.0);
}
