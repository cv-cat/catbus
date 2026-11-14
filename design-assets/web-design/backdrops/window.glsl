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

float ridge(float x,float seed,float f){return fbm(vec2(x*f,seed))*0.9+0.08*noise(vec2(x*f*6.0,seed+3.0));}
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 uv=gl_FragCoord.xy/u_res;float t=u_time;
  float per=6.0;float ph=mod(t,per);float x=ph/2.0;
  float boost=(floor(t/per)+smoothstep(0.0,1.0,x))*1.6;
  float spd=x<1.0?6.0*x*(1.0-x):0.0;
  float off=t*0.06+boost;
  vec3 sky=mix(mix(u_bg,vec3(1.0),0.55-0.55*u_dark),u_bg,smoothstep(-0.1,0.5,p.y));
  sky=mix(sky,u_red,(0.10+0.12*u_dark)*exp(-length(p-vec2(0.62,0.22))*2.6));
  vec3 col=sky;
  float sun=length(p-vec2(0.62,0.22));
  col=mix(col,mix(u_gold,vec3(1.0),0.35-0.35*u_dark),(1.0-smoothstep(0.075,0.08,sun))*0.55);
  for(int i=0;i<4;i++){
    float fi=float(i);float sp=0.2+fi*fi*0.45;
    float base=0.02-fi*0.13;float amp=0.22-fi*0.025;
    float h=base+amp*ridge(p.x+off*sp,fi*11.0,1.3+fi*0.5);
    vec3 C=i==0?u_blue:(i==1?mix(u_blue,u_ink,0.5):(i==2?u_ink:mix(u_ink,u_red,0.35)));
    float haze=0.16+fi*0.17+0.08*u_dark;
    float inside=1.0-smoothstep(-0.0015,0.0015,p.y-h);
    vec3 lc=mix(sky,C,haze);
    lc=mix(lc,sky,0.25*smoothstep(0.0,-0.25,p.y-h)*(1.0-fi/4.0));
    col=mix(col,lc,inside);
    col=mix(col,mix(lc,vec3(1.0),0.5-0.3*u_dark),exp(-pow((p.y-h)/0.003,2.0))*0.35*inside);
  }
  float gap=0.95;float xx=mod(p.x+off*2.6,gap);
  float pole=(1.0-smoothstep(0.004,0.007,abs(xx-0.02)))*step(p.y,0.3);
  col=mix(col,mix(u_ink,u_bg,0.25*u_dark),pole*(0.55+0.15*u_dark));
  for(int k=0;k<2;k++){
    float yy=0.28-float(k)*0.035-0.06*(1.0-pow((xx-0.02-gap*0.5)/(gap*0.5),2.0));
    col=mix(col,u_ink,(1.0-smoothstep(0.0012,0.0028,abs(p.y-yy)))*0.35);
  }
  for(int k=0;k<6;k++){
    float fk=float(k);float y=0.42-fk*0.12+0.03*sin(fk*3.1);
    float sx=mod(-p.x*0.6-t*(0.9+fk*0.13)-fk*0.37,1.6);
    float s=exp(-pow((p.y-y)/0.002,2.0))*smoothstep(0.0,0.05,sx)*(1.0-smoothstep(0.05,0.4,sx));
    col=mix(col,mix(u_red,vec3(1.0),0.2),s*spd*0.7);
  }
  float sheen=exp(-pow((uv.x+uv.y*0.6-0.55-0.05*sin(t*0.2))/0.07,2.0));
  col=mix(col,vec3(1.0),sheen*(0.10-0.06*u_dark));
  vec2 c=uv-0.5;float vig=smoothstep(0.85,0.35,length(c*vec2(1.0,1.3)));
  col*=mix(0.9,1.0,vig);
  col+=grain()*0.03;
  gl_FragColor=vec4(col,1.0);
}
