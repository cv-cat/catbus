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
// 发丝网格：很疏的细线网格，越往边缘越淡；鼠标附近网格微微亮起，搜索时一道光沿网格扫过
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 m=P(u_mouse);vec2 O=originP();float t=u_time;
  float cell=u_res.y/6.5;
  vec2 g=abs(fract(gl_FragCoord.xy/cell+0.5)-0.5)*cell;
  float ln=1.0-smoothstep(0.4,1.1,min(g.x,g.y));
  float mask=1.0-smoothstep(0.25,1.05,length((p-vec2(0.25,0.25))*vec2(0.75,1.0)));
  float a=(0.05+0.04*u_dark)*mask;
  float near=exp(-pow(length(p-m)/0.2,2.0));
  float q=mod(t,5.0);float r=0.02+1.2*(1.0-exp(-q*1.1));float fa=pow(1.0-smoothstep(0.0,2.6,q),1.5);
  float wave=exp(-pow((length(p-O)-r)/0.05,2.0))*fa;
  a+=0.14*near+0.28*wave;
  vec3 col=u_bg;
  col=mix(col,u_red,(0.04+0.06*u_dark)*exp(-length(p-O)*2.0));
  col=mix(col,mix(u_ink,u_red,clamp(near*0.7+wave,0.0,1.0)),ln*clamp(a,0.0,1.0));
  col+=grain()*0.01;
  gl_FragColor=vec4(col,1.0);
}
