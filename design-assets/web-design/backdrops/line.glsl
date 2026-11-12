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
// 一条线：整页只有一条发丝细的线路，终点站是搜索按钮；搜索时一小段红色从终点站发车
float fy(float x,vec2 O){return mix(-0.40,O.y,smoothstep(-0.95,O.x,x))+0.025*sin(x*3.2);}
void main(){
  vec2 p=P(gl_FragCoord.xy);vec2 m=P(u_mouse);vec2 O=originP();float t=u_time;float px=1.0/u_res.y;
  vec3 col=u_bg;
  col=mix(col,u_red,(0.05+0.07*u_dark)*exp(-length(p-O)*2.2));
  float y=fy(p.x,O);float dy=(fy(p.x+0.001,O)-fy(p.x-0.001,O))/0.002;
  float d=abs(p.y-y)/sqrt(1.0+dy*dy);float on=1.0-step(O.x,p.x);
  float near=exp(-pow(length(p-m)/0.16,2.0));
  float line=(1.0-smoothstep(0.5*px,1.5*px,d))*on;
  col=mix(col,mix(u_ink,u_red,near*0.85),line*(0.20+0.10*u_dark+0.30*near));
  float q=mod(t,6.0);float head=O.x-(1.0-exp(-q*0.9))*(O.x+1.1);float vis=1.0-smoothstep(3.6,4.4,q);
  float s=p.x-head;float trail=smoothstep(-0.004,0.0,s)*clamp(1.0-s/0.16,0.0,1.0);
  col=mix(col,u_red,(1.0-smoothstep(0.8*px,2.0*px,d))*on*trail*vis*0.9);
  float st=abs(length(p-O)-0.012);
  col=mix(col,u_ink,(1.0-smoothstep(0.5*px,1.5*px,st))*0.45);
  float a=1.0-smoothstep(0.0,1.4,q);float r=0.012+0.07*(1.0-exp(-q*2.5));
  col=mix(col,u_red,(1.0-smoothstep(0.5*px,1.5*px,abs(length(p-O)-r)))*a*0.6);
  col+=grain()*0.012;
  gl_FragColor=vec4(col,1.0);
}
