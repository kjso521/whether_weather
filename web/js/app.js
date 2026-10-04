/* global d3, topojson, Scores */
(async function () {
  // 색은 노을 사진(docs/color.jpeg)에서 뽑은 팔레트를 쓴다. 창문 불빛의 따뜻한 색/차가운 색이 맑음/비.
  const WEATHER = {
    clear: { label: "맑음", color: "#f2c48a" },
    partly: { label: "구름많음", color: "#dcd9e6" },
    cloudy: { label: "흐림", color: "#a39fb3" },
    rain: { label: "비", color: "#6f9cc0" },
    sleet: { label: "비/눈", color: "#8f8bb5" },
    snow: { label: "눈", color: "#cfd9ea" },
    shower: { label: "소나기", color: "#456f96" },
  };
  const PTY_KIND = { 1: "rain", 2: "sleet", 3: "snow", 4: "shower" };
  const SKY_KIND = { 1: "clear", 3: "partly", 4: "cloudy" };
  const LOW = "#f1eff6"; // 연속 색상 척도의 낮은 쪽(배경과 같은 계열)
  // 지수: 나쁨(어두운 남색 하늘) → 보통(옅은 연보라) → 좋음(지평선의 노을빛)
  const SCORE_SCALE = d3
    .scaleLinear([0, 25, 50, 75, 100], ["#454475", "#8f8bb5", "#ece8f1", "#e79aa8", "#c9405f"])
    .clamp(true);

  // 지도에 칠할 수 있는 층. type: "score"(출사 지수) | "weather"(범주형 날씨) | "value"(예보 값)
  const SCORE_LAYERS = Scores.MODES.map((mode) => ({ ...mode, type: "score", unit: "점", scale: SCORE_SCALE }));
  const WEATHER_LAYERS = [
    { id: "weather", label: "날씨", type: "weather" },
    { id: "POP", label: "강수확률", type: "value", unit: "%", scale: d3.scaleLinear([0, 100], [LOW, "#456f96"]).clamp(true) },
    {
      id: "TMP", label: "기온", type: "value", unit: "°",
      scale: d3.scaleLinear([-10, 0, 10, 20, 30, 38], ["#393967", "#8f8bb5", LOW, "#f2c48a", "#d4566e", "#8e2f4a"]).clamp(true),
    },
    { id: "WSD", label: "풍속", type: "value", unit: "m/s", scale: d3.scaleLinear([0, 12], [LOW, "#5e4273"]).clamp(true) },
    { id: "REH", label: "습도", type: "value", unit: "%", scale: d3.scaleLinear([0, 100], [LOW, "#4f6b82"]).clamp(true) },
  ];
  const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];
  const RELATIVE_DAY = { "-1": "어제", 0: "오늘", 1: "내일", 2: "모레" };
  const PLAY_INTERVAL_MS = 700;
  const RANKING_SIZE = 10;
  // 지도를 맞출 범위(본토 + 제주). 울릉도·백령도까지 넣으면 좁은 화면에서 본토가 너무 작아져서, 먼 섬은 이동/확대로 본다.
  const MAINLAND_EXTENT = { type: "MultiPoint", coordinates: [[125.9, 33.1], [129.7, 38.65]] };
  const KOREA_CENTER = { lat: 36.3, lon: 127.8 }; // 모드 대상 시간대를 찾을 때 쓰는 기준점

  const [topo, regions, weather] = await Promise.all(
    ["data/sigungu.topo.json", "data/regions.json", "data/weather_latest.json"].map((url) =>
      fetch(url).then((res) => {
        if (!res.ok) throw new Error(`${url}: ${res.status}`);
        return res.json();
      })
    )
  );

  // 시각은 모두 KST 문자열("2026-10-05T06:00+09:00")이므로, 화면 표시는 보는 사람의 시간대와 무관하게 문자열로 다룬다.
  // 시간축은 연속이 아닐 수 있다(먼 미래는 3시간 간격).
  const hours = weather.hours;
  const hourDates = hours.map((h) => new Date(h)); // 천문 계산용 절대 시각
  const dateOf = (h) => h.slice(0, 10);
  const hourOf = (h) => Number(h.slice(11, 13));
  const dates = [...new Set(hours.map(dateOf))];
  const nowKst = new Date(Date.now() + 9 * 3600 * 1000).toISOString();
  const today = nowKst.slice(0, 10);

  const state = {
    layer: SCORE_LAYERS[0],
    index: Math.max(0, hours.findIndex((h) => h.slice(0, 13) >= nowKst.slice(0, 13))),
    selected: null,
    timer: null,
  };

  const seriesOf = (code) => {
    const r = regions[code];
    return r && weather.grids[`${r.nx},${r.ny}`];
  };
  const valueAt = (code, name, index) => seriesOf(code)?.[name]?.[index] ?? null;
  const weatherKind = (code, index) => {
    const pty = valueAt(code, "PTY", index);
    if (pty) return PTY_KIND[pty] ?? "rain";
    return SKY_KIND[valueAt(code, "SKY", index)] ?? null;
  };
  const scoreAt = (code, layer, index) =>
    Scores.score(layer.id, { lat: regions[code].lat, lon: regions[code].lon, hours: hourDates, index, series: seriesOf(code) });
  // 현재 층에서 한 지역·시각의 숫자 값 (날씨 층은 숫자가 없으므로 null)
  const layerValue = (code, layer, index) =>
    layer.type === "score" ? scoreAt(code, layer, index) : layer.type === "value" ? valueAt(code, layer.id, index) : null;
  const fmt = (value, unit = "") => (value == null ? "–" : `${Math.round(value * 10) / 10}${unit}`);

  function fillOf(code) {
    if (state.layer.type === "weather") {
      const kind = weatherKind(code, state.index);
      return kind ? WEATHER[kind].color : "var(--no-data)";
    }
    const value = layerValue(code, state.layer, state.index);
    return value == null ? "var(--no-data)" : state.layer.scale(value);
  }

  function dateLabel(date, relative = true) {
    const diff = Math.round((Date.parse(date) - Date.parse(today)) / 86400000);
    const [, month, day] = date.split("-").map(Number);
    const weekday = DAY_NAMES[new Date(`${date}T00:00:00Z`).getUTCDay()];
    const text = `${month}.${day} (${weekday})`;
    return relative && RELATIVE_DAY[diff] ? `${RELATIVE_DAY[diff]} ${text}` : text;
  }
  const timeLabel = (index) => `${dateLabel(dateOf(hours[index]), false)} ${hourOf(hours[index])}시`;
  const fullName = (code) => `${regions[code].sido} ${regions[code].name}`;

  // 한 줄 요약: "맑음 · 18° · 나들이 92점"
  function summary(code) {
    const kind = weatherKind(code, state.index);
    const parts = [kind ? WEATHER[kind].label : "자료 없음", fmt(valueAt(code, "TMP", state.index), "°")];
    if (state.layer.type === "score" || (state.layer.type === "value" && state.layer.id !== "TMP")) {
      parts.push(`${state.layer.label} ${fmt(layerValue(code, state.layer, state.index), state.layer.unit)}`);
    }
    return parts.join(" · ");
  }

  // ---- 지도 ----
  const svg = d3.select("#map");
  const object = Object.values(topo.objects)[0];
  const features = topojson.feature(topo, object).features;
  const sidoMesh = topojson.mesh(topo, object, (a, b) => a.properties.code.slice(0, 2) !== b.properties.code.slice(0, 2));
  const layer = svg.append("g");
  const paths = layer.selectAll("path.region").data(features).join("path").attr("class", "region");
  const sidoPath = layer.append("path").attr("class", "sido-border");
  const zoom = d3.zoom().scaleExtent([1, 10]).on("zoom", (event) => layer.attr("transform", event.transform));
  svg.call(zoom);

  function layoutMap() {
    const { width, height } = svg.node().getBoundingClientRect();
    if (!width || !height) return;
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const path = d3.geoPath(d3.geoMercator().fitSize([width, height], MAINLAND_EXTENT));
    paths.attr("d", path);
    sidoPath.attr("d", path(sidoMesh));
    svg.call(zoom.transform, d3.zoomIdentity);
  }
  layoutMap();
  window.addEventListener("resize", layoutMap);

  const tooltip = document.getElementById("tooltip");
  const mapWrap = document.querySelector(".map-wrap");
  paths
    .on("pointermove", (event, d) => {
      if (event.pointerType === "touch") return;
      const box = mapWrap.getBoundingClientRect();
      tooltip.hidden = false;
      tooltip.innerHTML = "<b></b><br><span></span>";
      tooltip.querySelector("b").textContent = fullName(d.properties.code);
      tooltip.querySelector("span").textContent = summary(d.properties.code);
      // 오른쪽 끝에서는 툴팁이 잘리지 않게 왼쪽으로 띄운다
      const x = event.clientX - box.left;
      tooltip.style.left = `${x > box.width - 200 ? x - tooltip.offsetWidth - 24 : x}px`;
      tooltip.style.top = `${event.clientY - box.top}px`;
    })
    .on("pointerleave", () => (tooltip.hidden = true))
    .on("click", (event, d) => {
      state.selected = d.properties.code;
      render();
    });

  // ---- 서랍 메뉴(모바일) ----
  const side = document.getElementById("side");
  const backdrop = document.getElementById("backdrop");
  const menuButton = document.getElementById("menu");
  function setMenuOpen(open) {
    side.classList.toggle("open", open);
    backdrop.hidden = !open;
    menuButton.setAttribute("aria-expanded", String(open));
  }
  menuButton.addEventListener("click", () => setMenuOpen(true));
  document.getElementById("close").addEventListener("click", () => setMenuOpen(false));
  backdrop.addEventListener("click", () => setMenuOpen(false));
  document.addEventListener("keydown", (event) => event.key === "Escape" && setMenuOpen(false));

  const picked = document.getElementById("picked");
  picked.addEventListener("click", () => {
    setMenuOpen(true);
    document.getElementById("detail").scrollIntoView({ block: "start" });
  });

  // ---- 컨트롤 ----
  function makeChips(container, items, isActive, onPick) {
    const root = d3.select(container);
    root
      .selectAll("button")
      .data(items)
      .join("button")
      .attr("class", "chip")
      .attr("type", "button")
      .text((d) => d.label)
      .on("click", (event, d) => onPick(d));
    return () => root.selectAll("button").attr("aria-pressed", (d) => String(isActive(d)));
  }

  // 일출·은하수처럼 특정 시간대만 해당하는 모드를 고르면, 지금 이후 가장 가까운 해당 시각으로 옮긴다.
  function jumpToApplicableHour(layer) {
    const ok = (i) => Scores.applies(layer.id, KOREA_CENTER.lat, KOREA_CENTER.lon, hourDates[i]);
    if (ok(state.index)) return;
    const order = [...hours.keys()].filter((i) => i > state.index).concat([...hours.keys()].filter((i) => i < state.index).reverse());
    const found = order.find(ok);
    if (found != null) state.index = found;
  }

  function pickLayer(layer) {
    state.layer = layer;
    if (layer.type === "score") jumpToApplicableHour(layer);
    render();
  }
  const isCurrentLayer = (d) => d === state.layer;
  const updateScoreChips = makeChips("#score-chips", SCORE_LAYERS, isCurrentLayer, pickLayer);
  const updateWeatherChips = makeChips("#weather-chips", WEATHER_LAYERS, isCurrentLayer, pickLayer);
  const updateDateChips = makeChips(
    "#date-chips",
    dates.map((date) => ({ date, label: dateLabel(date) })),
    (d) => d.date === dateOf(hours[state.index]),
    (d) => {
      // 같은 시각을 유지한 채 날짜만 옮긴다 (그 시각이 없으면 가장 가까운 시각)
      const wanted = hourOf(hours[state.index]);
      const candidates = [...hours.keys()].filter((i) => dateOf(hours[i]) === d.date);
      state.index = candidates.reduce((best, i) =>
        Math.abs(hourOf(hours[i]) - wanted) < Math.abs(hourOf(hours[best]) - wanted) ? i : best
      );
      render();
    }
  );

  const slider = document.getElementById("hour");
  const hourLabel = document.getElementById("hour-label");
  slider.min = 0;
  slider.max = hours.length - 1;
  slider.addEventListener("input", () => {
    state.index = Number(slider.value);
    render();
  });

  const playButton = document.getElementById("play");
  function setPlaying(on) {
    clearInterval(state.timer);
    state.timer = on
      ? setInterval(() => {
          state.index = (state.index + 1) % hours.length;
          render();
        }, PLAY_INTERVAL_MS)
      : null;
    playButton.textContent = on ? "❚❚" : "▶";
    playButton.setAttribute("aria-label", on ? "일시정지" : "재생");
  }
  playButton.addEventListener("click", () => setPlaying(!state.timer));

  // ---- 범례 ----
  function renderLegend() {
    const legend = d3.select("#legend").html("");
    const { scale, unit, label, type } = state.layer;
    legend.append("div").attr("class", "legend-title").text(label);
    if (type === "weather") {
      legend
        .append("div")
        .attr("class", "legend-items")
        .selectAll("span")
        .data(Object.values(WEATHER))
        .join("span")
        .attr("class", "legend-item")
        .html((d) => `<i class="swatch" style="background:${d.color}"></i>${d.label}`);
      return;
    }
    const domain = scale.domain();
    const stops = d3.range(0, 1.01, 0.1).map((t) => scale(domain[0] + t * (domain.at(-1) - domain[0])));
    legend.append("div").attr("class", "legend-bar").style("background", `linear-gradient(to right, ${stops.join(",")})`);
    legend
      .append("div")
      .attr("class", "legend-ticks")
      .selectAll("span")
      .data([domain[0], domain.at(-1)])
      .join("span")
      .text((d, i) => (type === "score" ? ["나쁨", "좋음"][i] : `${d}${unit}`));
  }

  // ---- 추천 순위 ----
  function renderRanking() {
    const section = document.getElementById("ranking-section");
    section.hidden = state.layer.type !== "score";
    if (section.hidden) return;
    const ranked = Object.keys(regions)
      .map((code) => ({ code, points: scoreAt(code, state.layer, state.index) }))
      .filter((d) => d.points != null)
      .sort((a, b) => b.points - a.points)
      .slice(0, RANKING_SIZE);
    const list = d3.select("#ranking");
    list.selectAll("li").remove();
    if (!ranked.length) {
      list.append("li").attr("class", "note").text("이 시각은 이 모드의 대상 시간대가 아닙니다.");
      return;
    }
    const buttons = list
      .selectAll("li")
      .data(ranked)
      .join("li")
      .append("button")
      .attr("type", "button")
      .on("click", (event, d) => {
        state.selected = d.code;
        setMenuOpen(false);
        render();
      });
    buttons.append("span").attr("class", "sido").text((d) => regions[d.code].sido);
    buttons.append("span").attr("class", "name").text((d) => regions[d.code].name);
    buttons.append("span").attr("class", "points").text((d) => d.points);
  }

  // ---- 상세 ----
  function renderDetail() {
    const code = state.selected;
    picked.hidden = !code;
    if (!code) return;
    picked.innerHTML = "<b></b> · <span></span>";
    picked.querySelector("b").textContent = regions[code].name;
    picked.querySelector("span").textContent = summary(code);

    const root = d3.select("#detail");
    const i = state.index;
    const kind = weatherKind(code, i);
    const isScore = state.layer.type === "score";
    const dayIndexes = [...hours.keys()].filter((j) => dateOf(hours[j]) === dateOf(hours[i]));

    root.html(`
      <div class="where"></div>
      <h2></h2>
      <div class="now"><span class="temp">${fmt(valueAt(code, "TMP", i), "°")}</span><span>${kind ? WEATHER[kind].label : "자료 없음"}</span></div>
      <div class="stats">
        <div class="stat"><span>${isScore ? state.layer.label : "강수확률"}</span><b>${
          isScore ? fmt(scoreAt(code, state.layer, i), "점") : fmt(valueAt(code, "POP", i), "%")
        }</b></div>
        <div class="stat"><span>습도</span><b>${fmt(valueAt(code, "REH", i), "%")}</b></div>
        <div class="stat"><span>풍속</span><b>${fmt(valueAt(code, "WSD", i), "m/s")}</b></div>
      </div>
      <table class="hourly">
        <thead><tr><th>시각</th><th>날씨</th><th>기온</th><th>강수</th><th>습도</th><th>풍속</th>${isScore ? "<th>점수</th>" : ""}</tr></thead>
        <tbody></tbody>
      </table>`);
    root.select(".where").text(`${regions[code].sido} · ${timeLabel(i)}`);
    root.select("h2").text(regions[code].name);
    root
      .select("tbody")
      .selectAll("tr")
      .data(dayIndexes)
      .join("tr")
      .classed("current", (j) => j === i)
      .on("click", (event, j) => {
        state.index = j;
        render();
      })
      .html((j) => {
        const k = weatherKind(code, j);
        return `<td>${hourOf(hours[j])}시</td>
          <td><i class="swatch" style="background:${k ? WEATHER[k].color : "var(--no-data)"}"></i> ${k ? WEATHER[k].label : "–"}</td>
          <td>${fmt(valueAt(code, "TMP", j), "°")}</td><td>${fmt(valueAt(code, "POP", j), "%")}</td>
          <td>${fmt(valueAt(code, "REH", j), "%")}</td><td>${fmt(valueAt(code, "WSD", j))}</td>
          ${isScore ? `<td>${fmt(scoreAt(code, state.layer, j))}</td>` : ""}`;
      });
  }

  // ---- 전체 갱신 ----
  let legendFor = null;
  function render() {
    paths.attr("fill", (d) => fillOf(d.properties.code)).classed("selected", (d) => d.properties.code === state.selected);
    paths.filter((d) => d.properties.code === state.selected).raise();
    sidoPath.raise();

    slider.value = state.index;
    hourLabel.textContent = timeLabel(state.index);

    updateScoreChips();
    updateWeatherChips();
    updateDateChips();
    if (legendFor !== state.layer) {
      renderLegend();
      document.getElementById("layer-note").textContent = state.layer.note ?? "";
      legendFor = state.layer;
    }
    renderRanking();
    renderDetail();
  }

  const meta = document.getElementById("meta");
  meta.textContent = `예보 발표 ${weather.baseTime.slice(5, 16).replace("-", ".").replace("T", " ")}${weather.sample ? " · 샘플 데이터(실제 날씨 아님)" : ""}`;

  render();
})().catch((error) => {
  document.querySelector(".map-wrap").textContent = `데이터를 불러오지 못했습니다: ${error.message}`;
});
