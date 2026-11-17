#pragma once
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <cmath>
#include <algorithm>
#include "lvgl/lvgl.h"
#include "PageManager/PageManager.h"
#include "Basic/CommonMacro.h"

template<class T,class L,class H> T constrain(T x,L lo,H hi){return x<lo?T(lo):x>hi?T(hi):x;}
inline long map(long x,long a,long b,long c,long d){return (x-a)*(d-c)/(b-a)+c;}
inline float fmap(float x,float a,float b,float c,float d){return (x-a)*(d-c)/(b-a)+c;}
extern uint32_t host_tick;
inline uint32_t millis(){return host_tick;}
enum {PAGE_NONE,PAGE_DialPlate,PAGE_MainMenu,PAGE_TimeCfg,PAGE_Backlight,PAGE_StopWatch,PAGE_Altitude,PAGE_About,PAGE_Game,PAGE_MAX};
extern PageManager page;
extern lv_obj_t *host_root;
extern const char *host_page;
void AppWindow_Create();
lv_obj_t *studio_tag(lv_obj_t*,const char*,int);
lv_obj_t *AppWindow_GetCont(uint8_t);
inline lv_coord_t AppWindow_GetHeight(){return 240;}
inline lv_coord_t AppWindow_GetWidth(){return 135;}
#define APP_WIN_HEIGHT AppWindow_GetHeight()
#define APP_WIN_WIDTH AppWindow_GetWidth()
#define LV_ANIM_TIME_DEFAULT 200
#define LV_SYMBOL_DEGREE_SIGN "\xC2\xB0"
void PageDelay(uint32_t ms);
bool lv_obj_del_safe(lv_obj_t **obj);
void lv_label_set_text_add(lv_obj_t*,const char*);
lv_coord_t lv_obj_get_x_center(lv_obj_t*);
lv_coord_t lv_obj_get_y_center(lv_obj_t*);
void lv_obj_set_color(lv_obj_t*,lv_color_t);
void lv_table_set_align(lv_obj_t*,lv_label_align_t);
lv_obj_t *lv_win_get_label(lv_obj_t*);
void lv_obj_add_anim(lv_obj_t*,lv_anim_t*,lv_anim_exec_xcb_t,int32_t,int32_t,uint16_t=200,lv_anim_ready_cb_t=nullptr,lv_anim_path_cb_t=lv_anim_path_ease_out);
#define LV_OBJ_ADD_ANIM(obj,attr,target,time) do{static lv_anim_t a;lv_obj_add_anim(obj,&a,(lv_anim_exec_xcb_t)lv_obj_set_##attr,lv_obj_get_##attr(obj),target,time);}while(0)
#define PageWaitUntil(condition) while(!(condition)){PageDelay(10);}
struct RTC_TimeTypeDef {uint8_t RTC_Hours,RTC_Minutes,RTC_Seconds;};
struct RTC_DateTypeDef {uint8_t RTC_Year,RTC_Month,RTC_Date,RTC_WeekDay;};
enum {RTC_Format_BIN=0,BAT_DET_Pin=0,BAT_CHG_Pin=1,KEY_UP_Pin=2,KEY_OK_Pin=3,KEY_DOWN_Pin=4};
inline void RTC_GetTime(int,RTC_TimeTypeDef*t){*t={10,8,30};}
inline void RTC_GetDate(int,RTC_DateTypeDef*d){*d={26,11,16,1};}
inline void RTC_SetTime(int,RTC_TimeTypeDef*){}
inline void RTC_SetDate(int,RTC_DateTypeDef*){}
inline void RTCx_GetWeekDay(RTC_DateTypeDef*d){d->RTC_WeekDay=1;}
inline int analogRead_DMA(int){return 2400;}
inline int digitalRead(int){return 1;}
struct BMPData {float temperature=24.5f,altitude=128.0f,pressure=101325.0f;};
extern BMPData BMP180;
inline void BMP_Update(){}
inline void Power_SetAutoLowPowerEnable(bool){}
inline uint16_t Power_GetAutoLowPowerTimeout(){return 30;}
inline void Power_SetAutoLowPowerTimeout(uint16_t){}
inline int Backlight_GetValue(){return 650;}
inline void Backlight_SetValue(int){}
struct HostButton {int pin;};
inline HostButton btUP{KEY_UP_Pin},btOK{KEY_OK_Pin},btDOWN{KEY_DOWN_Pin};
enum{STOPWATCH_TIM=0,ENABLE=1,DISABLE=0};
inline void Timer_SetInterrupt(int,int,void(*)()){}
inline void TIM_Cmd(int,int){}
struct ButtonEvent {enum{EVENT_ButtonClick,EVENT_ButtonLongPressed,EVENT_ButtonPress,EVENT_ButtonLongPressRepeat};int GetID(){return 0;}int GetPin(){return 0;}};
inline int Button_GetID(void*){return 0;}
inline int Button_GetPin(void*){return KEY_UP_Pin;}
#define WX_NAME "WatchX"
#define WX_SOFTWARE_VERSION "v1.0"
#define WX_HARDWARE_VERSION "v2.0"
