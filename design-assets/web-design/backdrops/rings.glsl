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

vec3 base(vec2 p){
  float t=u_time*0.05;
  vec2 q=p+0.25*vec2(fbm(p*1.2+t),fbm(p*1.2-t+3.0));
  vec3 c=u_bg;
  c=mix(c,u_red,(0.13+0.14*u_dark)*smoothstep(0.9,0.0,length(q-vec2(0.7,0.45))));
  c=mix(c,u_blue,(0.10+0.14*u_dark)*smoothstep(0.9,0.0,length(q-vec2(-0.75,-0.45))));
  c=mix(c,u_gold,(0.06+0.05*u_dark)*smoothstep(0.6,0.0,length(q-vec2(0.1,-0.6))));
  return c;
}
float ringAt(vec2 p,vec2 c,float r,float w){return exp(-pow((length(p-c)-r)/w,2.0));}
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 m=P(u_mouse);vec2 O=originP();float t=u_time;
  vec2 disp=vec2(0.0);float ring=0.0;
  for(int i=0;i<3;i++){
    float q=mod(t-float(i)*0.16,5.0);float r=0.02+1.1*(1.0-exp(-q*1.1));float a=1.0-smoothstep(0.0,3.2,q);
    float rg=ringAt(p,O,r,0.004)*a;ring+=rg;
    disp+=normalize(p-O+1e-5)*ringAt(p,O,r,0.03)*a*0.012;
  }
  for(int i=0;i<2;i++){
    float q=mod(t-float(i)*0.22,1.8);float r=0.01+0.2*(1.0-exp(-q*2.2));float a=1.0-q/1.8;
    ring+=ringAt(p,m,r,0.003)*a;
    disp+=normalize(p-m+1e-5)*ringAt(p,m,r,0.02)*a*0.008;
  }
  vec3 col=base(p-disp);
  col=mix(col,mix(u_red,vec3(1.0),0.15),clamp(ring,0.0,1.0)*0.75);
  col+=vec3(length(disp))*(2.0-u_dark);
  col+=grain()*0.03;
  gl_FragColor=vec4(col,1.0);
}
