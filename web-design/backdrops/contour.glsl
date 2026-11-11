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
vec3 ambient(vec2 p){
  vec3 c=u_bg;
  c=mix(c,u_red,(0.10+0.10*u_dark)*exp(-length(p-vec2(0.75,0.55))*2.2));
  c=mix(c,u_blue,(0.07+0.10*u_dark)*exp(-length(p-vec2(-0.7,-0.5))*2.4));
  return c;
}

float field(vec2 p){
  vec2 q=p*1.35;float t=u_time*0.035;
  float v=fbm(q+vec2(t,-t*0.7)+0.9*fbm(q*0.8-vec2(t*0.6,t)));
  vec2 m=P(u_mouse);float dm=length(p-m);
  v+=0.03*sin(dm*42.0-u_time*4.5)*exp(-dm*7.0);
  float ph=mod(u_time,5.0);float fr=ph*0.7;float dO=length(p-originP());
  v+=0.055*sin((dO-fr)*34.0)*exp(-pow((dO-fr)*7.0,2.0))*(1.0-ph/5.0);
  return v;
}
void main(){
  vec2 p=P(gl_FragCoord.xy);float e=1.0/u_res.y;
  float v=field(p),vx=field(p+vec2(e,0.0)),vy=field(p+vec2(0.0,e));
  vec2 g=vec2(vx-v,vy-v)/e;float K=13.0;float L=v*K;float gl=max(length(g)*K*e,1e-5);
  float band=floor(L);
  vec3 col=ambient(p);
  vec3 tint=mix(u_blue,u_gold,smoothstep(0.35,0.75,v));
  col=mix(col,tint,(0.035+0.03*u_dark)*mod(band,3.0));
  vec2 n=normalize(g+1e-6);
  float slope=dot(n,normalize(vec2(-0.6,0.8)));
  col*=1.0+0.035*slope*(1.0-u_dark*0.5);
  float dist=abs(fract(L+0.5)-0.5)/gl;
  bool idx=mod(band+(fract(L)>0.5?1.0:0.0),5.0)<0.5;
  float w=idx?1.35:0.7;
  float ln=1.0-smoothstep(w-0.6,w+0.6,dist);
  vec3 lc=idx?mix(u_ink,u_red,0.75):u_ink;
  col=mix(col,lc,ln*(idx?0.55:0.20+0.12*u_dark));
  float sh=1.0-smoothstep(0.0,3.0,abs(fract(L+0.5)-0.5)/gl-1.0);
  col=mix(col,vec3(0.0),sh*0.035*(1.0-u_dark)*step(0.0,-slope));
  col+=grain()*0.03;
  gl_FragColor=vec4(col,1.0);
}
