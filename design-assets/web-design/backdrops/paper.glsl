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
// 纸：几乎看不见的纸纹，被鼠标当作光源轻轻照亮；搜索时像在纸上压出一道浅浅的圆痕
float hgt(vec2 p,vec2 O,float t){
  float h=0.55*fbm(p*14.0)+0.25*fbm(p*vec2(110.0,14.0));
  float q=mod(t,5.0);float r=0.02+0.8*(1.0-exp(-q*1.2));float a=pow(1.0-smoothstep(0.0,3.0,q),1.4);
  h-=0.9*exp(-pow((length(p-O)-r)/0.012,2.0))*a;
  return h;
}
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 m=P(u_mouse);vec2 O=originP();float t=u_time;float e=1.5/u_res.y;
  float h=hgt(p,O,t);
  vec2 g=vec2(hgt(p+vec2(e,0.0),O,t)-h,hgt(p+vec2(0.0,e),O,t)-h)/e;
  vec3 n=normalize(vec3(-g*0.012,1.0));
  vec3 Ld=normalize(vec3(m-p,0.55));
  float lit=dot(n.xy,Ld.xy);
  vec3 col=u_bg;
  col=mix(col,u_red,(0.05+0.06*u_dark)*exp(-length(p-m)*3.5));
  col+=lit*(0.09-0.04*u_dark);
  col*=1.0-(0.05+0.08*u_dark)*dot(p,p);
  col+=grain()*0.01;
  gl_FragColor=vec4(col,1.0);
}
