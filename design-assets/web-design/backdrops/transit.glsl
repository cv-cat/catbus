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

vec3 seg(vec2 p,vec2 a,vec2 b,float s0){vec2 pa=p-a,ba=b-a;float l=length(ba);float h=clamp(dot(pa,ba)/max(l*l,1e-6),0.0,1.0);return vec3(length(pa-ba*h),s0+h*l,l);}
vec3 route(vec2 p,vec2 a,vec2 b,vec2 c,vec2 d,vec2 e,vec2 f){
  vec2 best=vec2(1e9,0.0);float s=0.0;vec3 r;
  r=seg(p,a,b,s);if(r.x<best.x)best=r.xy;s+=r.z;
  r=seg(p,b,c,s);if(r.x<best.x)best=r.xy;s+=r.z;
  r=seg(p,c,d,s);if(r.x<best.x)best=r.xy;s+=r.z;
  r=seg(p,d,e,s);if(r.x<best.x)best=r.xy;s+=r.z;
  r=seg(p,e,f,s);if(r.x<best.x)best=r.xy;s+=r.z;
  return vec3(best,s);
}
void line(inout vec3 col,vec2 p,vec3 R,vec3 C,float speed,float phase,float wave){
  float px=1.4/u_res.y;float w=0.0072;
  float body=1.0-smoothstep(w-px,w+px,R.x);
  float casing=1.0-smoothstep(w+0.004-px,w+0.004+px,R.x);
  float halo=exp(-R.x*R.x/0.0009);
  col=mix(col,mix(u_bg,vec3(1.0),0.6-0.5*u_dark),casing*0.8);
  col=mix(col,mix(u_bg,C,0.34+0.16*u_dark),body);
  float L=R.z+0.8;
  for(int k=0;k<2;k++){
    float head=mod(u_time*speed+phase+float(k)*L*0.5,L)-0.4;
    float ds=head-R.y;
    float tr=ds>0.0?exp(-ds*9.0)*step(ds,0.45):exp(-ds*ds*6000.0);
    col=mix(col,C*(1.08+0.15*u_dark),clamp(tr*(body+0.55*halo),0.0,1.0));
  }
  col=mix(col,C*1.1,clamp(wave*(body+0.5*halo),0.0,1.0));
}
void station(inout vec3 col,vec2 p,vec2 c,vec2 m){
  float px=1.4/u_res.y;float d=length(p-c);float r=0.0165;
  float hov=exp(-dot(m-c,m-c)/0.012);
  float fill=1.0-smoothstep(r-px,r+px,d);
  float ring=1.0-smoothstep(0.0032-px,0.0032+px,abs(d-r));
  col=mix(col,vec3(0.0),0.10*exp(-pow(max(d-r,0.0)/0.012,2.0))*(1.0-u_dark));
  col=mix(col,mix(mix(vec3(1.0),u_bg,0.35+0.6*u_dark),u_red,hov*0.85),fill);
  col=mix(col,mix(u_ink,u_red,hov),ring*(0.7+0.3*hov));
  float ph=fract(u_time*0.7);float pr=r+0.05*ph;
  col=mix(col,u_red,hov*(1.0-smoothstep(0.0,px*2.0,abs(d-pr)))*(1.0-ph)*0.8);
}
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 m=P(u_mouse);vec2 O=originP();
  vec3 col=ambient(p);
  float rv=abs(p.y-(-0.06+0.10*sin(p.x*2.3+0.7)+0.03*sin(p.x*7.0)))-0.045-0.01*sin(p.x*5.0+1.0);
  col=mix(col,u_blue,(0.08+0.06*u_dark)*(1.0-smoothstep(-0.003,0.003,rv)));
  col=mix(col,u_blue,0.12*exp(-rv*rv/0.00002)*(1.0-u_dark*0.3));
  float ph=mod(u_time,5.0);float front=ph*0.75;float dO=length(p-O);
  float wave=exp(-pow((dO-front)*14.0,2.0))*(1.0-ph/5.0);
  col=mix(col,u_red,wave*0.07);
  vec3 R1=route(p,vec2(-1.2,0.2),vec2(-0.45,0.2),vec2(-0.25,0.0),vec2(0.3,0.0),vec2(0.5,0.2),vec2(1.2,0.2));
  vec3 R2=route(p,vec2(-0.58,0.7),vec2(-0.58,-0.08),vec2(-0.4,-0.26),vec2(0.18,-0.26),vec2(0.18,-0.7),vec2(0.18,-0.7));
  vec3 R3=route(p,vec2(0.06,0.7),vec2(0.06,0.32),vec2(-0.1,0.16),vec2(-0.1,-0.7),vec2(-0.1,-0.7),vec2(-0.1,-0.7));
  vec3 R4=route(p,vec2(-1.2,-0.42),vec2(0.38,-0.42),vec2(0.54,-0.26),vec2(1.2,-0.26),vec2(1.2,-0.26),vec2(1.2,-0.26));
  line(col,p,R4,mix(u_ink,vec3(0.6),0.25*u_dark),0.16,1.3,wave);
  line(col,p,R3,u_gold,0.13,0.5,wave);
  line(col,p,R2,u_blue,0.15,2.1,wave);
  line(col,p,R1,u_red,0.18,0.0,wave);
  station(col,p,vec2(-0.45,0.2),m);station(col,p,vec2(-0.1,0.0),m);station(col,p,vec2(0.3,0.0),m);
  station(col,p,vec2(-0.58,0.2),m);station(col,p,vec2(-0.1,-0.26),m);station(col,p,vec2(0.18,-0.26),m);
  station(col,p,vec2(0.06,0.32),m);station(col,p,vec2(0.18,-0.42),m);station(col,p,vec2(0.54,-0.26),m);
  station(col,p,vec2(-0.58,-0.42),m);station(col,p,vec2(0.62,0.2),m);
  col+=grain()*0.025;
  gl_FragColor=vec4(col,1.0);
}
