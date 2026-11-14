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

void pigment(inout vec3 col,vec2 p,vec2 c,float r,float seed,vec3 C,float amt){
  float w=fbm(p*2.2+seed+vec2(u_time*0.025,-u_time*0.02))-0.5;
  float d=length(p-c)+w*0.45-r;
  float dens=smoothstep(0.06,-0.28,d);
  float edge=exp(-pow(d/0.014,2.0));
  float gran=0.75+0.5*noise(p*180.0+seed);
  float a=clamp((dens*0.22+edge*0.20)*gran*amt,0.0,0.9);
  vec3 sub=col*mix(vec3(1.0),C,a*1.25);
  vec3 add=mix(col,C,a*0.85);
  col=mix(sub,add,u_dark);
}
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 m=P(u_mouse);vec2 O=originP();float t=u_time;
  vec3 col=u_bg;
  float fiber=fbm(p*vec2(60.0,9.0))*0.6+fbm(p*vec2(9.0,60.0))*0.4;
  col*=1.0-(fiber-0.5)*0.05*(1.0-u_dark*0.4);
  pigment(col,p,vec2(-0.45+0.08*sin(t*0.21),0.18+0.06*cos(t*0.17)),0.30,1.0,u_red,1.0);
  pigment(col,p,vec2(0.5+0.07*cos(t*0.19),-0.15+0.08*sin(t*0.23)),0.34,7.0,u_blue,1.0);
  pigment(col,p,vec2(0.05+0.1*sin(t*0.13),0.42+0.05*sin(t*0.29)),0.20,13.0,u_gold,0.9);
  float ph=mod(t,2.6);pigment(col,p,m,0.02+0.13*(1.0-exp(-ph*2.0)),21.0,u_red,(1.0-ph/2.6)*1.2);
  for(int i=0;i<3;i++){
    float fi=float(i);float q=mod(t-fi*0.25,6.0);
    vec3 C=i==0?u_red:(i==1?u_blue:u_gold);
    pigment(col,p,O+vec2(-0.1*fi,-0.06*fi),0.05+0.55*(1.0-exp(-q*1.4)),31.0+fi*5.0,C,(1.0-smoothstep(1.5,6.0,q))*1.1);
  }
  col+=grain()*0.03;
  gl_FragColor=vec4(col,1.0);
}
