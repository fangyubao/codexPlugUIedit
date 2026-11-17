#include "host.hpp"
#include <string>
#include <vector>
#include <fstream>
#include <sstream>
#include <map>

uint32_t host_tick=0;
PageManager page(PAGE_MAX);
BMPData BMP180;
lv_obj_t *host_root=nullptr;
const char *host_page="DialPlate";
static std::vector<uint32_t> framebuffer(135*240,0xff000000);
static lv_color_t draw_buffer[135*24];
struct SourceTag{std::string file;int line;int instance;};
static std::map<lv_obj_t*,SourceTag> tags;
static std::map<std::string,int> site_counts;
lv_obj_t *studio_tag(lv_obj_t*obj,const char*file,int line){std::string key=std::string(file)+":"+std::to_string(line);tags[obj]={file,line,site_counts[key]++};return obj;}
static void flush(lv_disp_drv_t *drv,const lv_area_t *a,lv_color_t *pixels){
    int index=0;
    for(int y=a->y1;y<=a->y2;y++)for(int x=a->x1;x<=a->x2;x++,index++)if(x>=0&&x<135&&y>=0&&y<240)framebuffer[y*135+x]=lv_color_to32(pixels[index]);
    lv_disp_flush_ready(drv);
}
void PageDelay(uint32_t ms){for(uint32_t n=0;n<ms;n+=10){host_tick+=10;lv_tick_inc(10);lv_task_handler();}}
lv_obj_t *AppWindow_GetCont(uint8_t){return host_root;}
void AppWindow_Create(){host_root=lv_cont_create(lv_scr_act(),nullptr);lv_obj_set_size(host_root,135,240);lv_cont_set_fit(host_root,LV_FIT_NONE);static lv_style_t s;s=lv_style_plain;s.body.main_color=s.body.grad_color=LV_COLOR_BLACK;lv_cont_set_style(host_root,LV_CONT_STYLE_MAIN,&s);}
std::string escape(const char *s){std::string out="\"";for(const unsigned char*c=(const unsigned char*)s;*c;c++){if(*c=='"'||*c=='\\'){out+='\\';out+=*c;}else if(*c<32){char b[8];snprintf(b,sizeof(b),"\\u%04x",*c);out+=b;}else out+=*c;}return out+'"';}
std::string kind(lv_obj_t *o){lv_obj_type_t type;lv_obj_get_type(o,&type);return type.type[0]?type.type[0]:"lv_obj";}
std::map<std::string,lv_obj_t*> objects;
std::vector<std::pair<std::string,lv_obj_t*>> object_order;
void enumerate(lv_obj_t *o,const std::string&id){objects[id]=o;object_order.push_back({id,o});int index=0;for(lv_obj_t*c=lv_obj_get_child_back(o,nullptr);c;c=lv_obj_get_child_back(o,c))enumerate(c,id+"_"+std::to_string(index++));}
void write_tree(const char *filename){
    std::ofstream out(filename);out<<"[";bool first=true;
    for(auto&entry:object_order){auto*o=entry.second;auto k=kind(o);if(!first)out<<",";first=false;const lv_style_t*s=lv_obj_get_style(o);char color[16],bg[16],border[16];snprintf(color,sizeof(color),"#%06x",lv_color_to32(s->text.color)&0xffffff);snprintf(bg,sizeof(bg),"#%06x",lv_color_to32(s->body.main_color)&0xffffff);snprintf(border,sizeof(border),"#%06x",lv_color_to32(s->body.border.color)&0xffffff);
    auto pos=entry.first.rfind('_');std::string parent=pos==std::string::npos?"":entry.first.substr(0,pos);
    auto tag=tags.find(o);std::string source=tag==tags.end()?"":tag->second.file;int line=tag==tags.end()?0:tag->second.line,instance=tag==tags.end()?0:tag->second.instance;
    out<<"{\"id\":"<<escape(entry.first.c_str())<<",\"sourceFile\":"<<escape(source.c_str())<<",\"sourceLine\":"<<line<<",\"instance\":"<<instance<<",\"parent\":"<<escape(parent.c_str())<<",\"kind\":"<<escape(k.c_str())<<",\"x\":"<<lv_obj_get_x(o)<<",\"y\":"<<lv_obj_get_y(o)<<",\"width\":"<<lv_obj_get_width(o)<<",\"height\":"<<lv_obj_get_height(o)<<",\"visible\":"<<(lv_obj_get_hidden(o)?"false":"true")<<",\"color\":"<<escape(color)<<",\"background\":"<<escape(bg)<<",\"border\":"<<escape(border)<<",\"radius\":"<<(int)s->body.radius<<",\"fontSize\":"<<(int)s->text.font->line_height<<",\"text\":"<<escape(k=="lv_label"?lv_label_get_text(o):"")<<"}";
    }out<<"]";
}
void bmp(const char *name){std::ofstream f(name,std::ios::binary);uint32_t size=54+135*240*4,offset=54,header=40,width=135,height=240,zero=0;uint16_t signature=0x4d42,one=1,bits=32;f.write((char*)&signature,2);f.write((char*)&size,4);f.write((char*)&zero,4);f.write((char*)&offset,4);f.write((char*)&header,4);f.write((char*)&width,4);f.write((char*)&height,4);f.write((char*)&one,2);f.write((char*)&bits,2);for(int i=0;i<6;i++)f.write((char*)&zero,4);for(int y=239;y>=0;y--)f.write((char*)&framebuffer[y*135],135*4);}
void apply(const char *name){std::ifstream f(name);std::string line;while(std::getline(f,line)){std::istringstream row(line);std::string id,key,value;std::getline(row,id,'\t');std::getline(row,key,'\t');std::getline(row,value);auto it=objects.find(id);if(it==objects.end())continue;auto*o=it->second;int n=atoi(value.c_str());
    if(key=="x"){lv_obj_set_auto_realign(o,false);lv_obj_set_x(o,n);}else if(key=="y"){lv_obj_set_auto_realign(o,false);lv_obj_set_y(o,n);}else if(key=="width")lv_obj_set_width(o,n);else if(key=="height")lv_obj_set_height(o,n);else if(key=="visible")lv_obj_set_hidden(o,n==0);else if(key=="text"&&kind(o)=="lv_label"){std::string decoded;for(size_t i=0;i+1<value.size();i+=2)decoded+=char(strtol(value.substr(i,2).c_str(),nullptr,16));lv_label_set_text(o,decoded.c_str());}
    else {auto*s=(lv_style_t*)lv_mem_alloc(sizeof(lv_style_t));*s=*lv_obj_get_style(o);if(key=="color")s->text.color=lv_color_hex(strtoul(value.c_str(),nullptr,16));if(key=="background")s->body.main_color=s->body.grad_color=lv_color_hex(strtoul(value.c_str(),nullptr,16));if(key=="border")s->body.border.color=lv_color_hex(strtoul(value.c_str(),nullptr,16));if(key=="radius")s->body.radius=n;lv_obj_set_style(o,s);}
}}
extern void PageRegister_DialPlate(uint8_t);extern void PageRegister_MainMenu(uint8_t);extern void PageRegister_TimeCfg(uint8_t);extern void PageRegister_Backlight(uint8_t);extern void PageRegister_StopWatch(uint8_t);extern void PageRegister_Altitude(uint8_t);extern void PageRegister_About(uint8_t);
int main(int argc,char **argv){if(argc<5)return 2;host_page=argv[1];lv_init();static lv_disp_buf_t buffer;lv_disp_buf_init(&buffer,draw_buffer,nullptr,135*24);lv_disp_drv_t drv;lv_disp_drv_init(&drv);drv.buffer=&buffer;drv.flush_cb=flush;drv.hor_res=135;drv.ver_res=240;lv_disp_drv_register(&drv);lv_theme_set_current(lv_theme_night_init(200,nullptr));AppWindow_Create();
    if(!strcmp(host_page,"DialPlate"))PageRegister_DialPlate(1);else if(!strcmp(host_page,"MainMenu"))PageRegister_MainMenu(1);else if(!strcmp(host_page,"TimeCfg"))PageRegister_TimeCfg(1);else if(!strcmp(host_page,"Backlight"))PageRegister_Backlight(1);else if(!strcmp(host_page,"StopWatch"))PageRegister_StopWatch(1);else if(!strcmp(host_page,"Altitude"))PageRegister_Altitude(1);else if(!strcmp(host_page,"About"))PageRegister_About(1);else return 3;
    page.PagePush(1);page.Running();PageDelay(2500);enumerate(host_root,"root");if(argc>5)apply(argv[5]);lv_obj_invalidate(lv_scr_act());lv_refr_now(nullptr);write_tree(argv[2]);bmp(argv[3]);return 0;
}
