/**
 * Smart Survival Router V2
 * 気象ハザード（猛暑・酷暑・強風・雨）に基づき交通手段を動的に選択する
 */

// ==========================================
// 1. 設定部分（ご自身の環境に合わせて変更してください）
// ==========================================
const HOME_ADDRESS = '東京都〇〇区〇〇 1-2-3'; // ★ご自身の自宅住所を入力
const BUFFER_MINUTES = 5; // 目的地への到着余裕時間（分）
const WEATHER_CALENDAR_ID = 'your_weather_calendar_id@group.calendar.google.com'; // ★天気情報が入っているカレンダーID
const DAYS_TO_CHECK = 30; // 何日先までスケジュールを計算するか

// ハザード検知用キーワード（ご自身の天気カレンダーの予定タイトルと一致させてください）
const HAZARD_MAP = {
  SEVERE_HEAT: 'SEVERE HEAT', // 酷暑（40℃〜）
  EXTREME_HEAT: 'Extreme Heat', // 猛暑（35℃〜）
  STRONG_WIND: 'Windy',        // 強風
  RAIN: 'Rain',                // 雨
  YAHOO_RAIN: '[Yahoo] 降雨',   // ゲリラ豪雨等
  CHILLY: 'Chilly'             // 寒冷
};

// ==========================================
// 2. メイン処理
// ==========================================
function automateHazardAwareTravelSchedule() {
  const calendar = CalendarApp.getDefaultCalendar();
  const now = new Date();
  const endDate = new Date();
  endDate.setDate(now.getDate() + DAYS_TO_CHECK);
  
  const events = calendar.getEvents(now, endDate);
  
  // 対象の予定を抽出（既存の移動予定などは除外）
  const taskEvents = events.filter(e => 
    e.getLocation() !== '' && 
    !e.getTitle().match(/^(移動：|帰宅：|\[.*?\])/) && 
    !e.isAllDayEvent()
  );

  if (taskEvents.length === 0) return;

  const eventsByDate = {};
  taskEvents.forEach(e => {
    const d = e.getStartTime();
    const dateKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push(e);
  });

  for (const dateKey in eventsByDate) {
    let currentOrigin = HOME_ADDRESS; 
    let lastEventEndTime = null; 
    let lastEventTitle = "";
    
    const dailyEvents = eventsByDate[dateKey].sort((a, b) => a.getStartTime() - b.getStartTime());

    dailyEvents.forEach((event) => {
      const destination = event.getLocation();
      const eventStartTime = event.getStartTime();

      if (currentOrigin === destination) {
        lastEventEndTime = event.getEndTime();
        lastEventTitle = event.getTitle();
        return;
      }

      // 【重要】ハザード情報を取得
      const hazards = getActiveHazards(eventStartTime);
      
      // ハザードを考慮してルートと手段を決定
      const routeData = determineBestRoute(currentOrigin, destination, hazards);

      if (routeData && routeData.directions) {
        const route = routeData.directions.routes[0];
        const travelTimeMinutes = Math.ceil(route.legs[0].duration.value / 60);

        const travelEndTime = new Date(eventStartTime.getTime() - (BUFFER_MINUTES * 60 * 1000));
        const travelStartTime = new Date(travelEndTime.getTime() - (route.legs[0].duration.value * 1000));

        createTravelEvent(calendar, event.getTitle(), travelStartTime, travelEndTime, currentOrigin, destination, routeData, travelTimeMinutes, BUFFER_MINUTES, true);
      }

      currentOrigin = destination;
      lastEventEndTime = event.getEndTime();
      lastEventTitle = event.getTitle();
    });

    // 帰宅計算
    if (currentOrigin !== HOME_ADDRESS && lastEventEndTime) {
      const hazards = getActiveHazards(lastEventEndTime);
      const routeData = determineBestRoute(currentOrigin, HOME_ADDRESS, hazards);
      if (routeData && routeData.directions) {
        const route = routeData.directions.routes[0];
        const returnStartTime = new Date(lastEventEndTime.getTime());
        const returnEndTime = new Date(returnStartTime.getTime() + (route.legs[0].duration.value * 1000));
        createTravelEvent(calendar, `${lastEventTitle} から`, returnStartTime, returnEndTime, currentOrigin, "自宅", routeData, Math.ceil(route.legs[0].duration.value / 60), 0, false);
      }
    }
  }
}

// ==========================================
// 3. ルーティング・ロジック（ハザード分岐）
// ==========================================
function determineBestRoute(origin, destination, hazards) {
  let selectedMode = '';
  let finalDirections = null;

  // 1. 最優先：命の危険（酷暑・猛暑）
  if (hazards.isSevereHeat || hazards.isExtremeHeat) {
    finalDirections = getDirections(origin, destination, Maps.DirectionFinder.Mode.DRIVING);
    if (finalDirections) {
      selectedMode = '[Car]';
    } else {
      selectedMode = '[Train/Bus]';
      finalDirections = getDirections(origin, destination, Maps.DirectionFinder.Mode.TRANSIT);
    }
    return { mode: selectedMode, directions: finalDirections, hazardNote: '猛暑・酷暑警戒' };
  }

  // 2. 強風（Windy）
  if (hazards.isStrongWind) {
    const transit = getDirections(origin, destination, Maps.DirectionFinder.Mode.TRANSIT);
    if (transit) {
      selectedMode = '[Train/Bus]';
      finalDirections = transit;
    } else {
      selectedMode = '[Car]';
      finalDirections = getDirections(origin, destination, Maps.DirectionFinder.Mode.DRIVING);
    }
    return { mode: selectedMode, directions: finalDirections, hazardNote: '強風注意' };
  }

  // 3. 雨天
  if (hazards.isRainy) {
    const transit = getDirections(origin, destination, Maps.DirectionFinder.Mode.TRANSIT);
    if (transit) {
      if (calculateTransitWalkingTime(transit) >= 15) {
        selectedMode = '[Car]';
        finalDirections = getDirections(origin, destination, Maps.DirectionFinder.Mode.DRIVING);
      } else {
        selectedMode = '[Train/Bus]';
        finalDirections = transit;
      }
    } else {
      selectedMode = '[Car]';
      finalDirections = getDirections(origin, destination, Maps.DirectionFinder.Mode.DRIVING);
    }
    return { mode: selectedMode, directions: finalDirections, hazardNote: '雨天' };
  }

  // 4. 通常時
  const walk = getDirections(origin, destination, Maps.DirectionFinder.Mode.WALKING);
  const walkMin = walk ? Math.ceil(walk.routes[0].legs[0].duration.value / 60) : 999;

  if (walkMin < 15) {
    selectedMode = '[Walk]';
    finalDirections = walk;
  } else if (walkMin < 30) {
    selectedMode = '[Bicycle]';
    finalDirections = getDirections(origin, destination, Maps.DirectionFinder.Mode.BICYCLING) || walk;
  } else {
    const transit = getDirections(origin, destination, Maps.DirectionFinder.Mode.TRANSIT);
    if (transit) {
      selectedMode = '[Train/Bus]';
      finalDirections = transit;
    } else {
      selectedMode = '[Car]';
      finalDirections = getDirections(origin, destination, Maps.DirectionFinder.Mode.DRIVING);
    }
  }

  return { mode: selectedMode, directions: finalDirections };
}

// ==========================================
// 4. 補助関数群
// ==========================================
function getActiveHazards(targetTime) {
  const weatherCal = CalendarApp.getCalendarById(WEATHER_CALENDAR_ID);
  if(!weatherCal) return { isSevereHeat: false, isExtremeHeat: false, isStrongWind: false, isRainy: false, isCold: false };

  const startTime = new Date(targetTime.getTime() - 30 * 60 * 1000);
  const endTime = new Date(targetTime.getTime() + 30 * 60 * 1000);
  const events = weatherCal.getEvents(startTime, endTime);
  
  const h = { isSevereHeat: false, isExtremeHeat: false, isStrongWind: false, isRainy: false, isCold: false };

  events.forEach(e => {
    const title = e.getTitle();
    if (title.includes(HAZARD_MAP.SEVERE_HEAT)) h.isSevereHeat = true;
    if (title.includes(HAZARD_MAP.EXTREME_HEAT)) h.isExtremeHeat = true;
    if (title.includes(HAZARD_MAP.STRONG_WIND)) h.isStrongWind = true;
    if (title.includes(HAZARD_MAP.RAIN) || title.includes(HAZARD_MAP.YAHOO_RAIN)) h.isRainy = true;
    if (title.includes(HAZARD_MAP.CHILLY)) h.isCold = true;
  });

  return h;
}

function getDirections(origin, destination, mode) {
  try {
    const directions = Maps.newDirectionFinder()
      .setOrigin(origin)
      .setDestination(destination)
      .setMode(mode)
      .setLanguage('ja')
      .getDirections();
    return (directions.status === 'OK' && directions.routes.length > 0) ? directions : null;
  } catch (e) { return null; }
}

function calculateTransitWalkingTime(directions) {
  let sec = 0;
  const steps = directions.routes[0].legs[0].steps;
  if (steps) {
    steps.forEach(s => { if (s.travel_mode === 'WALKING') sec += s.duration.value; });
  }
  return Math.ceil(sec / 60);
}

function createTravelEvent(calendar, baseTitle, startTime, endTime, origin, destination, routeData, minutes, buffer, isGo) {
  const prefix = isGo ? '移動：' : '帰宅：';
  const title = `${routeData.mode} ${prefix}${baseTitle}`;
  
  if (calendar.getEvents(startTime, endTime).some(e => e.getTitle() === title)) return;

  const desc = `所要時間：約${minutes}分\n手段：${routeData.mode}\n${routeData.hazardNote ? '警告：' + routeData.hazardNote + '\n' : ''}出発：${origin}\n到着：${destination}`;
  const ev = calendar.createEvent(title, startTime, endTime, { location: `${origin} → ${destination}`, description: desc });

  if (routeData.mode === '[Walk]') ev.setColor(CalendarApp.EventColor.YELLOW);
  else if (routeData.mode === '[Bicycle]') ev.setColor(CalendarApp.EventColor.GREEN);
  else if (routeData.mode === '[Train/Bus]') ev.setColor(CalendarApp.EventColor.BLUE);
  else if (routeData.mode === '[Car]') ev.setColor(CalendarApp.EventColor.RED);
}
