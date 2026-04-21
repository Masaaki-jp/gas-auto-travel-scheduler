/**
 * Survival DX - 自動経路登録エージェント (Phase 1)
 * * カレンダーの予定（場所あり）を読み取り、拠点からの往復経路と
 * 移動時間をGoogle Maps APIで自動計算してスケジュールに登録します。
 */

function automateTravelScheduleFutureAndReturn() {
  // --- 初期設定 ---
  // 拠点の住所（ご自身の自宅やオフィスの住所に変更してください）
  const HOME_ADDRESS = 'Enter_YOUR_ADDRESS'; 
  const calendar = CalendarApp.getDefaultCalendar();
  
  // 監視期間の設定（現在から30日後まで）
  const now = new Date();
  const endDate = new Date();
  endDate.setDate(now.getDate() + 30); 
  
  // --- 1. 予定の抽出と選別 ---
  const events = calendar.getEvents(now, endDate);
  
  const taskEvents = events.filter(e => 
    e.getLocation() !== '' && 
    !e.getTitle().startsWith('移動：') &&
    !e.getTitle().startsWith('帰宅：') &&
    !e.isAllDayEvent()
  );

  if (taskEvents.length === 0) {
    console.log('対象となる予定（場所あり）が見つかりませんでした。');
    return;
  }

  // --- 2. 予定を日付ごとにグループ化 ---
  const eventsByDate = {};
  taskEvents.forEach(e => {
    const d = e.getStartTime();
    const dateKey = Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (!eventsByDate[dateKey]) eventsByDate[dateKey] = [];
    eventsByDate[dateKey].push(e);
  });

  // --- 3. 日付ごとの経路計算ループ ---
  for (const dateKey in eventsByDate) {
    console.log(`--- ${dateKey} の経路計算を開始 ---`);
    
    // 毎日、出発地点を拠点（自宅）にリセット
    let currentOrigin = HOME_ADDRESS; 
    let lastEventEndTime = null; 
    let lastEventTitle = "";
    
    // その日の予定を時系列（開始時間が早い順）にソート
    const dailyEvents = eventsByDate[dateKey].sort((a, b) => a.getStartTime() - b.getStartTime());

    // 【行きの計算】各予定への移動
    dailyEvents.forEach((event) => {
      const destination = event.getLocation();
      const eventStartTime = event.getStartTime();

      try {
        const directions = Maps.newDirectionFinder()
          .setOrigin(currentOrigin)
          .setDestination(destination)
          .setMode(Maps.DirectionFinder.Mode.TRANSIT) // 公共交通機関をデフォルト設定
          .setLanguage('ja')
          .getDirections();

        if (directions.routes && directions.routes.length > 0) {
          const route = directions.routes[0];
          const travelTimeMinutes = Math.ceil(route.legs[0].duration.value / 60);

          const travelEndTime = new Date(eventStartTime.getTime());
          const travelStartTime = new Date(eventStartTime.getTime() - (route.legs[0].duration.value * 1000));

          // 重複登録の防止
          const isAlreadyRegistered = calendar.getEvents(travelStartTime, travelEndTime).some(e => 
            e.getTitle() === `移動：${event.getTitle()}`
          );

          if (!isAlreadyRegistered) {
            calendar.createEvent(
              `移動：${event.getTitle()}`,
              travelStartTime,
              travelEndTime,
              {
                location: `${currentOrigin} → ${destination}`,
                description: `所要時間：約${travelTimeMinutes}分\n出発：${route.legs[0].start_address}`
              }
            );
            console.log(`[登録成功/行き] ${event.getTitle()} へ（所要時間: ${travelTimeMinutes}分）`);
          } else {
             console.log(`[スキップ] ${event.getTitle()} への移動は既にカレンダーに存在します。`);
          }
        }
      } catch (error) {
        console.error(`[エラー/行き] ${event.getTitle()} の計算失敗: ${error.message}`);
      }

      // 次の予定の出発地を、現在の目的地に更新
      currentOrigin = destination;
      lastEventEndTime = event.getEndTime();
      lastEventTitle = event.getTitle();
    });

    // 【帰りの計算】すべての予定が終わった後、拠点へ帰る処理
    if (currentOrigin !== HOME_ADDRESS && lastEventEndTime) {
      try {
        const returnDirections = Maps.newDirectionFinder()
          .setOrigin(currentOrigin)
          .setDestination(HOME_ADDRESS)
          .setMode(Maps.DirectionFinder.Mode.TRANSIT)
          .setLanguage('ja')
          .getDirections();

        if (returnDirections.routes && returnDirections.routes.length > 0) {
          const route = returnDirections.routes[0];
          const travelTimeMinutes = Math.ceil(route.legs[0].duration.value / 60);

          const returnStartTime = new Date(lastEventEndTime.getTime());
          const returnEndTime = new Date(lastEventEndTime.getTime() + (route.legs[0].duration.value * 1000));

          const isReturnAlreadyRegistered = calendar.getEvents(returnStartTime, returnEndTime).some(e => 
            e.getTitle() === `帰宅：${lastEventTitle} から`
          );

          if (!isReturnAlreadyRegistered) {
            calendar.createEvent(
              `帰宅：${lastEventTitle} から`,
              returnStartTime,
              returnEndTime,
              {
                location: `${currentOrigin} → 拠点`,
                description: `所要時間：約${travelTimeMinutes}分\n到着：${HOME_ADDRESS}`
              }
            );
            console.log(`[登録成功/帰り] ${lastEventTitle} から拠点へ（所要時間: ${travelTimeMinutes}分）`);
          } else {
            console.log(`[スキップ] ${lastEventTitle} からの帰宅は既にカレンダーに存在します。`);
          }
        }
      } catch (error) {
         console.error(`[エラー/帰り] 帰宅計算失敗: ${error.message}`);
      }
    }
    console.log(`--- ${dateKey} の処理完了 ---\n`);
  }
}
